import { z } from "zod";
import { start } from "workflow/api";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  requireProjectAccess,
  boundedJson,
  privateJson,
  accessFailure,
  ProjectAccessError,
} from "./measuredAccess.server";
import { canViewProjectSurface } from "./permissions";
import { projectDocumentStoragePath } from "./constructionDocumentPath.server";
import {
  currentDrawingMatchSource,
  productionDrawingMatchStore,
  quantityDrawingKey,
} from "./specDrawingMatchStore.server";
import type { DrawingMatchJob, DrawingMatchReport } from "./specDrawingMatches";
import { loadDrawingMatchReport, failDrawingMatchJob } from "./specDrawingMatchEngine.server";
import { specDrawingMatchesWorkflow } from "@/workflows/specDrawingMatches";
import { applyDrawingQuantities } from "./specQuantityApproval.server";
import { canRunPaidSpecCheck } from "./specCheckAccess";
import { assertProductionFullSpecBudget } from "./fullSpecBudget.server";
import { FullSpecBudgetError } from "./fullSpecBudget";
const admin = supabaseAdmin as any;
const BUCKET = "rendering-studio-files";
export async function specDrawingMatchesApi(request: Request) {
  try {
    const url = new URL(request.url);
    const body =
      request.method === "POST"
        ? z
            .object({
              projectId: z.string().uuid(),
              expectedKey: z.string().regex(/^[a-f0-9]{64}$/),
              purpose: z.enum(["quantities"]).optional(),
              attempt: z.number().int().min(0).max(5).optional(),
              action: z.enum(["apply"]).optional(),
              itemIds: z.array(z.string().uuid()).min(1).max(100).optional(),
              full_check_run_id: z.string().uuid().optional(),
            })
            .strict()
            .parse(await boundedJson(request))
        : null;
    const projectId = z
      .string()
      .uuid()
      .parse(body?.projectId || url.searchParams.get("projectId"));
    const purpose = body?.purpose || (url.searchParams.get("purpose") === "quantities" ? "quantities" : undefined);
    if (body?.action === "apply" && (purpose !== "quantities" || !body.itemIds?.length))
      throw new ProjectAccessError("Choose quantity findings to approve.", 400);
    if (body?.itemIds && body.action !== "apply") throw new ProjectAccessError("Invalid drawing review request.", 400);
    const attempt = purpose === "quantities" ? z.coerce.number().int().min(0).max(5).parse(body?.attempt ?? url.searchParams.get("attempt") ?? 0) : 0;
    const actor = await requireProjectAccess(
      request,
      projectId,
      "specBook",
      request.method === "POST" || purpose === "quantities",
    );
    if (!canViewProjectSurface(actor.profile, actor.project, "constructionDocs"))
      throw new ProjectAccessError("Construction drawings are not shared with your account.");
    const canRunQuantityScan = purpose !== "quantities" || canRunPaidSpecCheck(actor.user, actor.profile);
    if (body && purpose === "quantities" && body.action !== "apply" && !canRunQuantityScan)
      throw new ProjectAccessError("The paid full Spec Book check is currently available only to Ken’s active Studio account.");
    if (body && purpose === "quantities" && body.action !== "apply") {
      if (!body.full_check_run_id) throw new ProjectAccessError("Start a budgeted full project check before scanning drawings.", 400);
      try { await assertProductionFullSpecBudget(projectId, actor.user.id, body.full_check_run_id); }
      catch (error) { throw new ProjectAccessError(error instanceof FullSpecBudgetError ? error.message : "The check budget could not be confirmed.", 409); }
    }
    // The existing bucket stays private; no schema or public-bucket change.
    const bucket = await admin.storage.getBucket(BUCKET);
    if (bucket.error || !bucket.data || bucket.data.public !== false)
      throw Error("The private drawing cache is unavailable.");
    const source = await currentDrawingMatchSource(projectId, purpose);
    const key = purpose === "quantities" && source.key ? quantityDrawingKey(source.key, attempt) : source.key;
    if (!source.document)
      return privateJson({
        key: "",
        status: "no_document",
        document: null,
        totalPages: 0,
        reviewedPages: [],
        matches: [],
        uncertainties: [],
        completedChunks: 0,
        totalChunks: 0,
        canScan: actor.staff && canRunQuantityScan,
      } satisfies DrawingMatchReport);
    if (body && body.expectedKey !== key)
      throw new ProjectAccessError(
        "The construction document or selections changed. Refresh before starting the scan.",
        409,
      );
    if (body?.action === "apply") return privateJson(await applyDrawingQuantities(projectId, body.expectedKey, attempt, body.itemIds!));
    const store = productionDrawingMatchStore(projectId);
    if (body) {
      if (!source.items.length)
        throw new ProjectAccessError(
          "Add current Spec Book selections before matching drawings.",
          400,
        );
      const job: DrawingMatchJob = {
        version: 1,
        mode: purpose === "quantities" ? "ai" : "direct",
        ...(purpose === "quantities" ? { purpose, quantityAttempt: attempt, fullCheckRunId: body.full_check_run_id } : {}),
        key,
        projectId,
        document: source.document,
        items: source.items,
        createdAt: new Date().toISOString(),
        createdBy: actor.user.id,
        status: "queued",
      };
      const created = await store.write(`${key}/job.json`, job, true);
      if (created) {
        try {
          await start(specDrawingMatchesWorkflow, [projectId, key]);
        } catch {
          await failDrawingMatchJob(
            store,
            key,
            "The background scan could not be confirmed. Saved request claims prevent an automatic repeat.",
          );
        }
      }
    }
    let report = await loadDrawingMatchReport(store, key);
    if (!body && !report && purpose === "quantities" && source.legacyKey) {
      const legacy = await loadDrawingMatchReport(store, quantityDrawingKey(source.legacyKey, attempt));
      if (legacy) report = { ...legacy, needsFreshScan: true, freshKey: key };
    }
    report = report ||
      ({
        key,
        status: "unread",
        document: {
          id: source.document.id,
          title: source.document.title,
          updated_at: source.document.updated_at,
        },
        totalPages: 0,
        reviewedPages: [],
        matches: [],
        uncertainties: [],
        completedChunks: 0,
        totalChunks: 0,
      } satisfies DrawingMatchReport);
    if (report.status === "complete" || report.matches.length) {
      const path = projectDocumentStoragePath(
        source.document.file_url,
        projectId,
        process.env.SUPABASE_URL || "",
      );
      const signed = await admin.storage.from("project-files").createSignedUrl(path, 900);
      if (signed.error) throw signed.error;
      report.documentUrl = signed.data.signedUrl;
    }
    return privateJson({ ...report, canScan: actor.staff && canRunQuantityScan });
  } catch (error) {
    return accessFailure(error);
  }
}
