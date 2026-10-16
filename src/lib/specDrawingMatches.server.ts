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
} from "./specDrawingMatchStore.server";
import type { DrawingMatchJob, DrawingMatchReport } from "./specDrawingMatches";
import { loadDrawingMatchReport, failDrawingMatchJob } from "./specDrawingMatchEngine.server";
import { specDrawingMatchesWorkflow } from "@/workflows/specDrawingMatches";
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
            })
            .strict()
            .parse(await boundedJson(request))
        : null;
    const projectId = z
      .string()
      .uuid()
      .parse(body?.projectId || url.searchParams.get("projectId"));
    const actor = await requireProjectAccess(
      request,
      projectId,
      "specBook",
      request.method === "POST",
    );
    if (!canViewProjectSurface(actor.profile, actor.project, "constructionDocs"))
      throw new ProjectAccessError("Construction drawings are not shared with your account.");
    // The existing bucket stays private; no schema or public-bucket change.
    const bucket = await admin.storage.getBucket(BUCKET);
    if (bucket.error || !bucket.data || bucket.data.public !== false)
      throw Error("The private drawing cache is unavailable.");
    const source = await currentDrawingMatchSource(projectId);
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
        canScan: actor.staff,
      } satisfies DrawingMatchReport);
    if (body && body.expectedKey !== source.key)
      throw new ProjectAccessError(
        "The construction document or selections changed. Refresh before starting the scan.",
        409,
      );
    const store = productionDrawingMatchStore(projectId);
    if (body) {
      if (!source.items.length)
        throw new ProjectAccessError(
          "Add current Spec Book selections before matching drawings.",
          400,
        );
      const job: DrawingMatchJob = {
        version: 1,
        mode: "direct",
        key: source.key,
        projectId,
        document: source.document,
        items: source.items,
        createdAt: new Date().toISOString(),
        createdBy: actor.user.id,
        status: "queued",
      };
      const created = await store.write(`${source.key}/job.json`, job, true);
      if (created) {
        try {
          await start(specDrawingMatchesWorkflow, [projectId, source.key]);
        } catch {
          await failDrawingMatchJob(
            store,
            source.key,
            "The background scan could not be confirmed. Saved request claims prevent an automatic repeat.",
          );
        }
      }
    }
    const report =
      (await loadDrawingMatchReport(store, source.key)) ||
      ({
        key: source.key,
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
    return privateJson({ ...report, canScan: actor.staff });
  } catch (error) {
    return accessFailure(error);
  }
}
