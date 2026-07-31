import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import type { PDFParse } from "pdf-parse";
import pdfWorkerSource from "pdfjs-dist/legacy/build/pdf.worker.mjs?raw";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensurePdfJsServerGlobals } from "@/lib/pdfJsServerGlobals";
import {
  ROOM_IMAGE_BUCKET,
  uploadRoomImageBufferAtPath,
} from "@/lib/roomImageStorage.server";
import {
  renderingImportPagePath,
  renderingImportSlideKey,
} from "@/lib/renderingPdfImport";

const PROJECT_FILES_BUCKET = "project-files";
const PROJECT_FILE_LIMIT = 50 * 1024 * 1024;
const MAX_IMPORT_PAGES = 100;
const RENDERED_PAGE_WIDTHS = [3200, 2800, 2400];

type ImportAction = "prepare" | "inspect" | "extract-page" | "confirm";

type ConfirmPage = {
  fileHash?: string;
  pageNumber?: number;
  roomId?: string;
  caption?: string;
  linkedSketchupId?: string | null;
  approved?: boolean;
  presentationVisible?: boolean;
  presentationOrder?: number;
};

type ConfirmSource = {
  path?: string;
  url?: string;
  fileName?: string;
  fileSize?: number;
  fileHash?: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeFileName(fileName?: string) {
  return (
    (fileName || "rendering-import")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "rendering-import"
  );
}

function isSourcePathForProject(projectId: string, path: string) {
  return (
    path.startsWith(`${projectId}/rendering-imports/source/`) &&
    !path.includes("..") &&
    path.toLowerCase().endsWith(".pdf")
  );
}

function validHash(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

async function requireStudioUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in to import rendering PDFs." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: json({ error: "Your session is no longer valid." }, 401) };
  }

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile?.is_active || !["Admin", "Employee"].includes(String(profile.role))) {
    return { error: json({ error: "Only MERAV team members can import renderings." }, 403) };
  }

  return { user: userData.user };
}

async function requireProject(projectId: string) {
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!data) throw new Error("Project not found.");
}

async function ensureProjectFilesBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(PROJECT_FILES_BUCKET);
  if (data) {
    const { error } = await supabaseAdmin.storage.updateBucket(PROJECT_FILES_BUCKET, {
      public: true,
      fileSizeLimit: PROJECT_FILE_LIMIT,
      allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
    });
    if (error) throw error;
    return;
  }

  const { error } = await supabaseAdmin.storage.createBucket(PROJECT_FILES_BUCKET, {
    public: true,
    fileSizeLimit: PROJECT_FILE_LIMIT,
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function downloadSourcePdf(projectId: string, path: string) {
  if (!isSourcePathForProject(projectId, path)) throw new Error("Invalid rendering PDF path.");
  const { data, error } = await supabaseAdmin.storage.from(PROJECT_FILES_BUCKET).download(path);
  if (error || !data) throw error || new Error("Rendering PDF could not be loaded.");
  if (data.size > PROJECT_FILE_LIMIT) throw new Error("Rendering PDF exceeds the 50 MB limit.");
  return Buffer.from(await data.arrayBuffer());
}

async function createPdfParser(data: Buffer) {
  await ensurePdfJsServerGlobals();
  const { PDFParse } = await import("pdf-parse");
  PDFParse.setWorker(
    `data:text/javascript;base64,${Buffer.from(pdfWorkerSource).toString("base64")}`,
  );
  return new PDFParse({ data });
}

function fileHash(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

async function listExistingImportedPages(projectId: string, hash: string) {
  const { data: rooms } = await supabaseAdmin
    .from("rooms")
    .select("id")
    .eq("project_id", projectId);
  const roomIds = (rooms ?? []).map((room) => room.id);
  if (!roomIds.length) return new Map<number, Record<string, unknown>>();

  const { data: images } = await supabaseAdmin
    .from("room_images")
    .select("id,room_id,url,caption,is_approved,review_status")
    .in("room_id", roomIds)
    .like("url", `%/rendering-imports/${projectId}/${hash}/page-%`);

  const byPage = new Map<number, Record<string, unknown>>();
  for (const image of images ?? []) {
    const match = String(image.url).match(/\/page-(\d+)\.png(?:\?|$)/);
    const pageNumber = match ? Number(match[1]) : NaN;
    if (Number.isFinite(pageNumber)) byPage.set(pageNumber, image as Record<string, unknown>);
  }
  return byPage;
}

async function pageObjectExists(projectId: string, hash: string, pageNumber: number) {
  const directory = `rendering-imports/${projectId}/${hash}`;
  const fileName = `page-${String(pageNumber).padStart(4, "0")}.png`;
  const { data, error } = await supabaseAdmin.storage
    .from(ROOM_IMAGE_BUCKET)
    .list(directory, { limit: 10, search: fileName });
  if (error) throw error;
  return Boolean(data?.some((item) => item.name === fileName));
}

async function renderPageAsPng(data: Buffer, pageNumber: number) {
  for (const desiredWidth of RENDERED_PAGE_WIDTHS) {
    let parser: PDFParse | null = null;
    try {
      parser = await createPdfParser(data);
      const result = await parser.getScreenshot({
        partial: [pageNumber],
        desiredWidth,
        imageDataUrl: false,
        imageBuffer: true,
      });
      const page = result.pages[0];
      if (!page?.data?.length) throw new Error(`PDF page ${pageNumber} could not be rendered.`);
      const buffer = Buffer.from(page.data);
      if (buffer.byteLength <= 19 * 1024 * 1024) {
        return {
          buffer,
          width: page.width,
          height: page.height,
        };
      }
    } finally {
      await parser?.destroy();
    }
  }
  throw new Error(`PDF page ${pageNumber} is too large after high-quality extraction.`);
}

function normalizePresentationOrder(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  return value.filter((item): item is string => {
    if (typeof item !== "string" || !item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

async function addSlidesToPresentationOrder(
  projectId: string,
  updatedBy: string,
  slides: Array<{ slideKey: string; order: number }>,
) {
  if (!slides.length) return true;
  const orderedSlides = [...slides].sort((a, b) => a.order - b.order);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: boardResult, error: boardError } = await supabaseAdmin
      .from("design_boards" as any)
      .select("board_state,updated_at")
      .eq("project_id", projectId)
      .maybeSingle();
    if (boardError) throw boardError;
    const board = boardResult as {
      board_state: unknown;
      updated_at: string;
    } | null;

    const boardState =
      board?.board_state && typeof board.board_state === "object"
        ? (board.board_state as Record<string, unknown>)
        : { pages: [], selectedPageId: "" };
    const currentOrder = normalizePresentationOrder(boardState.presentationSlideOrder);
    if (!currentOrder.includes("cover")) currentOrder.unshift("cover");
    for (const slide of orderedSlides) {
      const existingIndex = currentOrder.indexOf(slide.slideKey);
      if (existingIndex >= 0) currentOrder.splice(existingIndex, 1);
      currentOrder.push(slide.slideKey);
    }

    const nextState = { ...boardState, presentationSlideOrder: currentOrder };
    if (!board) {
      const { error } = await supabaseAdmin.from("design_boards" as any).insert({
        project_id: projectId,
        board_state: nextState,
        updated_by: updatedBy,
      } as any);
      if (!error || error.code === "23505") {
        if (!error) return true;
        continue;
      }
      throw error;
    }

    const { data: saved, error } = await supabaseAdmin
      .from("design_boards" as any)
      .update({ board_state: nextState, updated_by: updatedBy } as any)
      .eq("project_id", projectId)
      .eq("updated_at", board.updated_at)
      .select("project_id")
      .maybeSingle();
    if (error) throw error;
    if (saved) return true;
  }

  return false;
}

async function saveSourceDocuments(
  projectId: string,
  userId: string,
  sources: ConfirmSource[],
) {
  for (const source of sources) {
    const path = String(source.path || "");
    const url = String(source.url || "");
    const name = String(source.fileName || "Rendering Import.pdf");
    const hash = String(source.fileHash || "");
    if (
      !isSourcePathForProject(projectId, path) ||
      !url ||
      !validHash(hash) ||
      !name.toLowerCase().endsWith(".pdf")
    ) {
      continue;
    }

    const { data: existing } = await supabaseAdmin
      .from("project_documents" as any)
      .select("id")
      .eq("project_id", projectId)
      .eq("file_url", url)
      .maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from("project_documents" as any).insert({
      project_id: projectId,
      title: `${name.replace(/\.pdf$/i, "")} - Rendering Source`,
      document_type: "AI Rendering",
      file_url: url,
      file_name: name,
      file_size: Number(source.fileSize) || null,
      mime_type: "application/pdf",
      visible_to_contractors: false,
      visible_to_clients: false,
      created_by: userId,
    } as any);
    if (error) throw error;
  }
}

async function confirmImport(
  projectId: string,
  userId: string,
  pages: ConfirmPage[],
  sources: ConfirmSource[],
) {
  if (!pages.length || pages.length > MAX_IMPORT_PAGES) {
    throw new Error(`Choose between 1 and ${MAX_IMPORT_PAGES} rendering pages.`);
  }

  const { data: rooms } = await supabaseAdmin
    .from("rooms")
    .select("id")
    .eq("project_id", projectId);
  const roomIds = new Set((rooms ?? []).map((room) => room.id));
  const requestedRoomIds = Array.from(
    new Set(pages.map((page) => String(page.roomId || "")).filter(Boolean)),
  );
  if (requestedRoomIds.some((roomId) => !roomIds.has(roomId))) {
    throw new Error("One or more selected rooms do not belong to this project.");
  }

  const linkedIds = Array.from(
    new Set(pages.map((page) => String(page.linkedSketchupId || "")).filter(Boolean)),
  );
  const linkedById = new Map<string, { id: string; room_id: string }>();
  if (linkedIds.length) {
    const { data: sketchups } = await supabaseAdmin
      .from("room_images")
      .select("id,room_id,kind")
      .in("id", linkedIds);
    for (const sketchup of sketchups ?? []) {
      if (sketchup.kind === "sketchup") linkedById.set(sketchup.id, sketchup);
    }
  }

  const { data: existingRoomImages } = roomIds.size
    ? await supabaseAdmin
        .from("room_images")
        .select("id,room_id,url,sort_order,linked_sketchup_id,revision_number")
        .in("room_id", Array.from(roomIds))
    : { data: [] };
  const existingByUrl = new Map(
    (existingRoomImages ?? []).map((image) => [String(image.url), image]),
  );
  const nextSortByRoom = new Map<string, number>();
  for (const roomId of requestedRoomIds) {
    const maxSort = Math.max(
      -1,
      ...(existingRoomImages ?? [])
        .filter((image) => image.room_id === roomId)
        .map((image) => Number(image.sort_order) || 0),
    );
    nextSortByRoom.set(roomId, maxSort + 1);
  }
  const nextRevisionBySketchup = new Map<string, number>();
  for (const linkedSketchupId of linkedIds) {
    const maxRevision = Math.max(
      0,
      ...(existingRoomImages ?? [])
        .filter((image) => image.linked_sketchup_id === linkedSketchupId)
        .map((image) => Number(image.revision_number) || 1),
    );
    nextRevisionBySketchup.set(linkedSketchupId, maxRevision + 1);
  }

  const results: Array<Record<string, unknown>> = [];
  const presentationSlides: Array<{ slideKey: string; order: number }> = [];
  const sortedPages = [...pages].sort(
    (a, b) => Number(a.presentationOrder || 0) - Number(b.presentationOrder || 0),
  );

  for (const page of sortedPages) {
    const hash = String(page.fileHash || "");
    const pageNumber = Number(page.pageNumber);
    const roomId = String(page.roomId || "");
    const linkedSketchupId = page.linkedSketchupId
      ? String(page.linkedSketchupId)
      : null;

    try {
      if (!validHash(hash) || !Number.isInteger(pageNumber) || pageNumber < 1) {
        throw new Error("Invalid PDF page identity.");
      }
      if (!roomIds.has(roomId)) throw new Error("Choose a room for this page.");
      if (
        linkedSketchupId &&
        linkedById.get(linkedSketchupId)?.room_id !== roomId
      ) {
        throw new Error("The linked SketchUp source must belong to the selected room.");
      }

      const path = renderingImportPagePath(projectId, hash, pageNumber);
      const { data: publicData } = supabaseAdmin.storage
        .from(ROOM_IMAGE_BUCKET)
        .getPublicUrl(path);
      const imageUrl = publicData.publicUrl;
      const duplicate = existingByUrl.get(imageUrl);
      if (duplicate) {
        results.push({
          pageNumber,
          fileHash: hash,
          status: "duplicate",
          imageId: duplicate.id,
          roomId: duplicate.room_id,
          message: "This PDF page is already in the project.",
        });
        continue;
      }
      if (!(await pageObjectExists(projectId, hash, pageNumber))) {
        throw new Error("Extracted page image is missing. Retry this page before importing.");
      }

      const revisionNumber = linkedSketchupId
        ? nextRevisionBySketchup.get(linkedSketchupId) ?? 1
        : 1;
      if (linkedSketchupId) {
        nextRevisionBySketchup.set(linkedSketchupId, revisionNumber + 1);
      }
      const sortOrder = nextSortByRoom.get(roomId) ?? 0;
      nextSortByRoom.set(roomId, sortOrder + 1);

      const approved = page.approved !== false;
      const presentationVisible = page.presentationVisible !== false;
      const { data: inserted, error } = await supabaseAdmin
        .from("room_images")
        .insert({
          room_id: roomId,
          kind: "rendering",
          url: imageUrl,
          caption: String(page.caption || "").trim() || `Imported rendering - Page ${pageNumber}`,
          linked_sketchup_id: linkedSketchupId,
          sort_order: sortOrder,
          status: "complete",
          role: "single_hero",
          is_favorite: false,
          is_approved: approved,
          presentation_visible: presentationVisible,
          review_status: approved ? "approved" : "draft",
          revision_number: revisionNumber,
        })
        .select("id,room_id,url,caption,is_approved,review_status")
        .single();
      if (error || !inserted) throw error || new Error("Rendering record was not created.");

      existingByUrl.set(imageUrl, inserted as any);
      results.push({
        pageNumber,
        fileHash: hash,
        status: "imported",
        imageId: inserted.id,
        roomId: inserted.room_id,
      });
      if (approved && presentationVisible) {
        presentationSlides.push({
          slideKey: renderingImportSlideKey(inserted.room_id, inserted.id),
          order: Number(page.presentationOrder) || pageNumber,
        });
      }
    } catch (error) {
      results.push({
        pageNumber,
        fileHash: hash,
        status: "failed",
        message: error instanceof Error ? error.message : "Page import failed.",
      });
    }
  }

  const importedCount = results.filter((result) => result.status === "imported").length;
  const warnings: string[] = [];
  if (importedCount) {
    try {
      await saveSourceDocuments(projectId, userId, sources);
    } catch {
      warnings.push("Rendering pages imported, but the original PDF was not added to project documents.");
    }
  }
  let presentationOrderSaved = true;
  try {
    presentationOrderSaved = await addSlidesToPresentationOrder(
      projectId,
      userId,
      presentationSlides,
    );
  } catch {
    presentationOrderSaved = false;
  }
  if (!presentationOrderSaved) {
    warnings.push(
      "Rendering pages imported, but their presentation order could not be saved.",
    );
  }

  return {
    results,
    importedCount,
    duplicateCount: results.filter((result) => result.status === "duplicate").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    presentationOrderSaved,
    warnings,
  };
}

export const Route = createFileRoute("/api/import-rendering-pdf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireStudioUser(request);
          if ("error" in access) return access.error;

          const body = (await request.json()) as Record<string, unknown>;
          const action = String(body.action || "") as ImportAction;
          const projectId = String(body.projectId || "");
          if (!projectId) return json({ error: "projectId is required." }, 400);
          await requireProject(projectId);

          if (action === "prepare") {
            const fileName = String(body.fileName || "");
            const fileSize = Number(body.fileSize);
            if (!fileName.toLowerCase().endsWith(".pdf")) {
              return json({ error: "Choose a PDF rendering file." }, 400);
            }
            if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > PROJECT_FILE_LIMIT) {
              return json({ error: "Rendering PDFs must be between 1 byte and 50 MB." }, 400);
            }

            await ensureProjectFilesBucket();
            const path =
              `${projectId}/rendering-imports/source/${Date.now()}-${crypto.randomUUID()}-` +
              `${safeFileName(fileName)}.pdf`;
            const { data: upload, error } = await supabaseAdmin.storage
              .from(PROJECT_FILES_BUCKET)
              .createSignedUploadUrl(path);
            if (error) throw error;
            const { data: publicData } = supabaseAdmin.storage
              .from(PROJECT_FILES_BUCKET)
              .getPublicUrl(path);
            return json({
              path,
              token: upload.token,
              url: publicData.publicUrl,
              contentType: "application/pdf",
            });
          }

          if (action === "inspect") {
            const path = String(body.path || "");
            const data = await downloadSourcePdf(projectId, path);
            const hash = fileHash(data);
            let parser: PDFParse | null = null;
            try {
              parser = await createPdfParser(data);
              const textResult = await parser.getText();
              if (!textResult.total || textResult.total > MAX_IMPORT_PAGES) {
                return json(
                  { error: `Rendering PDFs must contain 1 to ${MAX_IMPORT_PAGES} pages.` },
                  400,
                );
              }
              const existing = await listExistingImportedPages(projectId, hash);
              return json({
                fileHash: hash,
                pageCount: textResult.total,
                pages: textResult.pages.map((page) => ({
                  pageNumber: page.num,
                  text: page.text || "",
                  duplicate: existing.get(page.num) ?? null,
                })),
              });
            } finally {
              await parser?.destroy();
            }
          }

          if (action === "extract-page") {
            const path = String(body.path || "");
            const expectedHash = String(body.fileHash || "");
            const pageNumber = Number(body.pageNumber);
            if (!validHash(expectedHash) || !Number.isInteger(pageNumber) || pageNumber < 1) {
              return json({ error: "Invalid PDF page request." }, 400);
            }

            const data = await downloadSourcePdf(projectId, path);
            if (fileHash(data) !== expectedHash) {
              return json({ error: "The uploaded PDF changed before extraction." }, 409);
            }
            const pathForPage = renderingImportPagePath(projectId, expectedHash, pageNumber);
            const { data: existingPublic } = supabaseAdmin.storage
              .from(ROOM_IMAGE_BUCKET)
              .getPublicUrl(pathForPage);
            if (await pageObjectExists(projectId, expectedHash, pageNumber)) {
              return json({
                pageNumber,
                url: existingPublic.publicUrl,
                reused: true,
              });
            }

            const rendered = await renderPageAsPng(data, pageNumber);
            const uploaded = await uploadRoomImageBufferAtPath({
              buffer: rendered.buffer,
              contentType: "image/png",
              path: pathForPage,
            });
            return json({
              pageNumber,
              url: uploaded.publicUrl,
              width: rendered.width,
              height: rendered.height,
              bytes: rendered.buffer.byteLength,
              reused: uploaded.alreadyExisted,
            });
          }

          if (action === "confirm") {
            const pages = Array.isArray(body.pages) ? (body.pages as ConfirmPage[]) : [];
            const sources = Array.isArray(body.sources) ? (body.sources as ConfirmSource[]) : [];
            return json(await confirmImport(projectId, access.user.id, pages, sources));
          }

          return json({ error: "Unknown rendering PDF import action." }, 400);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Rendering PDF import failed.";
          return json({ error: message }, 500);
        }
      },
    },
  },
});
