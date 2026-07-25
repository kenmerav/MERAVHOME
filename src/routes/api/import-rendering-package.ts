/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { unzipSync } from "fflate";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ROOM_IMAGE_BUCKET, uploadRoomImageBufferAtPath } from "@/lib/roomImageStorage.server";
import {
  isRenderingStudioPresentationMode,
  parseRenderingStudioManifest,
  renderingStudioAssetMimeType,
  renderingStudioElevationSlideKeys,
  renderingStudioElevationSlidePrefix,
  validateRenderingStudioPackageEntries,
  type RenderingStudioAssetType,
  type RenderingStudioManifest,
  type RenderingStudioManifestElevation,
  type RenderingStudioPresentationMode,
} from "@/lib/renderingStudioPackage";

const PACKAGE_BUCKET = "rendering-packages";
const MAX_PACKAGE_BYTES = 150 * 1024 * 1024;
const MAX_PACKAGE_PART_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 350 * 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;

type ImportAction =
  | "prepare"
  | "import"
  | "cleanup"
  | "prepare-folder"
  | "prepare-folder-group"
  | "import-folder";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeFileSegment(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160) || "asset"
  );
}

function normalizeRoomName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  return value.filter((item): item is string => {
    if (typeof item !== "string" || !item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

async function requireStudioUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in to import a rendering package." }, 401) };

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
    return {
      error: json({ error: "Only MERAV team members can import rendering packages." }, 403),
    };
  }
  return { user: userData.user };
}

async function requireProject(projectId: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Project not found.");
}

async function requireRenderingStudioSchema() {
  const { error } = await supabaseAdmin
    .from("rendering_studio_elevations" as any)
    .select("id")
    .limit(1);
  if (!error) return;
  if (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /rendering_studio_elevations/i.test(error.message)
  ) {
    throw new Error(
      "Rendering Studio import database setup is required before files can be uploaded.",
    );
  }
  throw error;
}

function isTransientStorageError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    status?: number;
    statusCode?: string | number;
    message?: string;
  };
  return (
    Number(value.status || value.statusCode) >= 500 ||
    /bad gateway|temporarily unavailable/i.test(String(value.message || ""))
  );
}

async function waitForStorageRetry(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
}

let packageBucketReady: Promise<void> | null = null;

async function configurePackageBucket() {
  const options = {
    public: false,
    fileSizeLimit: MAX_ASSET_BYTES,
    allowedMimeTypes: [
      "application/zip",
      "application/x-zip-compressed",
      "application/octet-stream",
      "image/png",
      "image/jpeg",
      "image/webp",
    ],
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data, error: getError } = await supabaseAdmin.storage.getBucket(PACKAGE_BUCKET);
      if (getError && !/not found/i.test(getError.message)) throw getError;
      if (data) {
        const { error } = await supabaseAdmin.storage.updateBucket(PACKAGE_BUCKET, options);
        if (error) throw error;
        return;
      }
      const { error } = await supabaseAdmin.storage.createBucket(PACKAGE_BUCKET, options);
      if (error && !/already exists/i.test(error.message)) throw error;
      return;
    } catch (error) {
      if (attempt === 2 || !isTransientStorageError(error)) throw error;
      await waitForStorageRetry(attempt);
    }
  }
}

async function ensurePackageBucket() {
  packageBucketReady ??= configurePackageBucket();
  try {
    await packageBucketReady;
  } catch (error) {
    packageBucketReady = null;
    throw error;
  }
}

async function createSignedPackageUpload(path: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabaseAdmin.storage
      .from(PACKAGE_BUCKET)
      .createSignedUploadUrl(path);
    if (!error && data) return data.token;
    const failure = error || new Error("Could not prepare the package upload.");
    if (attempt === 2 || !isTransientStorageError(failure)) throw failure;
    await waitForStorageRetry(attempt);
  }
  throw new Error("Could not prepare the package upload.");
}

function validatePackagePartPaths(projectId: string, paths: string[]) {
  const prefix = `${projectId}/imports/`;
  const maxPartCount = Math.ceil(MAX_PACKAGE_BYTES / MAX_PACKAGE_PART_BYTES);
  if (paths.length < 1 || paths.length > maxPartCount) {
    throw new Error("The rendering package has an invalid number of upload parts.");
  }

  const firstRelativePath = paths[0]?.slice(prefix.length) ?? "";
  const importId = firstRelativePath.split("/")[0] ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(importId)) {
    throw new Error("Invalid rendering package upload path.");
  }

  paths.forEach((path, index) => {
    const expectedPath = `${prefix}${importId}/part-${String(index + 1).padStart(4, "0")}`;
    if (path !== expectedPath || path.includes("..")) {
      throw new Error("Invalid rendering package upload sequence.");
    }
  });
}

function validateTemporaryCleanupPaths(projectId: string, paths: string[]) {
  if (paths.length < 1 || paths.length > 220) {
    throw new Error("The temporary upload cleanup request is invalid.");
  }
  const prefix = `${projectId}/imports/`;
  const firstRelativePath = paths[0]?.slice(prefix.length) ?? "";
  const importId = firstRelativePath.split("/")[0] ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(importId)) {
    throw new Error("Invalid temporary upload cleanup path.");
  }
  const uniquePaths = new Set(paths);
  if (uniquePaths.size !== paths.length) {
    throw new Error("The temporary upload cleanup request contains duplicates.");
  }
  paths.forEach((path) => {
    const expectedPrefix = `${prefix}${importId}/`;
    const filename = path.slice(expectedPrefix.length);
    if (
      !path.startsWith(expectedPrefix) ||
      !/^(?:part|asset)-\d{4}$/.test(filename) ||
      path.includes("..")
    ) {
      throw new Error("Invalid temporary upload cleanup path.");
    }
  });
}

async function downloadPackageParts(projectId: string, paths: string[]) {
  validatePackagePartPaths(projectId, paths);
  const buffers: Buffer[] = [];
  let totalBytes = 0;

  for (const path of paths) {
    const { data, error } = await supabaseAdmin.storage.from(PACKAGE_BUCKET).download(path);
    if (error || !data) throw error || new Error("The rendering package could not be loaded.");
    if (data.size > MAX_PACKAGE_PART_BYTES) {
      throw new Error("A rendering package upload part is unexpectedly large.");
    }
    totalBytes += data.size;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error("The rendering package exceeds 150 MB.");
    }
    buffers.push(Buffer.from(await data.arrayBuffer()));
  }

  return Buffer.concat(buffers, totalBytes);
}

function manifestAssetPaths(manifest: RenderingStudioManifest) {
  return manifest.elevations.flatMap((elevation) => [
    elevation.cadFilename,
    elevation.renderFilename,
    elevation.finalSheetFilename,
  ]);
}

function manifestAssetPathsForGroup(
  manifest: RenderingStudioManifest,
  group: "cad" | "renders" | "final-sheets",
) {
  if (group === "cad") {
    return manifest.elevations.map((elevation) => elevation.cadFilename);
  }
  if (group === "renders") {
    return manifest.elevations.map((elevation) => elevation.renderFilename);
  }
  return manifest.elevations.map((elevation) => elevation.finalSheetFilename);
}

function validateFolderUploadPaths(
  projectId: string,
  uploads: Array<{ sourcePath: string; path: string }>,
  sourcePaths: string[],
) {
  if (uploads.length !== sourcePaths.length) {
    throw new Error("The unzipped package upload is incomplete.");
  }
  const prefix = `${projectId}/imports/`;
  const firstRelativePath = uploads[0]?.path.slice(prefix.length) ?? "";
  const importId = firstRelativePath.split("/")[0] ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(importId)) {
    throw new Error("Invalid unzipped package upload path.");
  }

  const uploadsBySourcePath = new Map(uploads.map((upload) => [upload.sourcePath, upload]));
  return sourcePaths.map((sourcePath, index) => {
    const upload = uploadsBySourcePath.get(sourcePath);
    const expectedPath = `${prefix}${importId}/asset-` + String(index + 1).padStart(4, "0");
    if (!upload || upload.path !== expectedPath || upload.path.includes("..")) {
      throw new Error("Invalid unzipped package upload sequence.");
    }
    return upload;
  });
}

async function downloadFolderEntries({
  projectId,
  manifestText,
  uploads,
}: {
  projectId: string;
  manifestText: string;
  uploads: Array<{ sourcePath: string; path: string }>;
}) {
  if (Buffer.byteLength(manifestText, "utf8") > 2 * 1024 * 1024) {
    throw new Error("manifest.json is unexpectedly large.");
  }
  const manifest = parseRenderingStudioManifest(manifestText);
  const sourcePaths = manifestAssetPaths(manifest);
  const orderedUploads = validateFolderUploadPaths(projectId, uploads, sourcePaths);

  const entries: Record<string, Uint8Array> = {
    "manifest.json": new TextEncoder().encode(manifestText),
  };
  let totalBytes = entries["manifest.json"].byteLength;
  for (const upload of orderedUploads) {
    const { data, error } = await supabaseAdmin.storage.from(PACKAGE_BUCKET).download(upload.path);
    if (error || !data) {
      throw error || new Error(`${upload.sourcePath} could not be loaded.`);
    }
    if (data.size > MAX_ASSET_BYTES) {
      throw new Error(`${upload.sourcePath} exceeds the 20 MB per-asset limit.`);
    }
    totalBytes += data.size;
    if (totalBytes > MAX_EXPANDED_BYTES) {
      throw new Error("The unzipped package exceeds the 350 MB safety limit.");
    }
    entries[upload.sourcePath] = new Uint8Array(await data.arrayBuffer());
  }

  return entries;
}

function hashPackageEntries(
  entries: Record<string, Uint8Array>,
  manifest: RenderingStudioManifest,
) {
  const hash = createHash("sha256");
  for (const path of ["manifest.json", ...manifestAssetPaths(manifest)]) {
    const bytes = entries[path];
    hash.update(`${path.length}:${path}:${bytes.byteLength}:`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function extractValidatedPackage(buffer: Buffer) {
  let manifestExpandedBytes = 0;
  const manifestOnly = unzipSync(buffer, {
    filter(file) {
      if (file.name !== "manifest.json") return false;
      manifestExpandedBytes += file.originalSize;
      if (manifestExpandedBytes > 2 * 1024 * 1024) {
        throw new Error("manifest.json is unexpectedly large.");
      }
      return true;
    },
  });
  const manifestBytes = manifestOnly["manifest.json"];
  if (!manifestBytes) throw new Error("The ZIP does not contain manifest.json at its root.");
  const manifest = parseRenderingStudioManifest(manifestBytes);
  const requiredPaths = new Set<string>(["manifest.json"]);
  manifest.elevations.forEach((elevation) => {
    requiredPaths.add(elevation.cadFilename);
    requiredPaths.add(elevation.renderFilename);
    requiredPaths.add(elevation.finalSheetFilename);
  });

  let expandedBytes = 0;
  const entries = unzipSync(buffer, {
    filter(file) {
      if (!requiredPaths.has(file.name)) return false;
      if (file.name !== "manifest.json" && file.originalSize > MAX_ASSET_BYTES) {
        throw new Error(`${file.name} exceeds the 20 MB per-asset limit.`);
      }
      expandedBytes += file.originalSize;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new Error("The rendering package expands beyond the 350 MB safety limit.");
      }
      return true;
    },
  });
  const validation = validateRenderingStudioPackageEntries(entries);
  return { entries, validation };
}

async function ensureRooms(projectId: string, elevationRooms: string[]) {
  const { data: existing, error } = await supabaseAdmin
    .from("rooms")
    .select("id,name,sort_order")
    .eq("project_id", projectId)
    .order("sort_order");
  if (error) throw error;

  const roomByName = new Map(
    (existing ?? []).map((room) => [normalizeRoomName(room.name), room] as const),
  );
  const createdNames: string[] = [];
  let nextOrder = Math.max(0, ...(existing ?? []).map((room) => Number(room.sort_order) || 0)) + 1;

  for (const roomName of elevationRooms) {
    const normalizedName = normalizeRoomName(roomName);
    if (roomByName.has(normalizedName)) continue;
    const { data: created, error: createError } = await supabaseAdmin
      .from("rooms")
      .insert({ project_id: projectId, name: roomName.trim(), sort_order: nextOrder++ })
      .select("id,name,sort_order")
      .single();
    if (createError) throw createError;
    roomByName.set(normalizedName, created);
    createdNames.push(created.name);
  }

  return { roomByName, createdNames };
}

function manifestAssetRows(
  elevation: RenderingStudioManifestElevation,
  entries: Record<string, Uint8Array>,
) {
  return [
    {
      assetType: "autocad" as const,
      filename: elevation.cadFilename,
      bytes: entries[elevation.cadFilename],
      storageLabel: "autocad",
    },
    {
      assetType: "final_rendering" as const,
      filename: elevation.renderFilename,
      bytes: entries[elevation.renderFilename],
      storageLabel: "final-rendering",
    },
    {
      assetType: "final_sheet" as const,
      filename: elevation.finalSheetFilename,
      bytes: entries[elevation.finalSheetFilename],
      storageLabel: "final-sheet",
    },
  ];
}

async function syncPresentationOrder(
  projectId: string,
  userId: string,
  elevations: Array<{
    elevationId: string;
    presentationOrder: number;
    presentationMode: RenderingStudioPresentationMode;
    approved: boolean;
  }>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: boardResult, error: boardError } = await supabaseAdmin
      .from("design_boards" as any)
      .select("board_state,updated_at")
      .eq("project_id", projectId)
      .maybeSingle();
    if (boardError) throw boardError;
    const board = boardResult as { board_state: unknown; updated_at: string } | null;
    const boardState =
      board?.board_state && typeof board.board_state === "object"
        ? (board.board_state as Record<string, unknown>)
        : { pages: [], selectedPageId: "" };
    const currentOrder = normalizeStringArray(boardState.presentationSlideOrder);
    const currentHidden = new Set(normalizeStringArray(boardState.presentationHiddenSlideKeys));
    const importedPrefixes = elevations.map((elevation) =>
      renderingStudioElevationSlidePrefix(elevation.elevationId),
    );
    const nextOrder = currentOrder.filter(
      (slideKey) => !importedPrefixes.some((prefix) => slideKey.startsWith(prefix)),
    );

    elevations
      .filter((elevation) => elevation.approved)
      .sort((a, b) => a.presentationOrder - b.presentationOrder)
      .forEach((elevation) => {
        renderingStudioElevationSlideKeys(
          elevation.elevationId,
          elevation.presentationMode,
        ).forEach((slideKey) => {
          nextOrder.push(slideKey);
          currentHidden.delete(slideKey);
        });
      });

    const nextState = {
      ...boardState,
      presentationSlideOrder: nextOrder,
      presentationHiddenSlideKeys: Array.from(currentHidden),
    };
    if (!board) {
      const { error } = await supabaseAdmin.from("design_boards" as any).insert({
        project_id: projectId,
        board_state: nextState,
        updated_by: userId,
      } as any);
      if (!error) return;
      if (error.code === "23505") continue;
      throw error;
    }

    const { data: saved, error } = await supabaseAdmin
      .from("design_boards" as any)
      .update({ board_state: nextState, updated_by: userId } as any)
      .eq("project_id", projectId)
      .eq("updated_at", board.updated_at)
      .select("project_id")
      .maybeSingle();
    if (error) throw error;
    if (saved) return;
  }
  throw new Error("Presentation order changed during import. Please retry the package import.");
}

async function importValidatedPackage({
  entries,
  validation,
  packageHash,
  fileName,
  projectId,
  userId,
}: {
  entries: Record<string, Uint8Array>;
  validation: ReturnType<typeof validateRenderingStudioPackageEntries>;
  packageHash: string;
  fileName: string;
  projectId: string;
  userId: string;
}) {
  const { manifest } = validation;
  const uniqueRoomNames = Array.from(new Set(manifest.elevations.map((item) => item.room)));
  const { roomByName, createdNames } = await ensureRooms(projectId, uniqueRoomNames);

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("rendering_studio_elevations" as any)
    .select("id,elevation_id,presentation_mode,presentation_visible")
    .eq("project_id", projectId);
  if (existingError) throw existingError;
  const existingByElevationId = new Map(
    ((existingRows ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.elevation_id),
      row,
    ]),
  );

  const defaultMode = isRenderingStudioPresentationMode(manifest.presentationDefaults.presentation)
    ? manifest.presentationDefaults.presentation
    : "cad-then-render";
  const preparedElevations = manifest.elevations.map((elevation) => {
    const existing = existingByElevationId.get(elevation.id);
    const presentationMode = isRenderingStudioPresentationMode(existing?.presentation_mode)
      ? existing.presentation_mode
      : defaultMode;
    return {
      manifest: elevation,
      databaseId: typeof existing?.id === "string" ? existing.id : randomUUID(),
      roomId: roomByName.get(normalizeRoomName(elevation.room))!.id,
      presentationMode,
      presentationVisible:
        typeof existing?.presentation_visible === "boolean"
          ? existing.presentation_visible
          : elevation.approval.toLowerCase() === "approved" ||
            elevation.reviewStatus.toLowerCase() === "approved",
    };
  });

  const uploadedAssets: Array<{
    elevationDatabaseId: string;
    elevationId: string;
    assetType: RenderingStudioAssetType;
    filename: string;
    storagePath: string;
    url: string;
    mimeType: string;
    fileSize: number;
  }> = [];
  for (const elevation of preparedElevations) {
    for (const asset of manifestAssetRows(elevation.manifest, entries)) {
      const mimeType = renderingStudioAssetMimeType(asset.bytes, asset.filename);
      const storagePath =
        `rendering-studio/${projectId}/${packageHash}/${safeFileSegment(elevation.manifest.id)}/` +
        `${asset.storageLabel}-${safeFileSegment(asset.filename.split("/").pop() || asset.filename)}`;
      const uploaded = await uploadRoomImageBufferAtPath({
        buffer: Buffer.from(asset.bytes),
        contentType: mimeType,
        path: storagePath,
      });
      uploadedAssets.push({
        elevationDatabaseId: elevation.databaseId,
        elevationId: elevation.manifest.id,
        assetType: asset.assetType,
        filename: asset.filename,
        storagePath,
        url: uploaded.publicUrl,
        mimeType,
        fileSize: asset.bytes.byteLength,
      });
    }
  }

  const packageRecord = {
    project_id: projectId,
    source_filename: fileName,
    package_hash: packageHash,
    schema_version: manifest.schemaVersion,
    source_project_name: manifest.project,
    generated_at: manifest.generatedAt,
    manifest,
    elevation_count: manifest.elevations.length,
    imported_by: userId,
  };
  const { data: packageRow, error: packageError } = await supabaseAdmin
    .from("rendering_studio_packages" as any)
    .upsert(packageRecord as any, { onConflict: "project_id,package_hash" })
    .select("id")
    .single();
  if (packageError || !packageRow)
    throw packageError || new Error("Could not save package metadata.");

  const elevationRows = preparedElevations.map((elevation) => ({
    id: elevation.databaseId,
    project_id: projectId,
    package_id: packageRow.id,
    room_id: elevation.roomId,
    elevation_id: elevation.manifest.id,
    sheet_number: elevation.manifest.sheet,
    room_name: elevation.manifest.room,
    title: elevation.manifest.title,
    materials: elevation.manifest.materials,
    approval_status: elevation.manifest.approval,
    review_status: elevation.manifest.reviewStatus,
    presentation_order: elevation.manifest.presentationOrder,
    presentation_mode: elevation.presentationMode,
    presentation_visible: elevation.presentationVisible,
  }));
  const { error: elevationError } = await supabaseAdmin
    .from("rendering_studio_elevations" as any)
    .upsert(elevationRows as any, { onConflict: "project_id,elevation_id" });
  if (elevationError) throw elevationError;

  const assetRows = uploadedAssets.map((asset) => ({
    elevation_id: asset.elevationDatabaseId,
    asset_type: asset.assetType,
    filename: asset.filename,
    storage_path: asset.storagePath,
    url: asset.url,
    mime_type: asset.mimeType,
    file_size: asset.fileSize,
  }));
  const { error: assetError } = await supabaseAdmin
    .from("rendering_studio_assets" as any)
    .upsert(assetRows as any, { onConflict: "elevation_id,asset_type" });
  if (assetError) throw assetError;

  await syncPresentationOrder(
    projectId,
    userId,
    preparedElevations.map((elevation) => ({
      elevationId: elevation.manifest.id,
      presentationOrder: elevation.manifest.presentationOrder,
      presentationMode: elevation.presentationMode,
      approved: elevation.presentationVisible,
    })),
  );

  const assetTypesByElevation = new Map<string, Set<RenderingStudioAssetType>>();
  uploadedAssets.forEach((asset) => {
    const types = assetTypesByElevation.get(asset.elevationId) ?? new Set();
    types.add(asset.assetType);
    assetTypesByElevation.set(asset.elevationId, types);
  });

  return {
    projectName: manifest.project,
    packageHash,
    elevationCount: validation.elevationCount,
    assetCount: validation.assetCount,
    roomsCreated: createdNames,
    elevations: manifest.elevations.map((elevation) => {
      const assetTypes = assetTypesByElevation.get(elevation.id) ?? new Set();
      return {
        id: elevation.id,
        sheet: elevation.sheet,
        room: elevation.room,
        title: elevation.title,
        presentationOrder: elevation.presentationOrder,
        approval: elevation.approval,
        autocad: assetTypes.has("autocad"),
        finalRendering: assetTypes.has("final_rendering"),
        finalSheet: assetTypes.has("final_sheet"),
      };
    }),
  };
}

async function importPackage({
  buffer,
  fileName,
  projectId,
  userId,
}: {
  buffer: Buffer;
  fileName: string;
  projectId: string;
  userId: string;
}) {
  const { entries, validation } = extractValidatedPackage(buffer);
  return importValidatedPackage({
    entries,
    validation,
    packageHash: createHash("sha256").update(buffer).digest("hex"),
    fileName,
    projectId,
    userId,
  });
}

export const Route = createFileRoute("/api/import-rendering-package")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireStudioUser(request);
        if ("error" in auth) return auth.error;

        try {
          const body = (await request.json().catch(() => null)) as {
            action?: ImportAction;
            projectId?: string;
            fileName?: string;
            fileSize?: number;
            contentType?: string;
            paths?: string[];
            manifestText?: string;
            files?: Array<{ path?: string; size?: number }>;
            uploads?: Array<{ sourcePath?: string; path?: string }>;
            group?: string;
            importId?: string;
          } | null;
          const action = body?.action;
          const projectId = String(body?.projectId || "");
          if (!projectId) return json({ error: "Project ID is required." }, 400);
          await requireProject(projectId);
          if (action !== "cleanup") {
            await requireRenderingStudioSchema();
          }

          if (action === "prepare-folder-group") {
            const manifestText = String(body?.manifestText || "");
            if (!manifestText || Buffer.byteLength(manifestText, "utf8") > 2 * 1024 * 1024) {
              return json({ error: "Add a valid manifest.json before uploading folders." }, 400);
            }
            const manifest = parseRenderingStudioManifest(manifestText);
            const group = String(body?.group || "");
            if (group !== "cad" && group !== "renders" && group !== "final-sheets") {
              return json({ error: "Choose a valid package image folder." }, 400);
            }
            const importId = String(body?.importId || "") || randomUUID();
            if (!/^[0-9a-f-]{36}$/i.test(importId)) {
              return json({ error: "The folder upload session is invalid." }, 400);
            }
            const sourcePaths = manifestAssetPathsForGroup(manifest, group);
            const allSourcePaths = manifestAssetPaths(manifest);
            const suppliedFiles = Array.isArray(body?.files) ? body.files : [];
            const fileSizes = new Map(
              suppliedFiles.map((file) => [String(file.path || ""), Number(file.size || 0)]),
            );
            for (const sourcePath of sourcePaths) {
              const size = fileSizes.get(sourcePath) ?? 0;
              if (!size) {
                return json(
                  { error: `The selected ${group} folder is missing ${sourcePath}.` },
                  400,
                );
              }
              if (size > MAX_ASSET_BYTES) {
                return json(
                  {
                    error: `${sourcePath} exceeds the 20 MB per-asset limit.`,
                  },
                  400,
                );
              }
            }

            await ensurePackageBucket();
            const uploads = [];
            for (const sourcePath of sourcePaths) {
              const index = allSourcePaths.indexOf(sourcePath);
              const path =
                `${projectId}/imports/${importId}/asset-` + String(index + 1).padStart(4, "0");
              const token = await createSignedPackageUpload(path);
              uploads.push({ sourcePath, path, token });
            }
            return json({
              bucket: PACKAGE_BUCKET,
              importId,
              uploads,
              fileCount: sourcePaths.length,
            });
          }

          if (action === "prepare-folder") {
            const manifestText = String(body?.manifestText || "");
            if (!manifestText || Buffer.byteLength(manifestText, "utf8") > 2 * 1024 * 1024) {
              return json({ error: "The selected folder needs a valid manifest.json." }, 400);
            }
            const manifest = parseRenderingStudioManifest(manifestText);
            const sourcePaths = manifestAssetPaths(manifest);
            const suppliedFiles = Array.isArray(body?.files) ? body.files : [];
            if (suppliedFiles.length > 300) {
              return json({ error: "The selected folder contains too many files." }, 400);
            }
            const fileSizes = new Map<string, number>();
            for (const file of suppliedFiles) {
              const path = String(file.path || "");
              const size = Number(file.size || 0);
              if (fileSizes.has(path)) {
                return json({ error: `The selected folder contains duplicate file ${path}.` }, 400);
              }
              fileSizes.set(path, size);
            }
            let totalBytes = Buffer.byteLength(manifestText, "utf8");
            for (const path of sourcePaths) {
              const size = fileSizes.get(path) ?? 0;
              if (!size) {
                return json({ error: `The selected folder is missing ${path}.` }, 400);
              }
              if (size > MAX_ASSET_BYTES) {
                return json({ error: `${path} exceeds the 20 MB per-asset limit.` }, 400);
              }
              totalBytes += size;
            }
            if (totalBytes > MAX_EXPANDED_BYTES) {
              return json({ error: "The unzipped package exceeds the 350 MB safety limit." }, 400);
            }

            await ensurePackageBucket();
            const importId = randomUUID();
            const uploads = [];
            for (const [index, sourcePath] of sourcePaths.entries()) {
              const path =
                `${projectId}/imports/${importId}/asset-` + String(index + 1).padStart(4, "0");
              const token = await createSignedPackageUpload(path);
              uploads.push({ sourcePath, path, token });
            }
            return json({
              bucket: PACKAGE_BUCKET,
              uploads,
              elevationCount: manifest.elevations.length,
              assetCount: sourcePaths.length,
            });
          }

          if (action === "prepare") {
            const fileName = String(body?.fileName || "");
            const fileSize = Number(body?.fileSize || 0);
            const contentType = String(body?.contentType || "application/zip");
            if (!fileName.toLowerCase().endsWith(".zip")) {
              return json({ error: "Choose a Rendering Studio ZIP package." }, 400);
            }
            if (!fileSize || fileSize > MAX_PACKAGE_BYTES) {
              return json({ error: "Rendering packages must be 150 MB or smaller." }, 400);
            }
            if (
              contentType &&
              ![
                "application/zip",
                "application/x-zip-compressed",
                "application/octet-stream",
              ].includes(contentType)
            ) {
              return json({ error: "The selected file is not a ZIP package." }, 400);
            }
            await ensurePackageBucket();
            const importId = randomUUID();
            const partCount = Math.ceil(fileSize / MAX_PACKAGE_PART_BYTES);
            const uploads = [];
            for (let index = 0; index < partCount; index += 1) {
              const path =
                `${projectId}/imports/${importId}/part-` + String(index + 1).padStart(4, "0");
              const token = await createSignedPackageUpload(path);
              uploads.push({ path, token });
            }
            return json({
              bucket: PACKAGE_BUCKET,
              partSizeBytes: MAX_PACKAGE_PART_BYTES,
              uploads,
            });
          }

          if (action === "import") {
            const paths = Array.isArray(body?.paths) ? body.paths.map((path) => String(path)) : [];
            const fileName = String(body?.fileName || "Rendering Studio Import.zip");
            try {
              const buffer = await downloadPackageParts(projectId, paths);
              const result = await importPackage({
                buffer,
                fileName,
                projectId,
                userId: auth.user.id,
              });
              return json(result);
            } finally {
              if (paths.length > 0) {
                await supabaseAdmin.storage.from(PACKAGE_BUCKET).remove(paths);
              }
            }
          }

          if (action === "import-folder") {
            const manifestText = String(body?.manifestText || "");
            const uploads = Array.isArray(body?.uploads)
              ? body.uploads.map((upload) => ({
                  sourcePath: String(upload.sourcePath || ""),
                  path: String(upload.path || ""),
                }))
              : [];
            const paths = uploads.map((upload) => upload.path);
            const fileName = String(body?.fileName || "Unzipped Rendering Studio Package");
            try {
              const entries = await downloadFolderEntries({
                projectId,
                manifestText,
                uploads,
              });
              const validation = validateRenderingStudioPackageEntries(entries);
              const result = await importValidatedPackage({
                entries,
                validation,
                packageHash: hashPackageEntries(entries, validation.manifest),
                fileName,
                projectId,
                userId: auth.user.id,
              });
              return json(result);
            } finally {
              if (paths.length > 0) {
                await supabaseAdmin.storage.from(PACKAGE_BUCKET).remove(paths);
              }
            }
          }

          if (action === "cleanup") {
            const paths = Array.isArray(body?.paths) ? body.paths.map((path) => String(path)) : [];
            validateTemporaryCleanupPaths(projectId, paths);
            const { error } = await supabaseAdmin.storage.from(PACKAGE_BUCKET).remove(paths);
            if (error) throw error;
            return json({ removed: paths.length });
          }

          return json({ error: "Unsupported import action." }, 400);
        } catch (error) {
          console.error("Rendering Studio package import failed", error);
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "The Rendering Studio package could not be imported.",
            },
            400,
          );
        }
      },
    },
  },
});
