import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanUuid } from "@/lib/ids";
import { isStudioTeamRole } from "@/lib/permissions";
import {
  closeProcurementRun,
  createProcurementRun,
  getProcurementRunResult,
  listProcurementRuns,
  reissueProcurementRunAccess,
  retryProcurementRun,
  type ProcurementDraftOverride,
} from "@/lib/procurementRuns.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function requireStudioTeam(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: json({ error: "Sign in to prepare cart runs." }, 401) };
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: json({ error: "Your Studio session is no longer valid." }, 401) };
  }
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("id,role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.is_active || !isStudioTeamRole(profile.role)) {
    return { error: json({ error: "Cart runs are available to the Studio team only." }, 403) };
  }
  return { user: userData.user };
}

function errorResponse(error: unknown) {
  const value = error as Error & {
    code?: string;
    runId?: string;
    blocked?: unknown;
  };
  if (value.code === "ACTIVE_RUN_EXISTS") {
    return json({ error: value.message, run_id: value.runId }, 409);
  }
  if (value.code === "PREFLIGHT_FAILED") {
    return json({ error: value.message, blocked: value.blocked }, 400);
  }
  console.error("[Procurement Runs] Request failed", error);
  return json({ error: value.message || "Could not complete the cart-run request." }, 500);
}

export const Route = createFileRoute("/api/procurement-runs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireStudioTeam(request);
          if ("error" in access) return access.error;
          const url = new URL(request.url);
          const runId = cleanUuid(url.searchParams.get("runId"));
          const projectId = cleanUuid(url.searchParams.get("projectId"));
          if (runId) return json({ run: await getProcurementRunResult(runId) });
          if (projectId) return json({ runs: await listProcurementRuns(projectId) });
          return json({ error: "Provide a valid runId or projectId." }, 400);
        } catch (error) {
          return errorResponse(error);
        }
      },
      POST: async ({ request }) => {
        try {
          const access = await requireStudioTeam(request);
          if ("error" in access) return access.error;
          const body = (await request.json()) as {
            action?: "create" | "retry" | "reissue";
            project_id?: string;
            run_id?: string;
            items?: ProcurementDraftOverride[];
          };
          if (body.action === "retry") {
            const runId = cleanUuid(body.run_id);
            if (!runId) return json({ error: "Valid run_id required." }, 400);
            return json(await retryProcurementRun({ runId, userId: access.user.id }), 201);
          }
          if (body.action === "reissue") {
            const runId = cleanUuid(body.run_id);
            if (!runId) return json({ error: "Valid run_id required." }, 400);
            return json(await reissueProcurementRunAccess({ runId, userId: access.user.id }));
          }
          const projectId = cleanUuid(body.project_id);
          if (!projectId) return json({ error: "Valid project_id required." }, 400);
          if (!Array.isArray(body.items)) return json({ error: "items must be an array." }, 400);
          return json(
            await createProcurementRun({
              projectId,
              userId: access.user.id,
              overrides: body.items,
            }),
            201,
          );
        } catch (error) {
          return errorResponse(error);
        }
      },
      PATCH: async ({ request }) => {
        try {
          const access = await requireStudioTeam(request);
          if ("error" in access) return access.error;
          const body = (await request.json()) as {
            action?: "cancel" | "expire";
            run_id?: string;
          };
          const runId = cleanUuid(body.run_id);
          if (!runId) return json({ error: "Valid run_id required." }, 400);
          if (body.action !== "cancel" && body.action !== "expire") {
            return json({ error: "action must be cancel or expire." }, 400);
          }
          return json({ run: await closeProcurementRun({ runId, action: body.action }) });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
