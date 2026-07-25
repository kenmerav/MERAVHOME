import { useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FolderOpen, Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const MAX_PACKAGE_BYTES = 150 * 1024 * 1024;

type PackageAssetGroup = "cad" | "renders" | "final-sheets";

type DroppedFileEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: DroppedFileEntry[]) => void,
      failure?: (error: DOMException) => void,
    ) => void;
  };
};

async function readDroppedEntry(entry: DroppedFileEntry): Promise<File[]> {
  if (entry.isFile && entry.file) {
    return new Promise<File[]>((resolve, reject) => {
      entry.file?.((file) => resolve([file]), reject);
    });
  }
  if (!entry.isDirectory || !entry.createReader) return [];

  const reader = entry.createReader();
  const children: DroppedFileEntry[] = [];
  while (true) {
    const batch = await new Promise<DroppedFileEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map(readDroppedEntry))).flat();
}

async function readDroppedFiles(event: DragEvent<HTMLElement>) {
  const entries = Array.from(event.dataTransfer.items)
    .map((item) =>
      (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => DroppedFileEntry | null;
        }
      ).webkitGetAsEntry?.(),
    )
    .filter((entry): entry is DroppedFileEntry => Boolean(entry));
  if (entries.length === 0) return Array.from(event.dataTransfer.files);
  return (await Promise.all(entries.map(readDroppedEntry))).flat();
}

async function uploadTemporaryPackageFile({
  file,
  bucket,
  path,
  token,
  contentType,
}: {
  file: Blob;
  bucket: string;
  path: string;
  token: string;
  contentType: string;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, {
      contentType,
      cacheControl: "3600",
    });
    if (!error) return;
    const status = Number(
      (error as { status?: number; statusCode?: string | number }).status ||
        (error as { statusCode?: string | number }).statusCode,
    );
    const transient = status >= 500 || /bad gateway|temporarily unavailable/i.test(error.message);
    if (!transient || attempt === 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
}

function normalizeSelectedFolder(files: FileList) {
  const selected = Array.from(files).filter(
    (file) => !file.webkitRelativePath.split("/").includes(".DS_Store"),
  );
  const rootSegments = selected
    .map((file) => file.webkitRelativePath.split("/")[0])
    .filter(Boolean);
  const commonRoot =
    rootSegments.length > 0 && rootSegments.every((segment) => segment === rootSegments[0])
      ? rootSegments[0]
      : "";
  return new Map(
    selected.map((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const normalizedPath =
        commonRoot && relativePath.startsWith(`${commonRoot}/`)
          ? relativePath.slice(commonRoot.length + 1)
          : relativePath;
      return [normalizedPath, file] as const;
    }),
  );
}

function folderDisplayName(files: FileList) {
  const firstPath = files[0]?.webkitRelativePath || "";
  return firstPath.split("/")[0] || "Unzipped Rendering Studio Package";
}

async function uploadFolderFiles({
  filesByPath,
  bucket,
  uploads,
  onProgress,
}: {
  filesByPath: Map<string, File>;
  bucket: string;
  uploads: Array<{ sourcePath: string; path: string; token: string }>;
  onProgress: (progress: number) => void;
}) {
  const totalBytes = uploads.reduce(
    (total, upload) => total + (filesByPath.get(upload.sourcePath)?.size ?? 0),
    0,
  );
  let uploadedBytes = 0;
  for (const upload of uploads) {
    const file = filesByPath.get(upload.sourcePath);
    if (!file) {
      throw new Error(`The selected folder is missing ${upload.sourcePath}.`);
    }
    await uploadTemporaryPackageFile({
      file,
      bucket,
      path: upload.path,
      token: upload.token,
      contentType: file.type || "application/octet-stream",
    });
    uploadedBytes += file.size;
    onProgress(totalBytes > 0 ? Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)) : 99);
  }
}

type ImportedElevation = {
  id: string;
  sheet: string;
  room: string;
  title: string;
  presentationOrder: number;
  approval: string;
  autocad: boolean;
  finalRendering: boolean;
  finalSheet: boolean;
};

type ImportResult = {
  projectName: string;
  elevationCount: number;
  assetCount: number;
  roomsCreated: string[];
  elevations: ImportedElevation[];
};

async function packageImportRequest(
  projectId: string,
  action:
    | "prepare"
    | "import"
    | "cleanup"
    | "prepare-folder"
    | "prepare-folder-group"
    | "import-folder",
  payload: Record<string, unknown>,
) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to import a Rendering Studio package.");
  const response = await fetch("/api/import-rendering-package", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, projectId, ...payload }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error || "Rendering package import failed."));
  return body;
}

export function ImportRenderingPackageDialog({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const manifestInputRef = useRef<HTMLInputElement | null>(null);
  const cadInputRef = useRef<HTMLInputElement | null>(null);
  const rendersInputRef = useRef<HTMLInputElement | null>(null);
  const finalSheetsInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [assetGroups, setAssetGroups] = useState<Record<PackageAssetGroup, File[]>>({
    cad: [],
    renders: [],
    "final-sheets": [],
  });
  const [stagedImportId, setStagedImportId] = useState("");
  const [stagedUploads, setStagedUploads] = useState<Array<{ sourcePath: string; path: string }>>(
    [],
  );
  const [uploadedGroups, setUploadedGroups] = useState<Record<PackageAssetGroup, boolean>>({
    cad: false,
    renders: false,
    "final-sheets": false,
  });

  const reset = () => {
    const temporaryPaths = stagedUploads.map((upload) => upload.path);
    if (temporaryPaths.length > 0) {
      void packageImportRequest(projectId, "cleanup", {
        paths: temporaryPaths,
      }).catch(() => undefined);
    }
    setFileName("");
    setImporting(false);
    setUploadProgress(0);
    setError("");
    setResult(null);
    setManifestFile(null);
    setAssetGroups({ cad: [], renders: [], "final-sheets": [] });
    setStagedImportId("");
    setStagedUploads([]);
    setUploadedGroups({ cad: false, renders: false, "final-sheets": false });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (manifestInputRef.current) manifestInputRef.current.value = "";
    if (cadInputRef.current) cadInputRef.current.value = "";
    if (rendersInputRef.current) rendersInputRef.current.value = "";
    if (finalSheetsInputRef.current) finalSheetsInputRef.current.value = "";
  };

  const completeImport = async (imported: ImportResult) => {
    setResult(imported);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rooms", projectId] }),
      queryClient.invalidateQueries({
        queryKey: ["projectRoomImages", projectId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["renderingStudioElevations", projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["designBoard", projectId] }),
    ]);
    toast.success(
      `${imported.elevationCount} Rendering Studio elevations imported with ${imported.assetCount} separate assets.`,
    );
  };

  const importFile = async (file: File | null) => {
    if (!file || importing) return;
    setError("");
    setResult(null);
    setFileName(file.name);
    setUploadProgress(0);
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Choose a .zip package exported from Merav Rendering Studio.");
      return;
    }
    if (file.size > MAX_PACKAGE_BYTES) {
      setError("Rendering packages must be 150 MB or smaller.");
      return;
    }

    setImporting(true);
    let preparedPaths: string[] = [];
    try {
      const prepared = await packageImportRequest(projectId, "prepare", {
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "application/zip",
      });
      const bucket = String(prepared.bucket || "");
      const partSizeBytes = Number(prepared.partSizeBytes || 0);
      const uploads = Array.isArray(prepared.uploads)
        ? prepared.uploads.map((upload) => {
            const value = upload as Record<string, unknown>;
            return {
              path: String(value.path || ""),
              token: String(value.token || ""),
            };
          })
        : [];
      const expectedPartCount = partSizeBytes > 0 ? Math.ceil(file.size / partSizeBytes) : 0;
      if (
        !bucket ||
        !partSizeBytes ||
        uploads.length !== expectedPartCount ||
        uploads.some((upload) => !upload.path || !upload.token)
      ) {
        throw new Error("The package upload could not be prepared.");
      }
      preparedPaths = uploads.map((upload) => upload.path);

      for (const [index, upload] of uploads.entries()) {
        const partStart = index * partSizeBytes;
        const partEnd = Math.min(file.size, partStart + partSizeBytes);
        const part = file.slice(partStart, partEnd, "application/octet-stream");
        await uploadTemporaryPackageFile({
          file: part,
          bucket,
          path: upload.path,
          token: upload.token,
          contentType: "application/octet-stream",
        });
        setUploadProgress(Math.min(99, Math.round((partEnd / file.size) * 100)));
      }
      setUploadProgress(100);

      const imported = (await packageImportRequest(projectId, "import", {
        paths: preparedPaths,
        fileName: file.name,
      })) as unknown as ImportResult;
      preparedPaths = [];
      await completeImport(imported);
    } catch (importError) {
      if (preparedPaths.length > 0) {
        await packageImportRequest(projectId, "cleanup", {
          paths: preparedPaths,
        }).catch(() => undefined);
      }
      const message =
        importError instanceof Error ? importError.message : "Rendering package import failed.";
      setError(message);
      toast.error(message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const importFolderFiles = async (filesByPath: Map<string, File>, displayName: string) => {
    if (importing) return;
    setError("");
    setResult(null);
    setUploadProgress(0);
    setFileName(displayName);
    const manifestFile = filesByPath.get("manifest.json");
    if (!manifestFile) {
      setError(
        "Choose the parent package folder containing manifest.json, cad, renders, and final-sheets.",
      );
      if (folderInputRef.current) folderInputRef.current.value = "";
      return;
    }

    setImporting(true);
    let preparedPaths: string[] = [];
    try {
      const manifestText = await manifestFile.text();
      const prepared = await packageImportRequest(projectId, "prepare-folder", {
        manifestText,
        files: Array.from(filesByPath, ([path, file]) => ({
          path,
          size: file.size,
        })),
      });
      const bucket = String(prepared.bucket || "");
      const uploads = Array.isArray(prepared.uploads)
        ? prepared.uploads.map((upload) => {
            const value = upload as Record<string, unknown>;
            return {
              sourcePath: String(value.sourcePath || ""),
              path: String(value.path || ""),
              token: String(value.token || ""),
            };
          })
        : [];
      if (
        !bucket ||
        uploads.length < 1 ||
        uploads.some((upload) => !upload.sourcePath || !upload.path || !upload.token)
      ) {
        throw new Error("The folder upload could not be prepared.");
      }
      preparedPaths = uploads.map((upload) => upload.path);
      await uploadFolderFiles({
        filesByPath,
        bucket,
        uploads,
        onProgress: setUploadProgress,
      });
      setUploadProgress(100);

      const imported = (await packageImportRequest(projectId, "import-folder", {
        manifestText,
        fileName: displayName,
        uploads: uploads.map(({ sourcePath, path }) => ({
          sourcePath,
          path,
        })),
      })) as unknown as ImportResult;
      preparedPaths = [];
      await completeImport(imported);
    } catch (importError) {
      if (preparedPaths.length > 0) {
        await packageImportRequest(projectId, "cleanup", {
          paths: preparedPaths,
        }).catch(() => undefined);
      }
      const message =
        importError instanceof Error
          ? importError.message
          : "Rendering package folder import failed.";
      setError(message);
      toast.error(message);
    } finally {
      setImporting(false);
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const importFolder = async (files: FileList | null) => {
    if (!files?.length || importing) return;
    await importFolderFiles(normalizeSelectedFolder(files), folderDisplayName(files));
  };

  const setDroppedAssetGroup = async (group: PackageAssetGroup, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const files = (await readDroppedFiles(event)).filter((file) => file.name !== ".DS_Store");
    setAssetGroups((current) => ({ ...current, [group]: files }));
  };

  const setDroppedManifest = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const files = await readDroppedFiles(event);
    const manifest = files.find((file) => file.name.toLowerCase() === "manifest.json");
    if (!manifest) {
      setError("Drop the manifest.json file here.");
      return;
    }
    setError("");
    setManifestFile(manifest);
  };

  const uploadStagedGroup = async (group: PackageAssetGroup) => {
    if (!manifestFile) {
      setError("Add manifest.json before uploading an image folder.");
      return;
    }
    const files = assetGroups[group];
    if (files.length === 0) {
      setError(`Add the ${group} folder before uploading it.`);
      return;
    }

    setImporting(true);
    setError("");
    setUploadProgress(0);
    setFileName(`Uploading ${group}`);
    let preparedPaths: string[] = [];
    try {
      const manifestText = await manifestFile.text();
      const filesByPath = new Map(files.map((file) => [`${group}/${file.name}`, file] as const));
      const prepared = await packageImportRequest(projectId, "prepare-folder-group", {
        manifestText,
        group,
        importId: stagedImportId || undefined,
        files: Array.from(filesByPath, ([path, file]) => ({
          path,
          size: file.size,
        })),
      });
      const bucket = String(prepared.bucket || "");
      const importId = String(prepared.importId || "");
      const uploads = Array.isArray(prepared.uploads)
        ? prepared.uploads.map((upload) => {
            const value = upload as Record<string, unknown>;
            return {
              sourcePath: String(value.sourcePath || ""),
              path: String(value.path || ""),
              token: String(value.token || ""),
            };
          })
        : [];
      if (
        !bucket ||
        !importId ||
        uploads.length < 1 ||
        uploads.some((upload) => !upload.sourcePath || !upload.path || !upload.token)
      ) {
        throw new Error(`The ${group} folder upload could not be prepared.`);
      }
      preparedPaths = uploads.map((upload) => upload.path);
      await uploadFolderFiles({
        filesByPath,
        bucket,
        uploads,
        onProgress: setUploadProgress,
      });
      setStagedImportId(importId);
      setStagedUploads((current) => [
        ...current.filter(
          (existing) => !uploads.some((upload) => upload.sourcePath === existing.sourcePath),
        ),
        ...uploads.map(({ sourcePath, path }) => ({ sourcePath, path })),
      ]);
      setUploadedGroups((current) => ({ ...current, [group]: true }));
      setUploadProgress(100);
      toast.success(`${group === "final-sheets" ? "Final sheets" : group} uploaded successfully.`);
    } catch (uploadError) {
      if (preparedPaths.length > 0) {
        await packageImportRequest(projectId, "cleanup", {
          paths: preparedPaths,
        }).catch(() => undefined);
      }
      const message =
        uploadError instanceof Error ? uploadError.message : `The ${group} folder upload failed.`;
      setError(message);
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const finishStagedImport = async () => {
    if (
      !manifestFile ||
      !uploadedGroups.cad ||
      !uploadedGroups.renders ||
      !uploadedGroups["final-sheets"]
    ) {
      setError("Upload CAD, renders, and final sheets before importing.");
      return;
    }
    setImporting(true);
    setError("");
    setUploadProgress(100);
    setFileName("Validating the complete folder package");
    try {
      const manifestText = await manifestFile.text();
      const imported = (await packageImportRequest(projectId, "import-folder", {
        manifestText,
        fileName: "Moore Residence folder package",
        uploads: stagedUploads,
      })) as unknown as ImportResult;
      setStagedUploads([]);
      setStagedImportId("");
      await completeImport(imported);
    } catch (importError) {
      setStagedUploads([]);
      setStagedImportId("");
      setUploadedGroups({
        cad: false,
        renders: false,
        "final-sheets": false,
      });
      const message =
        importError instanceof Error
          ? importError.message
          : "The staged rendering package import failed.";
      setError(message);
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const completeElevations =
    result?.elevations.filter(
      (elevation) => elevation.autocad && elevation.finalRendering && elevation.finalSheet,
    ).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && !importing) reset();
      }}
    >
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 border border-ink px-4 py-3 text-sm transition-colors hover:bg-ink hover:text-primary-foreground">
          <PackageOpen className="h-4 w-4" />
          Import Rendering Package
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">
            Import Rendering Studio Package
          </DialogTitle>
        </DialogHeader>

        <div className="mt-3 space-y-5">
          <p className="text-sm leading-6 text-muted-foreground">
            Choose the ZIP exported by Merav Rendering Studio, or select its unzipped parent folder.
            Studio validates manifest.json and all three required files for every elevation before
            saving the import.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="sr-only"
            onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
          />
          <input
            ref={folderInputRef}
            type="file"
            className="sr-only"
            webkitdirectory=""
            onChange={(event) => void importFolder(event.target.files)}
          />
          <input
            ref={manifestInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setManifestFile(file);
              setError("");
            }}
          />
          <input
            ref={cadInputRef}
            type="file"
            multiple
            className="sr-only"
            webkitdirectory=""
            onChange={(event) =>
              setAssetGroups((current) => ({
                ...current,
                cad: Array.from(event.target.files ?? []),
              }))
            }
          />
          <input
            ref={rendersInputRef}
            type="file"
            multiple
            className="sr-only"
            webkitdirectory=""
            onChange={(event) =>
              setAssetGroups((current) => ({
                ...current,
                renders: Array.from(event.target.files ?? []),
              }))
            }
          />
          <input
            ref={finalSheetsInputRef}
            type="file"
            multiple
            className="sr-only"
            webkitdirectory=""
            onChange={(event) =>
              setAssetGroups((current) => ({
                ...current,
                "final-sheets": Array.from(event.target.files ?? []),
              }))
            }
          />

          {!result && (
            <>
              {importing ? (
                <div className="flex min-h-56 w-full flex-col items-center justify-center border border-dashed border-border bg-bone/30 px-6 text-center">
                  <Loader2 className="mb-4 h-8 w-8 animate-spin" />
                  <span className="font-display text-2xl">
                    {uploadProgress < 100
                      ? `Uploading package · ${uploadProgress}%`
                      : "Validating and importing"}
                  </span>
                  <span className="mt-2 text-sm text-muted-foreground">{fileName}</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex min-h-40 flex-col items-center justify-center border border-dashed border-border bg-bone/30 px-6 text-center transition-colors hover:border-ink"
                    >
                      <PackageOpen className="mb-3 h-7 w-7 text-muted-foreground" />
                      <span className="font-display text-xl">Choose Rendering Studio ZIP</span>
                      <span className="mt-2 text-xs text-muted-foreground">ZIP · up to 150 MB</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => folderInputRef.current?.click()}
                      className="flex min-h-40 flex-col items-center justify-center border border-dashed border-border bg-bone/30 px-6 text-center transition-colors hover:border-ink"
                    >
                      <FolderOpen className="mb-3 h-7 w-7 text-muted-foreground" />
                      <span className="font-display text-xl">Choose Whole Unzipped Folder</span>
                      <span className="mt-2 text-xs text-muted-foreground">
                        Select the parent package folder
                      </span>
                    </button>
                  </div>

                  <div className="border border-border p-4">
                    <div className="mb-3">
                      <div className="font-medium">Or add the package pieces separately</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Drop each folder into its matching box. Add manifest.json once, then import.
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={Boolean(stagedImportId)}
                        onClick={() => manifestInputRef.current?.click()}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => void setDroppedManifest(event)}
                        className="min-h-28 border border-dashed border-border bg-bone/20 p-4 text-left transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <div className="text-sm font-medium">Drop manifest.json here</div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {manifestFile
                            ? `Ready · ${manifestFile.name}`
                            : "Or click to choose the JSON file"}
                        </div>
                      </button>
                      {(
                        [
                          ["cad", "Drop CAD folder here", cadInputRef],
                          ["renders", "Drop renders folder here", rendersInputRef],
                          ["final-sheets", "Drop final sheets folder here", finalSheetsInputRef],
                        ] as const
                      ).map(([group, label, inputRef]) => {
                        const previousGroupUploaded =
                          group === "cad" ||
                          (group === "renders" && uploadedGroups.cad) ||
                          (group === "final-sheets" &&
                            uploadedGroups.cad &&
                            uploadedGroups.renders);
                        const canUpload =
                          Boolean(manifestFile) &&
                          assetGroups[group].length > 0 &&
                          previousGroupUploaded &&
                          !uploadedGroups[group];
                        return (
                          <div key={group} className="border border-border p-2">
                            <button
                              type="button"
                              disabled={uploadedGroups[group]}
                              onClick={() => inputRef.current?.click()}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => void setDroppedAssetGroup(group, event)}
                              className="min-h-20 w-full border border-dashed border-border bg-bone/20 p-3 text-left transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <div className="text-sm font-medium">{label}</div>
                              <div className="mt-2 text-xs text-muted-foreground">
                                {uploadedGroups[group]
                                  ? `Uploaded · ${assetGroups[group].length} files`
                                  : assetGroups[group].length > 0
                                    ? `Selected · ${assetGroups[group].length} files`
                                    : "Or click to choose the folder"}
                              </div>
                            </button>
                            <button
                              type="button"
                              disabled={!canUpload}
                              onClick={() => void uploadStagedGroup(group)}
                              className="mt-2 w-full bg-ink px-3 py-2 text-xs text-primary-foreground disabled:cursor-not-allowed disabled:opacity-35"
                            >
                              {uploadedGroups[group]
                                ? "Upload complete"
                                : group === "cad"
                                  ? "1. Upload CAD"
                                  : group === "renders"
                                    ? "2. Upload Renders"
                                    : "3. Upload Final Sheets"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={
                        !uploadedGroups.cad ||
                        !uploadedGroups.renders ||
                        !uploadedGroups["final-sheets"]
                      }
                      onClick={() => void finishStagedImport()}
                      className="mt-4 w-full bg-ink px-5 py-3 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      4. Validate and Complete Import
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="flex items-start gap-3 border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <div className="font-medium text-destructive">Import not completed</div>
                <div className="mt-1 text-muted-foreground">{error}</div>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div className="border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 font-medium text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  Import complete
                </div>
                <div className="mt-2 text-sm text-emerald-900">
                  {completeElevations} of {result.elevationCount} elevations have their AutoCAD
                  drawing, final rendering, and final sheet. {result.assetCount} separate assets
                  were validated.
                </div>
                {result.roomsCreated.length > 0 && (
                  <div className="mt-2 text-xs text-emerald-800">
                    Rooms created: {result.roomsCreated.join(", ")}
                  </div>
                )}
              </div>

              <div className="max-h-[46vh] overflow-y-auto border border-border">
                {result.elevations.map((elevation) => (
                  <div
                    key={elevation.id}
                    className="grid gap-3 border-b border-border p-3 last:border-b-0 sm:grid-cols-[5rem_1fr_auto]"
                  >
                    <div className="text-xs text-muted-foreground">
                      <div className="font-medium text-ink">{elevation.sheet}</div>
                      <div>#{elevation.presentationOrder}</div>
                    </div>
                    <div>
                      <div className="text-sm font-medium">{elevation.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {elevation.room} · {elevation.id}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-emerald-700">
                      <span>CAD ✓</span>
                      <span>Render ✓</span>
                      <span>Sheet ✓</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="bg-ink px-5 py-2.5 text-sm text-primary-foreground"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
