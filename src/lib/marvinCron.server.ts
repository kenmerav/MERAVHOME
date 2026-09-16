/* eslint-disable @typescript-eslint/no-explicit-any -- scheduled jobs use server-only Supabase rows. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runEaOperatingReview } from "@/lib/eaOperator.server";
import { MARVIN_SCHEDULED_GMAIL_BATCH_SIZE } from "@/lib/marvinCron";
import {
  generateBriefingForUser,
  preparePendingEaDrafts,
  refreshPendingSourceMatches,
  syncEaEmailActions,
  syncFathom,
  syncSharedDriveFolder,
  syncSharedGmail,
} from "@/lib/marvin.server";

const admin = supabaseAdmin as any;

export const MARVIN_CRON_STAGES = [
  "inbox",
  "drive",
  "fathom",
  "matching",
  "actions",
  "drafts",
  "review",
  "briefing-ken",
  "briefing-katie",
  "briefing-brynn",
] as const;

export type MarvinCronStage = (typeof MARVIN_CRON_STAGES)[number];

export function isMarvinCronStage(value: string): value is MarvinCronStage {
  return MARVIN_CRON_STAGES.includes(value as MarvinCronStage);
}

function phoenixSlot(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}:${value("hour")}`;
}

async function executeStage(stage: MarvinCronStage) {
  switch (stage) {
    case "inbox": {
      const result = await syncSharedGmail({
        maxMessages: MARVIN_SCHEDULED_GMAIL_BATCH_SIZE,
        syncDrive: false,
      });
      return {
        processed: result.processed,
        failed: result.failed,
        partial: result.partial,
        remaining: result.partial,
      };
    }
    case "drive":
      return syncSharedDriveFolder({ maxChangedFiles: 3 });
    case "fathom": {
      const results = await syncFathom();
      return {
        integrations: results.length,
        processed: results.reduce((total, result) => total + Number(result.processed || 0), 0),
        failed: results.reduce((total, result) => total + Number(result.failed || 0), 0),
      };
    }
    case "matching":
      return refreshPendingSourceMatches(20);
    case "actions":
      return syncEaEmailActions({ maxSources: 40, prepareDrafts: false });
    case "drafts":
      return preparePendingEaDrafts(3);
    case "review":
      return runEaOperatingReview();
    default: {
      const email = `${stage.slice("briefing-".length)}@meravinteriors.com`;
      const { data: profile, error } = await admin
        .from("user_profiles")
        .select("id,email")
        .ilike("email", email)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      if (!profile) throw new Error(`The ${email} briefing account is not active.`);
      const briefing = await generateBriefingForUser(profile.id, true);
      return { user: email, briefing_id: briefing.id, status: briefing.status };
    }
  }
}

export async function runMarvinCronStage(stage: MarvinCronStage) {
  const now = new Date();
  const jobType = `scheduled_${stage.replaceAll("-", "_")}`;
  const idempotencyKey = `${jobType}:${phoenixSlot(now)}`;
  // Vercel kills timed-out functions before their catch block runs. Close stale records
  // on the next invocation rather than leaving a misleading permanent "running" state.
  const { error: staleError } = await admin
    .from("marvin_sync_jobs")
    .update({
      status: "failed",
      error: "The previous scheduled request timed out before it could finish.",
      finished_at: now.toISOString(),
    })
    .in("job_type", [jobType, "morning_briefing"])
    .eq("status", "running")
    .lt("started_at", new Date(now.getTime() - 10 * 60_000).toISOString());
  if (staleError) throw staleError;

  const { error: claimError } = await admin.from("marvin_sync_jobs").insert({
    job_type: jobType,
    idempotency_key: idempotencyKey,
    status: "running",
    started_at: now.toISOString(),
  });
  if (claimError?.code === "23505") return { stage, skipped: true, reason: "Already started." };
  if (claimError) throw claimError;

  try {
    const result = await executeStage(stage);
    const partial = Boolean(
      ("partial" in result && result.partial) ||
      ("failed" in result && Number(result.failed) > 0) ||
      ("deferred" in result && Number(result.deferred) > 0) ||
      ("needsReconnect" in result && Boolean(result.needsReconnect)) ||
      ("draftFailures" in result && Number(result.draftFailures) > 0),
    );
    const { error } = await admin
      .from("marvin_sync_jobs")
      .update({
        status: partial ? "partial" : "complete",
        progress: result,
        error: partial ? "Some items remain for a later scheduled retry." : null,
        finished_at: new Date().toISOString(),
      })
      .eq("idempotency_key", idempotencyKey);
    if (error) throw error;
    return { stage, status: partial ? "partial" : "complete", result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    await admin
      .from("marvin_sync_jobs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("idempotency_key", idempotencyKey);
    throw error;
  }
}
