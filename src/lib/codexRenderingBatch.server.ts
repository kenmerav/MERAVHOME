import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  measuredContext,
  MEASURED_BUCKET,
  readStored,
  writeStored,
  scopedId,
  scopedAsset,
  signedAsset,
  readAsset,
  imageMime,
} from "./measuredCloud.server";
import {
  accessFailure,
  boundedJson,
  privateJson,
  ProjectAccessError,
} from "./measuredAccess.server";
import { constructionDocuments, validateDrawingCitation } from "./constructionDrawingViews.server";
import { projectDocumentStoragePath } from "./constructionDocumentPath.server";
import { safeImageBuffer } from "./measuredImage.server";
import { codexBoardPages, type CodexBoardPage } from "./codexRenderingBoards";
import {
  codexLayoutSchema,
  checkCodexLayout,
  geometryImportProblem,
  type SavedCodexLayout,
} from "./codexRenderingLayout";
import {
  codexBatchItemSchema,
  codexBatchSelectionSchema,
  codexBatchReportSchema,
  type CodexBatchItem,
  type CodexBatchRow,
} from "./codexRenderingBatch";

const folder = (projectId: string) => `${scopedId.parse(projectId)}/codex-render-batch`;
const itemPath = (projectId: string, id: string) =>
  `${folder(projectId)}/${scopedId.parse(id)}.json`;
const resultPath = (projectId: string, id: string) =>
  itemPath(projectId, id).replace(/\.json$/, "-result.json");
const removedPath = (projectId: string, id: string) =>
  itemPath(projectId, id).replace(/\.json$/, "-removed.json");
const boardPath = (projectId: string, id: string) =>
  itemPath(projectId, id).replace(/\.json$/, "-boards.json");
const layoutPath = (projectId: string, id: string) =>
  itemPath(projectId, id).replace(/\.json$/, "-layout.json");
const layoutRevisionPath = (projectId: string, id: string, fingerprint: string) =>
  itemPath(projectId, id).replace(
    /\.json$/,
    `-layout-${z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(fingerprint)}.json`,
  );
async function boardsFor(
  projectId: string,
  roomIds: string[],
  rooms: Array<{ id: string; name: string }>,
) {
  // This existing table is not yet represented in the generated database types.
  const { data, error } = await (supabaseAdmin as unknown as SupabaseClient)
    .from("design_boards")
    .select("board_state")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return codexBoardPages(data?.board_state, roomIds, rooms);
}
export function codexBatchFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
const orderedItems = (items: CodexBatchItem["items"]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));
async function contextKey(projectId: string) {
  return codexBatchFingerprint(
    (await constructionDocuments(projectId)).sort((a, b) => a.id.localeCompare(b.id)),
  );
}
async function load(projectId: string, id: string) {
  const value = await readStored(itemPath(projectId, id));
  if (!value) throw new ProjectAccessError("Batch view not found.", 404);
  const item = codexBatchItemSchema.parse(value);
  if (item.projectId !== projectId || item.id !== id)
    throw new ProjectAccessError("Batch scope mismatch.");
  return item;
}
async function current(request: Request, item: CodexBatchItem) {
  const ctx = await measuredContext(request, item.projectId, item.roomId);
  await validateDrawingCitation(item.projectId, ctx.rooms, item.citation);
  if ((await contextKey(item.projectId)) !== item.contextKey)
    throw new ProjectAccessError(
      `${item.name}: Construction context changed. Add a fresh selection.`,
      409,
    );
  if (
    codexBatchFingerprint(orderedItems(ctx.items)) !==
    codexBatchFingerprint(orderedItems(item.items))
  )
    throw new ProjectAccessError(
      `${item.name}: Spec Book changed. Add a fresh selection before rendering/importing.`,
      409,
    );
  return ctx;
}
export async function codexBatchApi(request: Request, projectId: string) {
  try {
    const ctx = await measuredContext(request, projectId);
    const url = new URL(request.url);
    if (request.method === "GET") {
      if (url.searchParams.has("boardImage")) {
        const item = await load(projectId, scopedId.parse(url.searchParams.get("item")));
        if (await readStored(removedPath(projectId, item.id)))
          throw new ProjectAccessError("This view was removed.", 409);
        const snapshot = await readStored<{ pages: CodexBoardPage[] }>(
          boardPath(projectId, item.id),
        );
        const page = snapshot?.pages.find((p) => p.id === url.searchParams.get("boardPage"));
        const element = page?.elements.find(
          (e) => e.id === url.searchParams.get("boardImage") && e.type === "image",
        );
        if (!element || typeof element.src !== "string")
          throw new ProjectAccessError("Board image is not in this authorized handoff.", 404);
        const image = await safeImageBuffer(element.src);
        if (image.buffer.length > 8 * 1024 * 1024)
          throw new ProjectAccessError("Board image exceeds the 8 MB handoff limit.", 413);
        return new Response(new Uint8Array(image.buffer), {
          headers: {
            "Content-Type": image.contentType,
            "Cache-Control": "no-store",
            Vary: "Authorization",
          },
        });
      }
      // Product references are selected from a frozen, authorized batch item, never an arbitrary URL.
      if (url.searchParams.has("product")) {
        const item = await load(projectId, scopedId.parse(url.searchParams.get("item")));
        const product = item.items.find(
          (i) => i.id === scopedId.parse(url.searchParams.get("product")),
        );
        if (!product?.imageUrl) throw new ProjectAccessError("Product photo unavailable.", 404);
        const image = await safeImageBuffer(product.imageUrl);
        if (image.buffer.length > 4 * 1024 * 1024)
          throw new ProjectAccessError(
            "Product photo exceeds pilot transfer limit. Review it separately.",
            413,
          );
        return new Response(new Uint8Array(image.buffer), {
          headers: {
            "Content-Type": image.contentType,
            "Cache-Control": "no-store",
            Vary: "Authorization",
          },
        });
      }
      const listing = await supabaseAdmin.storage
        .from(MEASURED_BUCKET)
        .list(folder(projectId), { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
      if (listing.error) throw listing.error;
      if ((listing.data || []).length >= 1000)
        throw new ProjectAccessError("Pilot batch storage limit reached.", 409);
      const rows = await Promise.all(
        (listing.data || [])
          .filter((f) => /^[0-9a-f-]{36}\.json$/.test(f.name))
          .map(async (f) => {
            const item = await load(projectId, f.name.slice(0, -5));
            if (await readStored(removedPath(projectId, item.id))) return null;
            const result = await readStored<NonNullable<CodexBatchRow["result"]>>(
              resultPath(projectId, item.id),
            );
            return {
              ...item,
              layout:
                (await readStored<SavedCodexLayout>(
                  result?.report.geometryReview
                    ? layoutRevisionPath(
                        projectId,
                        item.id,
                        result.report.geometryReview.fingerprint,
                      )
                    : layoutPath(projectId, item.id),
                )) || undefined,
              sourceUrl: await signedAsset(projectId, item.roomId, item.sourcePath),
              result: result
                ? {
                    ...result,
                    imageUrl: result.imagePath
                      ? await signedAsset(projectId, item.roomId, result.imagePath)
                      : undefined,
                  }
                : undefined,
            };
          }),
      );
      return privateJson({ rows: rows.filter(Boolean), rooms: ctx.rooms });
    }
    const body = (await boundedJson(request, 256 * 1024)) as any;
    if (body.action === "add") {
      const selection = codexBatchSelectionSchema.parse(body);
      const room = await measuredContext(request, projectId, selection.roomId);
      const citation = await validateDrawingCitation(projectId, room.rooms, selection.citation);
      scopedAsset(projectId, selection.roomId, selection.sourcePath);
      imageMime(await readAsset(projectId, selection.roomId, selection.sourcePath));
      const snapshot = {
        ...selection,
        citation,
        items: orderedItems(room.items),
        contextKey: await contextKey(projectId),
      };
      const fingerprint = codexBatchFingerprint(snapshot);
      const existing = await readStored<CodexBatchItem>(itemPath(projectId, selection.id));
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ProjectAccessError("This selection ID is already in use.", 409);
        return privateJson({ item: existing });
      }
      const item = codexBatchItemSchema.parse({
        ...snapshot,
        fingerprint,
        version: 1,
        provider: "codex-subscription",
        projectId,
        roomName: room.rooms.find((r) => r.id === selection.roomId)!.name,
        createdAt: new Date().toISOString(),
        geometryRequired: true,
      });
      await writeStored(itemPath(projectId, item.id), item);
      return privateJson({ item }, 201);
    }
    if (body.action === "remove") {
      const item = await load(projectId, scopedId.parse(body.id));
      if (!(await readStored(removedPath(projectId, item.id))))
        await writeStored(removedPath(projectId, item.id), { removedAt: new Date().toISOString() });
      return privateJson({ removed: true });
    }
    if (body.action === "layout") {
      const layout = codexLayoutSchema.parse(body.layout);
      const item = await load(projectId, layout.itemId);
      if (
        (await readStored(removedPath(projectId, item.id))) ||
        (await readStored(resultPath(projectId, item.id)))
      )
        throw new ProjectAccessError(
          "Keep completed/removed versions intact. Add a new selection to revise its layout.",
          409,
        );
      await current(request, item);
      const documents = await constructionDocuments(projectId);
      const checked = checkCodexLayout(
        layout,
        item,
        documents.map((d) => d.id),
      );
      const saved: SavedCodexLayout = {
        layout,
        fingerprint: codexBatchFingerprint(layout),
        ...checked,
        savedAt: new Date().toISOString(),
      };
      // Keep immutable revisions as well as the current pointer. No schema/bucket change.
      const revisionPath = layoutRevisionPath(projectId, item.id, saved.fingerprint);
      if (!(await readStored(revisionPath))) await writeStored(revisionPath, saved);
      await writeStored(layoutPath(projectId, item.id), saved, true);
      return privateJson({ layout: saved });
    }
    if (body.action === "prepare") {
      const ids = z.array(scopedId).min(1).max(20).parse(body.ids);
      if (new Set(ids).size !== ids.length)
        throw new ProjectAccessError("Choose each view once.", 400);
      const items = [];
      for (const id of ids) {
        const item = await load(projectId, id);
        if (await readStored(removedPath(projectId, id)))
          throw new ProjectAccessError("A selected view was removed.", 409);
        if (await readStored(resultPath(projectId, id)))
          throw new ProjectAccessError(
            "This view already has a reviewed result. Add a new selection for another run.",
            409,
          );
        await current(request, item);
        items.push({
          ...item,
          sourceUrl: await signedAsset(projectId, item.roomId, item.sourcePath),
        });
      }
      // Preserve full PDFs, including context beyond the selected crops. No paid drawing scan.
      const documents = await constructionDocuments(projectId);
      const refs = [];
      for (const doc of documents) {
        const id = doc.id;
        const path = projectDocumentStoragePath(
          doc.file_url,
          projectId,
          process.env.SUPABASE_URL || "",
        );
        const signed = await supabaseAdmin.storage
          .from("project-files")
          .createSignedUrl(path, 3600);
        if (signed.error) throw signed.error;
        refs.push({ id, title: doc.title, url: signed.data.signedUrl });
      }
      const boardPages = await boardsFor(
        projectId,
        items.map((i) => i.roomId),
        ctx.rooms,
      );
      const preparedItems = [];
      for (const item of items) {
        const pages = codexBoardPages({ pages: boardPages }, [item.roomId], ctx.rooms);
        const fingerprint = codexBatchFingerprint(pages);
        const existing = await readStored<{ fingerprint: string }>(boardPath(projectId, item.id));
        if (existing && existing.fingerprint !== fingerprint)
          throw new ProjectAccessError(
            `${item.name}: Design board changed. Add a fresh selection.`,
            409,
          );
        if (!existing) await writeStored(boardPath(projectId, item.id), { fingerprint, pages });
        preparedItems.push({
          ...item,
          layout: (await readStored<SavedCodexLayout>(layoutPath(projectId, item.id))) || undefined,
          boardFingerprint: fingerprint,
          boardPageIds: pages.map((p) => p.id),
        });
      }
      return privateJson({
        items: preparedItems,
        documents: refs,
        designBoards: boardPages,
        designBoardUrl: `https://studio.meravinteriors.com/projects/${projectId}/design-board-presentation`,
        projectName: ctx.projectName,
        projectId,
      });
    }
    if (body.action === "result") {
      const report = codexBatchReportSchema.parse(body.report);
      const item = await load(projectId, report.itemId);
      if (report.fingerprint !== item.fingerprint)
        throw new ProjectAccessError("Result belongs to a different selection snapshot.", 409);
      if (await readStored(removedPath(projectId, item.id)))
        throw new ProjectAccessError("This view was removed.", 409);
      await current(request, item);
      const layout = await readStored<SavedCodexLayout>(layoutPath(projectId, item.id));
      if (layout) {
        const checked = checkCodexLayout(
          layout.layout,
          item,
          (await constructionDocuments(projectId)).map((d) => d.id),
        );
        layout.ready = checked.ready;
        if (layout.fingerprint !== codexBatchFingerprint(layout.layout))
          throw new ProjectAccessError("Layout fingerprint is invalid. Save a fresh layout.", 409);
      }
      const boardSnapshot = await readStored<{ fingerprint: string; pages: CodexBoardPage[] }>(
        boardPath(projectId, item.id),
      );
      if (boardSnapshot) {
        const pages = await boardsFor(projectId, [item.roomId], ctx.rooms);
        if (codexBatchFingerprint(pages) !== boardSnapshot.fingerprint)
          throw new ProjectAccessError(
            `${item.name}: Design board changed after handoff. Add a fresh selection.`,
            409,
          );
        if (
          !report.boardReview ||
          !report.enclosureReview ||
          report.boardReview.fingerprint !== boardSnapshot.fingerprint ||
          JSON.stringify([...report.boardReview.pageIds].sort()) !==
            JSON.stringify(boardSnapshot.pages.map((p) => p.id).sort())
        )
          throw new ProjectAccessError(
            "Review the frozen design boards and shower enclosure before importing.",
            400,
          );
        if (report.status === "review" && report.enclosureReview.status === "blocked")
          throw new ProjectAccessError(
            "An unresolved enclosure must remain blocked, not a reviewed image.",
            400,
          );
      }
      const documentsForReview = await constructionDocuments(projectId);
      if (
        !report.sourcePages.some(
          (p) => p.documentId === item.citation.documentId && p.page === item.citation.page,
        ) ||
        report.sourcePages.some((p) => !documentsForReview.some((d) => d.id === p.documentId))
      )
        throw new ProjectAccessError(
          "Review must cite the selected sheet and the included construction document.",
          400,
        );
      const geometryProblem = geometryImportProblem(item.geometryRequired, layout, report);
      if (geometryProblem) throw new ProjectAccessError(geometryProblem, 400);
      const imagePath = body.imagePath
        ? scopedAsset(projectId, item.roomId, z.string().parse(body.imagePath))
        : undefined;
      if (report.status === "review" && !imagePath)
        throw new ProjectAccessError("Attach the reviewed image.", 400);
      if (
        imagePath &&
        imageMime(await readAsset(projectId, item.roomId, imagePath)) !== "image/png"
      )
        throw new ProjectAccessError("Import a PNG image.", 400);
      const existing = await readStored(resultPath(projectId, item.id));
      if (existing) return privateJson({ saved: true, alreadySaved: true });
      await writeStored(resultPath(projectId, item.id), {
        report,
        imagePath,
        createdAt: new Date().toISOString(),
      });
      return privateJson({ saved: true });
    }
    throw new ProjectAccessError("Unknown batch action.", 400);
  } catch (error) {
    return accessFailure(error);
  }
}
