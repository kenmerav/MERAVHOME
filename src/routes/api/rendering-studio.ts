/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { strToU8, zipSync } from "fflate";
import type { PDFParse } from "pdf-parse";
import pdfWorkerSource from "pdfjs-dist/legacy/build/pdf.worker.mjs?raw";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensurePdfJsServerGlobals } from "@/lib/pdfJsServerGlobals";
import {
  buildCodexRenderingPrompt,
  matchRenderingResultFilenames,
  safeRenderingResultFilename,
  type RenderingStudioHandoffManifest,
} from "@/lib/renderingStudioWorkflow";

const FILE_BUCKET = "rendering-studio-files";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_FILES = 220;
const MAX_PDF_PAGES = 100;
const PDF_PAGE_WIDTHS = [3200, 2800, 2400];
const MAX_SPEC_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_SPEC_IMAGE_COUNT = 80;
const MAX_SPEC_IMAGE_TOTAL_BYTES = 150 * 1024 * 1024;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function safeFileName(value: string) {
  return safeRenderingResultFilename(value).replace(/^\.+/, "").slice(0, 180) || "file";
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function requireStudioUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { error: json({ error: "Sign in to use Rendering Studio." }, 401) };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return { error: json({ error: "Your Studio session is no longer valid." }, 401) };
  }
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id,role,is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.is_active || !["Admin", "Employee"].includes(String(profile.role))) {
    return {
      error: json({ error: "Only authorized MERAV team members can use Rendering Studio." }, 403),
    };
  }
  return { user: data.user, profile };
}

async function requireRenderingViewer(request: Request, projectId: string) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { error: json({ error: "Sign in to view this presentation." }, 401) };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return { error: json({ error: "Your Studio session is no longer valid." }, 401) };
  }
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id,role,is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.is_active) {
    return { error: json({ error: "This account is not active." }, 403) };
  }
  if (["Admin", "Employee"].includes(String(profile.role))) {
    return { user: data.user, profile, teamMember: true };
  }
  if (!["Client", "Contractor"].includes(String(profile.role))) {
    return { error: json({ error: "Presentation access is not available." }, 403) };
  }
  const [{ data: assignment }, { data: project, error: projectError }] = await Promise.all([
    supabaseAdmin
      .from("user_project_assignments")
      .select("project_id")
      .eq("user_id", data.user.id)
      .eq("project_id", projectId)
      .maybeSingle(),
    supabaseAdmin
      .from("projects")
      .select("id,client_can_view_presentations,contractor_can_view_presentations")
      .eq("id", projectId)
      .maybeSingle(),
  ]);
  if (projectError) throw projectError;
  const enabled =
    profile.role === "Client"
      ? project?.client_can_view_presentations === true
      : project?.contractor_can_view_presentations === true;
  if (!assignment || !enabled) {
    return {
      error: json({ error: "This presentation is not shared with your account." }, 403),
    };
  }
  return { user: data.user, profile, teamMember: false };
}

async function requireProject(projectId: string) {
  if (!validUuid(projectId)) throw new Error("Choose a valid project.");
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id,name,client_name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Project not found.");
  return data;
}

async function requireWorkflowSchema() {
  const { error } = await supabaseAdmin
    .from("rendering_studio_sources" as any)
    .select("id")
    .limit(1);
  if (!error) return;
  if (["42P01", "PGRST205", "42703"].includes(error.code)) {
    throw new Error(
      "Apply 20260724210000_complete_rendering_studio_workflow.sql before using this local workflow.",
    );
  }
  throw error;
}

let bucketReady: Promise<void> | null = null;

async function ensureFileBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const options = {
        public: false,
        fileSizeLimit: MAX_FILE_BYTES,
        allowedMimeTypes: [
          "application/pdf",
          "image/png",
          "image/jpeg",
          "image/webp",
          "application/zip",
          "application/octet-stream",
        ],
      };
      const { data, error } = await supabaseAdmin.storage.getBucket(FILE_BUCKET);
      if (error && !/not found/i.test(error.message)) throw error;
      if (data) {
        const { error: updateError } = await supabaseAdmin.storage.updateBucket(
          FILE_BUCKET,
          options,
        );
        if (updateError) throw updateError;
        return;
      }
      const { error: createError } = await supabaseAdmin.storage.createBucket(FILE_BUCKET, options);
      if (createError && !/already exists/i.test(createError.message)) throw createError;
    })().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }
  return bucketReady;
}

async function signedUrl(bucket: string, path: string, fallback = "") {
  if (!path) return fallback;
  if (bucket === "room-images") return fallback;
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (error) return fallback;
  return data.signedUrl;
}

async function downloadStoredFile(bucket: string, path: string) {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
  if (error || !data) throw error || new Error(`Could not load ${path}.`);
  return new Uint8Array(await data.arrayBuffer());
}

function imageExtension(contentType: string, sourceUrl: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("png")) return "png";
  const pathname = new URL(sourceUrl).pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "jpg";
  if (pathname.endsWith(".webp")) return "webp";
  return "png";
}

async function downloadSpecImage(sourceUrl: string) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "image/png,image/jpeg,image/webp,image/*",
        "User-Agent": "MERAVHOME-Studio/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !/^image\/(?:png|jpe?g|webp)/.test(contentType)) return null;
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_SPEC_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_SPEC_IMAGE_BYTES) return null;
    return {
      bytes,
      extension: imageExtension(contentType, sourceUrl),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function createPdfParser(data: Uint8Array) {
  await ensurePdfJsServerGlobals();
  const { PDFParse } = await import("pdf-parse");
  PDFParse.setWorker(
    `data:text/javascript;base64,${Buffer.from(pdfWorkerSource).toString("base64")}`,
  );
  return new PDFParse({ data: Buffer.from(data) });
}

async function renderPdfPage(data: Uint8Array, pageNumber: number) {
  for (const desiredWidth of PDF_PAGE_WIDTHS) {
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
      if (!page?.data?.length) {
        throw new Error(`AutoCAD PDF page ${pageNumber} could not be rendered.`);
      }
      const buffer = Buffer.from(page.data);
      if (buffer.byteLength <= 19 * 1024 * 1024) {
        return { buffer, width: page.width, height: page.height };
      }
    } finally {
      await parser?.destroy();
    }
  }
  throw new Error(`AutoCAD PDF page ${pageNumber} is too large to extract.`);
}

async function activePackage(projectId: string) {
  const { data, error } = await supabaseAdmin
    .from("rendering_studio_packages" as any)
    .select("*")
    .eq("project_id", projectId)
    .neq("workflow_status", "superseded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function createNativePackage(
  project: { id: string; name: string },
  userId: string,
  sourceLabel: string,
) {
  const now = new Date().toISOString();
  const packageHash = createHash("sha256")
    .update(`${project.id}:${now}:${randomUUID()}`)
    .digest("hex");
  const { data, error } = await supabaseAdmin
    .from("rendering_studio_packages" as any)
    .insert({
      project_id: project.id,
      source_filename: `${safeFileName(sourceLabel || project.name)}-native-workflow`,
      package_hash: packageHash,
      schema_version: "1.0",
      source_project_name: project.name,
      source_label: sourceLabel || project.name,
      generated_at: now,
      manifest: { packageType: "merav-rendering-studio-native" },
      elevation_count: 1,
      workflow_status: "source_files_uploaded",
      imported_by: userId,
    } as any)
    .select("*")
    .single();
  if (error) throw error;
  return data as any;
}

async function packageForProject(
  project: { id: string; name: string },
  userId: string,
  requestedPackageId?: string,
  sourceLabel?: string,
) {
  if (requestedPackageId) {
    const { data, error } = await supabaseAdmin
      .from("rendering_studio_packages" as any)
      .select("*")
      .eq("id", requestedPackageId)
      .eq("project_id", project.id)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as any;
  }
  return (
    (await activePackage(project.id)) ??
    (await createNativePackage(project, userId, sourceLabel || project.name))
  );
}

async function loadBootstrap(projectId: string) {
  const project = await requireProject(projectId);
  const [roomsResult, materialsResult, packagesResult, sourcesResult, elevationsResult] =
    await Promise.all([
      supabaseAdmin
        .from("rooms")
        .select("id,name,sort_order")
        .eq("project_id", projectId)
        .order("sort_order"),
      supabaseAdmin
        .from("material_items")
        .select(
          "id,room_id,item_label,cad_label,client_product_name,category,color,quantity,notes,image_url,product_url,product:products(name,vendor,finish,image_url)",
        )
        .eq("project_id", projectId)
        .or("not_needed.eq.false,not_needed.is.null"),
      supabaseAdmin
        .from("rendering_studio_packages" as any)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("rendering_studio_sources" as any)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at"),
      supabaseAdmin
        .from("rendering_studio_elevations" as any)
        .select(
          "*,room:rooms(id,name),assets:rendering_studio_assets(*),revisions:rendering_studio_revisions(*)",
        )
        .eq("project_id", projectId)
        .order("presentation_order")
        .order("created_at"),
    ]);
  for (const result of [
    roomsResult,
    materialsResult,
    packagesResult,
    sourcesResult,
    elevationsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const sources = await Promise.all(
    (sourcesResult.data ?? []).map(async (source: any) => ({
      ...source,
      url: await signedUrl(source.storage_bucket, source.storage_path),
    })),
  );
  const elevations = await Promise.all(
    (elevationsResult.data ?? []).map(async (elevation: any) => ({
      ...elevation,
      assets: await Promise.all(
        (elevation.assets ?? []).map(async (asset: any) => ({
          ...asset,
          url: await signedUrl(
            asset.storage_bucket || "room-images",
            asset.storage_path,
            asset.url,
          ),
        })),
      ),
      revisions: await Promise.all(
        (elevation.revisions ?? [])
          .sort((a: any, b: any) => b.revision_number - a.revision_number)
          .map(async (revision: any) => ({
            ...revision,
            rendering_url: await signedUrl(revision.rendering_bucket, revision.rendering_path),
            final_sheet_url:
              revision.final_sheet_bucket && revision.final_sheet_path
                ? await signedUrl(revision.final_sheet_bucket, revision.final_sheet_path)
                : null,
          })),
      ),
    })),
  );

  return {
    project,
    rooms: roomsResult.data ?? [],
    materials: materialsResult.data ?? [],
    packages: packagesResult.data ?? [],
    activePackage:
      (packagesResult.data ?? []).find((item: any) => item.workflow_status !== "superseded") ??
      null,
    sources,
    elevations,
  };
}

async function loadSharedElevations(projectId: string) {
  await requireProject(projectId);
  const { data, error } = await supabaseAdmin
    .from("rendering_studio_elevations" as any)
    .select("*,room:rooms(id,name),assets:rendering_studio_assets(*)")
    .eq("project_id", projectId)
    .eq("presentation_visible", true)
    .or("approval_status.eq.approved,review_status.eq.approved")
    .order("presentation_order")
    .order("created_at");
  if (error) throw error;
  return Promise.all(
    (data ?? []).map(async (elevation: any) => ({
      ...elevation,
      correction_note: null,
      revisions: [],
      assets: await Promise.all(
        (elevation.assets ?? []).map(async (asset: any) => ({
          ...asset,
          url: await signedUrl(
            asset.storage_bucket || "room-images",
            asset.storage_path,
            asset.url,
          ),
        })),
      ),
    })),
  );
}

async function prepareUploads(
  projectId: string,
  purpose: "source" | "result",
  files: Array<{ filename?: string; size?: number; mimeType?: string }>,
) {
  if (!files.length || files.length > MAX_UPLOAD_FILES) {
    throw new Error(`Choose between 1 and ${MAX_UPLOAD_FILES} files.`);
  }
  await ensureFileBucket();
  const uploadId = randomUUID();
  const uploads = [];
  for (const [index, file] of files.entries()) {
    const filename = safeFileName(String(file.filename || ""));
    const size = Number(file.size || 0);
    if (!filename || !size || size > MAX_FILE_BYTES) {
      throw new Error(`${filename || "A file"} must be 50 MB or smaller.`);
    }
    const path = `${projectId}/${purpose}/${uploadId}/${String(index + 1).padStart(
      4,
      "0",
    )}-${filename}`;
    const { data, error } = await supabaseAdmin.storage
      .from(FILE_BUCKET)
      .createSignedUploadUrl(path);
    if (error) throw error;
    uploads.push({
      filename: String(file.filename),
      path,
      token: data.token,
      mimeType: String(file.mimeType || "application/octet-stream"),
      size,
    });
  }
  return { bucket: FILE_BUCKET, uploadId, uploads };
}

function validatePreparedPath(projectId: string, purpose: "source" | "result", path: string) {
  const prefix = `${projectId}/${purpose}/`;
  if (!path.startsWith(prefix) || path.includes("..")) {
    throw new Error("The uploaded file path is invalid.");
  }
}

async function saveSources({
  project,
  userId,
  packageId,
  sourceLabel,
  sources,
}: {
  project: { id: string; name: string };
  userId: string;
  packageId?: string;
  sourceLabel?: string;
  sources: any[];
}) {
  const packageRow = await packageForProject(project, userId, packageId, sourceLabel);
  const rows = sources.map((source) => {
    validatePreparedPath(project.id, "source", String(source.path || ""));
    const sourceType = String(source.sourceType || "");
    if (
      !["autocad_pdf", "autocad_image", "specification_pdf", "supporting_material"].includes(
        sourceType,
      )
    ) {
      throw new Error("Choose a valid Rendering Studio source type.");
    }
    return {
      project_id: project.id,
      package_id: packageRow.id,
      source_type: sourceType,
      label: String(source.label || source.filename || "").trim(),
      filename: String(source.filename || "").trim(),
      storage_bucket: FILE_BUCKET,
      storage_path: String(source.path),
      mime_type: String(source.mimeType || "application/octet-stream"),
      file_size: Number(source.size || 0),
      page_number: source.pageNumber ? Number(source.pageNumber) : null,
      created_by: userId,
    };
  });
  const { data, error } = await supabaseAdmin
    .from("rendering_studio_sources" as any)
    .upsert(rows as any, {
      onConflict: "project_id,storage_bucket,storage_path",
    })
    .select("*");
  if (error) throw error;
  return { package: packageRow, sources: data ?? [] };
}

async function extractAutocadPdf({
  projectId,
  userId,
  sourceId,
}: {
  projectId: string;
  userId: string;
  sourceId: string;
}) {
  const { data: source, error } = await supabaseAdmin
    .from("rendering_studio_sources" as any)
    .select("*")
    .eq("id", sourceId)
    .eq("project_id", projectId)
    .eq("source_type", "autocad_pdf")
    .maybeSingle();
  if (error) throw error;
  if (!source) throw new Error("AutoCAD PDF source not found.");

  const pdf = await downloadStoredFile(source.storage_bucket, source.storage_path);
  let parser: PDFParse | null = null;
  let pageCount = 0;
  try {
    parser = await createPdfParser(pdf);
    const text = await parser.getText();
    pageCount = Number(text.total || 0);
  } finally {
    await parser?.destroy();
  }
  if (!pageCount || pageCount > MAX_PDF_PAGES) {
    throw new Error(`AutoCAD PDFs must contain 1 to ${MAX_PDF_PAGES} pages.`);
  }

  const pdfBase = safeFileName(String(source.filename).replace(/\.pdf$/i, ""));
  const rows = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const rendered = await renderPdfPage(pdf, pageNumber);
    const filename = `${pdfBase}-page-${String(pageNumber).padStart(3, "0")}.png`;
    const path = `${projectId}/source/${source.id}/pages/${filename}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(FILE_BUCKET)
      .upload(path, rendered.buffer, {
        contentType: "image/png",
        cacheControl: "31536000",
        upsert: true,
      });
    if (uploadError) throw uploadError;
    rows.push({
      project_id: projectId,
      package_id: source.package_id,
      source_type: "autocad_image",
      label: `${source.label} - Page ${pageNumber}`,
      filename,
      storage_bucket: FILE_BUCKET,
      storage_path: path,
      mime_type: "image/png",
      file_size: rendered.buffer.byteLength,
      page_number: pageNumber,
      created_by: userId,
    });
  }
  const { data, error: saveError } = await supabaseAdmin
    .from("rendering_studio_sources" as any)
    .upsert(rows as any, {
      onConflict: "project_id,storage_bucket,storage_path",
    })
    .select("*");
  if (saveError) throw saveError;
  return { pageCount, sources: data ?? [] };
}

async function deleteSourceSet({ projectId, sourceId }: { projectId: string; sourceId: string }) {
  const { data: source, error: sourceError } = await supabaseAdmin
    .from("rendering_studio_sources" as any)
    .select("id,project_id,package_id,source_type,storage_bucket,storage_path")
    .eq("id", sourceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error("Rendering Studio source not found.");
  if (source.source_type !== "autocad_pdf") {
    throw new Error("Only an AutoCAD PDF source can remove its extracted page set.");
  }

  const pagePrefix = `${projectId}/source/${source.id}/pages/`;
  const { data: pageSources, error: pageError } = await supabaseAdmin
    .from("rendering_studio_sources" as any)
    .select("id,storage_bucket,storage_path")
    .eq("project_id", projectId)
    .like("storage_path", `${pagePrefix}%`);
  if (pageError) throw pageError;

  const sourceRows = [source, ...(pageSources ?? [])];
  const storagePathsByBucket = new Map<string, string[]>();
  for (const row of sourceRows) {
    const bucket = String(row.storage_bucket || FILE_BUCKET);
    const paths = storagePathsByBucket.get(bucket) ?? [];
    paths.push(String(row.storage_path));
    storagePathsByBucket.set(bucket, paths);
  }

  const paths = sourceRows.map((row) => String(row.storage_path));
  const { data: assets, error: assetLookupError } = await supabaseAdmin
    .from("rendering_studio_assets" as any)
    .select("elevation_id,storage_bucket,storage_path")
    .eq("storage_bucket", FILE_BUCKET)
    .in("storage_path", paths);
  if (assetLookupError) throw assetLookupError;

  const elevationIds = Array.from(
    new Set((assets ?? []).map((asset: any) => String(asset.elevation_id)).filter(Boolean)),
  );
  if (elevationIds.length) {
    const { error: elevationDeleteError } = await supabaseAdmin
      .from("rendering_studio_elevations" as any)
      .delete()
      .eq("project_id", projectId)
      .in("id", elevationIds);
    if (elevationDeleteError) throw elevationDeleteError;
  }

  const { error: sourceDeleteError } = await supabaseAdmin
    .from("rendering_studio_sources" as any)
    .delete()
    .eq("project_id", projectId)
    .in(
      "id",
      sourceRows.map((row) => String(row.id)),
    );
  if (sourceDeleteError) throw sourceDeleteError;

  for (const [bucket, bucketPaths] of storagePathsByBucket) {
    const { error: storageError } = await supabaseAdmin.storage.from(bucket).remove(bucketPaths);
    if (storageError) throw storageError;
  }

  return {
    removedSources: sourceRows.length,
    removedElevations: elevationIds.length,
  };
}

async function saveElevations({
  projectId,
  packageId,
  elevations,
}: {
  projectId: string;
  packageId: string;
  elevations: any[];
}) {
  if (!validUuid(packageId)) throw new Error("Rendering Studio setup is missing.");
  const { data: sourceRows, error: sourceError } = await supabaseAdmin
    .from("rendering_studio_sources" as any)
    .select("*")
    .eq("project_id", projectId)
    .eq("package_id", packageId);
  if (sourceError) throw sourceError;
  const sourceById = new Map((sourceRows ?? []).map((source: any) => [source.id, source]));

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("rendering_studio_elevations" as any)
    .select("id,elevation_id,presentation_mode,presentation_visible")
    .eq("project_id", projectId);
  if (existingError) throw existingError;
  const existingById = new Map(
    (existingRows ?? []).map((row: any) => [String(row.elevation_id), row]),
  );

  const rows = elevations.map((elevation, index) => {
    const source = sourceById.get(String(elevation.sourceId || ""));
    if (!source || source.source_type !== "autocad_image") {
      throw new Error("Every elevation needs an uploaded AutoCAD image.");
    }
    const elevationId = String(elevation.elevationId || "").trim();
    const roomId = String(elevation.roomId || "");
    if (!elevationId || !validUuid(roomId)) {
      throw new Error("Every elevation needs an ID and room.");
    }
    const existing = existingById.get(elevationId);
    const expectedRenderFilename = safeFileName(
      String(elevation.expectedRenderFilename || `${elevationId}_render.png`),
    );
    const expectedSheetFilename = safeFileName(
      String(elevation.expectedSheetFilename || `${elevationId}_sheet.png`),
    );
    return {
      id: existing?.id || randomUUID(),
      project_id: projectId,
      package_id: packageId,
      room_id: roomId,
      elevation_id: elevationId,
      sheet_number: String(elevation.sheetNumber || `Page ${index + 1}`),
      room_name: String(elevation.roomName || ""),
      title: String(elevation.title || elevationId),
      materials: Array.isArray(elevation.materials) ? elevation.materials : [],
      approval_status: "undecided",
      review_status: "pending",
      workflow_status: "ready_for_codex",
      presentation_order: Number(elevation.presentationOrder || index + 1),
      presentation_mode: existing?.presentation_mode || "cad-then-render",
      presentation_visible: existing?.presentation_visible ?? true,
      expected_cad_filename: source.filename,
      expected_render_filename: expectedRenderFilename,
      expected_sheet_filename: expectedSheetFilename,
      source_page_number: source.page_number,
      correction_note: null,
    };
  });
  const { error } = await supabaseAdmin
    .from("rendering_studio_elevations" as any)
    .upsert(rows as any, { onConflict: "project_id,elevation_id" });
  if (error) throw error;

  const assetRows = rows.map((row) => {
    const source = sourceById.get(
      String(elevations.find((item) => item.elevationId === row.elevation_id)?.sourceId),
    )!;
    return {
      elevation_id: row.id,
      asset_type: "autocad",
      filename: source.filename,
      storage_bucket: source.storage_bucket,
      storage_path: source.storage_path,
      url: "",
      mime_type: source.mime_type,
      file_size: source.file_size,
    };
  });
  const { error: assetError } = await supabaseAdmin
    .from("rendering_studio_assets" as any)
    .upsert(assetRows as any, { onConflict: "elevation_id,asset_type" });
  if (assetError) throw assetError;
  await supabaseAdmin
    .from("rendering_studio_packages" as any)
    .update({
      elevation_count: rows.length,
      workflow_status: "ready_for_codex",
      manifest: {
        packageType: "merav-rendering-studio-native",
        elevationIds: rows.map((row) => row.elevation_id),
      },
    } as any)
    .eq("id", packageId);
  return { count: rows.length };
}

function promptElevation(elevation: any) {
  const autocad = (elevation.assets ?? []).find((asset: any) => asset.asset_type === "autocad");
  return {
    elevationId: elevation.elevation_id,
    sheetNumber: elevation.sheet_number,
    roomName: elevation.room?.name || elevation.room_name,
    title: elevation.title,
    presentationOrder: elevation.presentation_order,
    expectedRenderFilename:
      elevation.expected_render_filename || `${elevation.elevation_id}_render.png`,
    expectedSheetFilename: elevation.expected_sheet_filename,
    autocadFilename: elevation.expected_cad_filename || autocad?.filename || "AutoCAD source",
    materials: Array.isArray(elevation.materials) ? elevation.materials : [],
    correctionNote: elevation.correction_note,
  };
}

async function renderPack(projectId: string, userId: string) {
  const data = await loadBootstrap(projectId);
  const packageRow = data.activePackage;
  if (!packageRow || !data.elevations.length) {
    throw new Error("Finish elevation setup before creating the Codex render pack.");
  }
  const packFilename = `${safeFileName(data.project.name)}_Codex_Render_Pack.zip`;
  const files: Record<string, Uint8Array> = {};

  const sourceFiles: RenderingStudioHandoffManifest["sourceFiles"] = [];
  for (const source of data.sources) {
    if (source.source_type === "autocad_image") continue;
    const folder =
      source.source_type === "autocad_pdf"
        ? "sources/autocad"
        : source.source_type === "specification_pdf"
          ? "sources/specification"
          : "sources/materials";
    const packagePath = `${folder}/${safeFileName(source.filename)}`;
    files[packagePath] = await downloadStoredFile(source.storage_bucket, source.storage_path);
    sourceFiles.push({
      type:
        source.source_type === "autocad_pdf"
          ? "autocad"
          : source.source_type === "specification_pdf"
            ? "specification"
            : "supporting_material",
      label: source.label,
      filename: source.filename,
      packagePath,
    });
  }

  const materialsById = new Map(data.materials.map((material: any) => [material.id, material]));
  const materialImagePaths = new Map<string, string>();
  let materialImageCount = 0;
  let materialImageBytes = 0;
  const manifestElevations: RenderingStudioHandoffManifest["elevations"] = [];
  for (const elevation of data.elevations) {
    const autocad = elevation.assets.find((asset: any) => asset.asset_type === "autocad");
    if (!autocad) throw new Error(`${elevation.elevation_id} is missing its AutoCAD source.`);
    const cadPath = `cad/${safeFileName(elevation.expected_cad_filename || autocad.filename)}`;
    files[cadPath] = await downloadStoredFile(
      autocad.storage_bucket || "room-images",
      autocad.storage_path,
    );
    const elevationMaterials = [];
    for (const savedMaterial of Array.isArray(elevation.materials) ? elevation.materials : []) {
      const liveMaterial = materialsById.get(String(savedMaterial.id || "")) as any;
      const imageUrl =
        liveMaterial?.image_url ||
        liveMaterial?.product?.image_url ||
        savedMaterial.imageUrl ||
        null;
      let imagePath = imageUrl ? materialImagePaths.get(imageUrl) || null : null;
      if (
        imageUrl &&
        !imagePath &&
        materialImageCount < MAX_SPEC_IMAGE_COUNT &&
        materialImageBytes < MAX_SPEC_IMAGE_TOTAL_BYTES
      ) {
        const downloaded = await downloadSpecImage(imageUrl);
        if (
          downloaded &&
          materialImageBytes + downloaded.bytes.byteLength <= MAX_SPEC_IMAGE_TOTAL_BYTES
        ) {
          const materialName =
            savedMaterial.name ||
            liveMaterial?.item_label ||
            liveMaterial?.cad_label ||
            liveMaterial?.client_product_name ||
            liveMaterial?.product?.name ||
            "material";
          imagePath = `materials/spec-book/${safeFileName(
            `${String(savedMaterial.id || liveMaterial?.id || materialImageCount + 1).slice(0, 12)}_${materialName}`,
          )}.${downloaded.extension}`;
          files[imagePath] = downloaded.bytes;
          materialImagePaths.set(imageUrl, imagePath);
          materialImageCount += 1;
          materialImageBytes += downloaded.bytes.byteLength;
        }
      }
      elevationMaterials.push({
        ...savedMaterial,
        vendor: savedMaterial.vendor || liveMaterial?.product?.vendor || null,
        imagePath,
      });
    }
    manifestElevations.push({
      id: elevation.elevation_id,
      sheet: elevation.sheet_number,
      room: elevation.room?.name || elevation.room_name,
      title: elevation.title,
      presentationOrder: elevation.presentation_order,
      autocadFilename: cadPath,
      expectedRenderFilename: elevation.expected_render_filename,
      expectedSheetFilename: elevation.expected_sheet_filename || undefined,
      materials: elevationMaterials,
    });
  }
  const promptElevations = manifestElevations.map((elevation) => ({
    elevationId: elevation.id,
    sheetNumber: elevation.sheet,
    roomName: elevation.room,
    title: elevation.title,
    presentationOrder: elevation.presentationOrder,
    expectedRenderFilename: elevation.expectedRenderFilename,
    expectedSheetFilename: elevation.expectedSheetFilename,
    autocadFilename: elevation.autocadFilename,
    materials: elevation.materials,
  }));
  files["INSTRUCTIONS.txt"] = strToU8(
    buildCodexRenderingPrompt({
      projectName: data.project.name,
      elevations: promptElevations,
      packFilename,
    }),
  );
  const manifest: RenderingStudioHandoffManifest = {
    schemaVersion: "1.0",
    packageType: "merav-rendering-studio-handoff",
    project: data.project.name,
    generatedAt: new Date().toISOString(),
    instructionsFilename: "INSTRUCTIONS.txt",
    sourceFiles,
    elevations: manifestElevations,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  await supabaseAdmin
    .from("rendering_studio_packages" as any)
    .update({
      workflow_status: "rendering_in_progress",
      handoff_generated_at: new Date().toISOString(),
      manifest,
      imported_by: userId,
    } as any)
    .eq("id", packageRow.id);
  const zipped = zipSync(files, { level: 6 });
  return new Response(zipped, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${packFilename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function importResults(
  projectId: string,
  userId: string,
  uploads: Array<{
    filename?: string;
    path?: string;
    mimeType?: string;
    size?: number;
  }>,
) {
  const data = await loadBootstrap(projectId);
  if (!data.activePackage) throw new Error("Finish source and elevation setup first.");
  const filenames = uploads.map((upload) => String(upload.filename || ""));
  const matchResult = matchRenderingResultFilenames(
    data.elevations.map((elevation: any) => ({
      elevationId: elevation.elevation_id,
      expectedRenderFilename: elevation.expected_render_filename,
      expectedSheetFilename: elevation.expected_sheet_filename,
    })),
    filenames,
  );
  const uploadByName = new Map(uploads.map((upload) => [String(upload.filename || ""), upload]));
  const elevationById = new Map(
    data.elevations.map((elevation: any) => [elevation.elevation_id, elevation]),
  );
  const grouped = new Map<string, typeof matchResult.matches>();
  matchResult.matches.forEach((match) => {
    const current = grouped.get(match.elevationId) ?? [];
    current.push(match);
    grouped.set(match.elevationId, current);
  });
  let imported = 0;
  let unchanged = 0;

  for (const [elevationId, matches] of grouped) {
    const elevation: any = elevationById.get(elevationId);
    const renderingMatch = matches.find((match) => match.assetType === "final_rendering");
    if (!elevation || !renderingMatch) continue;
    const renderingUpload = uploadByName.get(renderingMatch.uploadedFilename)!;
    validatePreparedPath(projectId, "result", String(renderingUpload.path || ""));
    const renderingBytes = await downloadStoredFile(FILE_BUCKET, String(renderingUpload.path));
    const renderingHash = createHash("sha256").update(renderingBytes).digest("hex");
    const existingSame = (elevation.revisions ?? []).find(
      (revision: any) => revision.rendering_hash === renderingHash,
    );
    if (existingSame) {
      unchanged += 1;
      continue;
    }
    const finalSheetMatch = matches.find((match) => match.assetType === "final_sheet");
    const finalSheetUpload = finalSheetMatch
      ? uploadByName.get(finalSheetMatch.uploadedFilename)
      : null;
    let finalSheetHash: string | null = null;
    if (finalSheetUpload) {
      validatePreparedPath(projectId, "result", String(finalSheetUpload.path || ""));
      finalSheetHash = createHash("sha256")
        .update(await downloadStoredFile(FILE_BUCKET, String(finalSheetUpload.path)))
        .digest("hex");
    }

    const nextRevision =
      Math.max(
        0,
        ...(elevation.revisions ?? []).map((revision: any) => Number(revision.revision_number)),
      ) + 1;
    await supabaseAdmin
      .from("rendering_studio_revisions" as any)
      .update({ status: "superseded" } as any)
      .eq("elevation_id", elevation.id)
      .eq("status", "pending_review");
    const { error: revisionError } = await supabaseAdmin
      .from("rendering_studio_revisions" as any)
      .insert({
        elevation_id: elevation.id,
        revision_number: nextRevision,
        status: "pending_review",
        rendering_filename: renderingMatch.expectedFilename,
        rendering_bucket: FILE_BUCKET,
        rendering_path: String(renderingUpload.path),
        rendering_mime_type: String(renderingUpload.mimeType || "image/png"),
        rendering_file_size: Number(renderingUpload.size || renderingBytes.byteLength),
        rendering_hash: renderingHash,
        final_sheet_filename: finalSheetMatch?.expectedFilename || null,
        final_sheet_bucket: finalSheetUpload ? FILE_BUCKET : null,
        final_sheet_path: finalSheetUpload ? String(finalSheetUpload.path) : null,
        final_sheet_mime_type: finalSheetUpload
          ? String(finalSheetUpload.mimeType || "image/png")
          : null,
        final_sheet_file_size: finalSheetUpload ? Number(finalSheetUpload.size || 0) : null,
        final_sheet_hash: finalSheetHash,
        created_by: userId,
      } as any);
    if (revisionError) throw revisionError;

    const assetRows = [
      {
        elevation_id: elevation.id,
        asset_type: "final_rendering",
        filename: renderingMatch.expectedFilename,
        storage_bucket: FILE_BUCKET,
        storage_path: String(renderingUpload.path),
        url: "",
        mime_type: String(renderingUpload.mimeType || "image/png"),
        file_size: Number(renderingUpload.size || renderingBytes.byteLength),
      },
    ];
    if (finalSheetMatch && finalSheetUpload) {
      assetRows.push({
        elevation_id: elevation.id,
        asset_type: "final_sheet",
        filename: finalSheetMatch.expectedFilename,
        storage_bucket: FILE_BUCKET,
        storage_path: String(finalSheetUpload.path),
        url: "",
        mime_type: String(finalSheetUpload.mimeType || "image/png"),
        file_size: Number(finalSheetUpload.size || 0),
      });
    }
    const { error: assetError } = await supabaseAdmin
      .from("rendering_studio_assets" as any)
      .upsert(assetRows as any, { onConflict: "elevation_id,asset_type" });
    if (assetError) throw assetError;
    const { error: elevationError } = await supabaseAdmin
      .from("rendering_studio_elevations" as any)
      .update({
        workflow_status: "pending_review",
        approval_status: "undecided",
        review_status: "pending",
        correction_note: null,
        current_revision_number: nextRevision,
      } as any)
      .eq("id", elevation.id);
    if (elevationError) throw elevationError;
    imported += 1;
  }
  await supabaseAdmin
    .from("rendering_studio_packages" as any)
    .update({ workflow_status: "pending_review" } as any)
    .eq("id", data.activePackage.id);
  return {
    imported,
    unchanged,
    missing: matchResult.missing,
    duplicates: matchResult.duplicates,
    unexpected: matchResult.unexpected,
  };
}

async function reviewElevation(
  elevationId: string,
  userId: string,
  decision: "approve" | "reject",
  correctionNote?: string,
) {
  const { data: elevation, error } = await supabaseAdmin
    .from("rendering_studio_elevations" as any)
    .select("id,project_id,package_id,current_revision_number")
    .eq("id", elevationId)
    .maybeSingle();
  if (error) throw error;
  if (!elevation) throw new Error("Elevation not found.");
  const note = String(correctionNote || "").trim();
  if (decision === "reject" && !note) {
    throw new Error("Add a correction note before rejecting this rendering.");
  }
  const approved = decision === "approve";
  const { error: revisionError } = await supabaseAdmin
    .from("rendering_studio_revisions" as any)
    .update({
      status: approved ? "approved" : "rejected",
      correction_note: approved ? null : note,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    } as any)
    .eq("elevation_id", elevation.id)
    .eq("revision_number", elevation.current_revision_number);
  if (revisionError) throw revisionError;
  const { error: elevationError } = await supabaseAdmin
    .from("rendering_studio_elevations" as any)
    .update({
      workflow_status: approved ? "approved" : "correction_requested",
      approval_status: approved ? "approved" : "declined",
      review_status: approved ? "approved" : "rejected",
      correction_note: approved ? null : note,
      presentation_visible: approved,
    } as any)
    .eq("id", elevation.id);
  if (elevationError) throw elevationError;

  const { data: remaining } = await supabaseAdmin
    .from("rendering_studio_elevations" as any)
    .select("workflow_status")
    .eq("package_id", elevation.package_id);
  const statuses = (remaining ?? []).map((item: any) => item.workflow_status);
  const packageStatus = statuses.every((status) => status === "approved")
    ? "approved"
    : statuses.some((status) => status === "correction_requested")
      ? "correction_requested"
      : "pending_review";
  await supabaseAdmin
    .from("rendering_studio_packages" as any)
    .update({ workflow_status: packageStatus } as any)
    .eq("id", elevation.package_id);
}

async function backupZip(projectId: string) {
  const data = await loadBootstrap(projectId);
  const files: Record<string, Uint8Array> = {};
  const revisionSummary: any[] = [];
  for (const elevation of data.elevations) {
    for (const asset of elevation.assets) {
      const folder =
        asset.asset_type === "autocad"
          ? "autocad"
          : asset.asset_type === "final_rendering"
            ? "approved-renderings"
            : "final-sheets";
      files[`${folder}/${safeFileName(asset.filename)}`] = await downloadStoredFile(
        asset.storage_bucket || "room-images",
        asset.storage_path,
      );
    }
    for (const revision of elevation.revisions ?? []) {
      const base = `revisions/${safeFileName(elevation.elevation_id)}/v${revision.revision_number}`;
      files[`${base}/${safeFileName(revision.rendering_filename)}`] = await downloadStoredFile(
        revision.rendering_bucket,
        revision.rendering_path,
      );
      if (revision.final_sheet_path && revision.final_sheet_bucket) {
        files[`${base}/${safeFileName(revision.final_sheet_filename || "final-sheet.png")}`] =
          await downloadStoredFile(revision.final_sheet_bucket, revision.final_sheet_path);
      }
      revisionSummary.push({
        elevationId: elevation.elevation_id,
        revisionNumber: revision.revision_number,
        status: revision.status,
        correctionNote: revision.correction_note,
        createdAt: revision.created_at,
        reviewedAt: revision.reviewed_at,
      });
    }
  }
  files["manifest.json"] = strToU8(JSON.stringify(data.activePackage?.manifest ?? {}, null, 2));
  files["revision-history.json"] = strToU8(JSON.stringify(revisionSummary, null, 2));
  const filename = `${safeFileName(data.project.name)}_Rendering_Studio_Backup.zip`;
  return new Response(zipSync(files, { level: 6 }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/rendering-studio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const projectId = new URL(request.url).searchParams.get("projectId") || "";
        const auth = await requireRenderingViewer(request, projectId);
        if ("error" in auth) return auth.error;
        try {
          await requireWorkflowSchema();
          if (!auth.teamMember) {
            return json({ elevations: await loadSharedElevations(projectId) });
          }
          return json(await loadBootstrap(projectId));
        } catch (error) {
          console.error("Rendering Studio load failed", error);
          return json(
            { error: error instanceof Error ? error.message : "Rendering Studio could not load." },
            400,
          );
        }
      },
      POST: async ({ request }) => {
        const auth = await requireStudioUser(request);
        if ("error" in auth) return auth.error;
        try {
          await requireWorkflowSchema();
          const body = (await request.json()) as any;
          const action = String(body.action || "");
          const projectId = String(body.projectId || "");
          const project = await requireProject(projectId);

          if (action === "prepare_uploads") {
            return json(
              await prepareUploads(
                projectId,
                body.purpose === "result" ? "result" : "source",
                Array.isArray(body.files) ? body.files : [],
              ),
            );
          }
          if (action === "save_sources") {
            return json(
              await saveSources({
                project,
                userId: auth.user.id,
                packageId: body.packageId,
                sourceLabel: body.sourceLabel,
                sources: Array.isArray(body.sources) ? body.sources : [],
              }),
            );
          }
          if (action === "save_elevations") {
            return json(
              await saveElevations({
                projectId,
                packageId: String(body.packageId || ""),
                elevations: Array.isArray(body.elevations) ? body.elevations : [],
              }),
            );
          }
          if (action === "extract_autocad_pdf") {
            return json(
              await extractAutocadPdf({
                projectId,
                userId: auth.user.id,
                sourceId: String(body.sourceId || ""),
              }),
            );
          }
          if (action === "delete_source") {
            return json(
              await deleteSourceSet({
                projectId,
                sourceId: String(body.sourceId || ""),
              }),
            );
          }
          if (action === "create_render_pack") {
            return renderPack(projectId, auth.user.id);
          }
          if (action === "import_results") {
            return json(
              await importResults(
                projectId,
                auth.user.id,
                Array.isArray(body.uploads) ? body.uploads : [],
              ),
            );
          }
          if (action === "review_elevation") {
            const decision = body.decision === "reject" ? "reject" : "approve";
            await reviewElevation(
              String(body.elevationId || ""),
              auth.user.id,
              decision,
              body.correctionNote,
            );
            return json({ ok: true });
          }
          if (action === "download_backup") {
            return backupZip(projectId);
          }
          return json({ error: "Unknown Rendering Studio action." }, 400);
        } catch (error) {
          console.error("Rendering Studio workflow failed", error);
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Rendering Studio could not complete that action.",
            },
            400,
          );
        }
      },
    },
  },
});
