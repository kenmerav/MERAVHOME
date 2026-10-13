/* eslint-disable @typescript-eslint/no-explicit-any -- existing server-only integration rows. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canUseEaWorkspace } from "@/lib/permissions";
import { json, MARVIN_SHARED_GMAIL, syncConstructionDocuments } from "@/lib/marvin.server";

const admin = supabaseAdmin as any;

export async function requireConstructionUploadAccess(request: Request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { error: json({ error: "Sign in first." }, 401) };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { error: json({ error: "Your session expired." }, 401) };
  const profile = await admin
    .from("user_profiles")
    .select("id,email,role,is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profile.error || !canUseEaWorkspace(profile.data)) {
    return {
      error: json(
        { error: "Document upload controls are available only to Ken, Katie, and Brynn." },
        403,
      ),
    };
  }
  return { user: { id: data.user.id }, profile: profile.data };
}

export async function loadConstructionUploadStatus() {
  const [connection, latestCheck, latestSuccess] = await Promise.all([
    admin
      .from("marvin_integrations")
      .select("account_email,status,last_error")
      .eq("provider", "gmail")
      .eq("account_email", MARVIN_SHARED_GMAIL)
      .maybeSingle(),
    admin
      .from("marvin_sync_jobs")
      .select("status,started_at,finished_at,error,progress")
      .in("job_type", ["scheduled_construction_docs", "manual_construction_docs"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("marvin_sync_jobs")
      .select("finished_at")
      .in("job_type", ["scheduled_construction_docs", "manual_construction_docs"])
      .eq("status", "complete")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const result of [connection, latestCheck, latestSuccess])
    if (result.error) throw result.error;
  // Explicitly return only operational counts, not metadata/cursors or credentials.
  const check = latestCheck.data;
  return {
    connection: connection.data,
    lastSuccessfulCheck: latestSuccess.data?.finished_at ?? null,
    latestCheck: check
      ? {
          status: check.status,
          started_at: check.started_at,
          finished_at: check.finished_at,
          error: check.error,
          uploaded: Number(check.progress?.uploaded || 0),
          failed: Number(check.progress?.failed || 0),
          deferred: Number(check.progress?.deferred || 0),
          needsReview: Number(check.progress?.needsReview || 0),
          needsReconnect: Boolean(check.progress?.needsReconnect),
        }
      : null,
  };
}

export async function refreshConstructionUploads(userId: string) {
  const key = `manual_construction_docs:${crypto.randomUUID()}`;
  const claim = await admin.from("marvin_sync_jobs").insert({
    job_type: "manual_construction_docs",
    idempotency_key: key,
    status: "running",
    started_at: new Date().toISOString(),
    owner_user_id: userId,
  });
  if (claim.error) throw claim.error;
  try {
    const result = await syncConstructionDocuments();
    const saved = await admin
      .from("marvin_sync_jobs")
      .update({
        status:
          result.failed || result.deferred || result.needsReconnect || result.error
            ? "partial"
            : "complete",
        progress: result,
        error: result.error,
        finished_at: new Date().toISOString(),
      })
      .eq("idempotency_key", key);
    if (saved.error) throw saved.error;
    return result;
  } catch (error) {
    await admin
      .from("marvin_sync_jobs")
      .update({
        status: "failed",
        error: error instanceof Error ? error.message : "Document refresh failed.",
        finished_at: new Date().toISOString(),
      })
      .eq("idempotency_key", key);
    throw error;
  }
}
