import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Clipboard,
  Download,
  FileArchive,
  FileImage,
  FileText,
  History,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { unzipSync } from "fflate";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  buildCodexCorrectionPrompt,
  buildCodexRenderingPrompt,
  defaultRenderingResultFilename,
  matchRenderingResultFilenames,
} from "@/lib/renderingStudioWorkflow";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects/$id/rendering-studio")({
  head: () => ({ meta: [{ title: "Rendering Studio - MERAV Studio" }] }),
  component: RenderingStudioPage,
});

type StudioSource = {
  id: string;
  package_id: string;
  source_type: "autocad_pdf" | "autocad_image" | "specification_pdf" | "supporting_material";
  label: string;
  filename: string;
  storage_path: string;
  page_number: number | null;
  url: string;
};

type StudioMaterial = {
  id: string;
  room_id: string;
  item_label: string | null;
  cad_label: string | null;
  client_product_name: string | null;
  category: string | null;
  color: string | null;
  quantity: number | null;
  notes: string | null;
  image_url: string | null;
  product_url: string | null;
  product?: {
    name?: string | null;
    vendor?: string | null;
    finish?: string | null;
    image_url?: string | null;
  } | null;
};

type StudioAsset = {
  id: string;
  asset_type: "autocad" | "final_rendering" | "final_sheet";
  filename: string;
  url: string;
};

type StudioRevision = {
  id: string;
  revision_number: number;
  status: string;
  correction_note: string | null;
  rendering_url: string;
  final_sheet_url: string | null;
  created_at: string;
};

type StudioElevation = {
  id: string;
  elevation_id: string;
  sheet_number: string;
  room_id: string;
  room_name: string;
  title: string;
  materials: Array<Record<string, unknown>>;
  presentation_order: number;
  expected_cad_filename: string | null;
  expected_render_filename: string;
  expected_sheet_filename: string | null;
  workflow_status: string;
  correction_note: string | null;
  current_revision_number: number;
  room?: { id: string; name: string } | null;
  assets: StudioAsset[];
  revisions: StudioRevision[];
};

type StudioBootstrap = {
  project: { id: string; name: string; client_name: string | null };
  rooms: Array<{ id: string; name: string; sort_order: number }>;
  materials: StudioMaterial[];
  activePackage: {
    id: string;
    workflow_status: string;
    handoff_generated_at: string | null;
  } | null;
  sources: StudioSource[];
  elevations: StudioElevation[];
};

type ElevationDraft = {
  sourceId: string;
  elevationId: string;
  sheetNumber: string;
  roomId: string;
  title: string;
  presentationOrder: number;
  expectedRenderFilename: string;
  expectedSheetFilename: string;
  materialIds: string[];
};

type PreparedUpload = {
  filename: string;
  path: string;
  token: string;
  mimeType: string;
  size: number;
};

const workflowLabels: Record<string, string> = {
  source_files_uploaded: "Source files uploaded",
  ready_for_codex: "Ready for Codex",
  rendering_in_progress: "Rendering in progress",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  correction_requested: "Correction requested",
  superseded: "Superseded",
};

async function authToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to use Rendering Studio.");
  return token;
}

async function studioRequest<T>(
  projectId: string,
  action: string,
  payload: Record<string, unknown> = {},
) {
  const response = await fetch("/api/rendering-studio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await authToken()}`,
    },
    body: JSON.stringify({ projectId, action, ...payload }),
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Rendering Studio could not continue.");
  return body;
}

async function loadStudio(projectId: string) {
  const response = await fetch(`/api/rendering-studio?projectId=${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${await authToken()}` },
  });
  const body = (await response.json().catch(() => ({}))) as StudioBootstrap & {
    error?: string;
  };
  if (!response.ok) throw new Error(body.error || "Rendering Studio could not load.");
  return body;
}

function filenameFromDisposition(response: Response, fallback: string) {
  const match = response.headers.get("content-disposition")?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sourceTypeForFile(file: File, group: "autocad" | "support") {
  if (group === "support") return "supporting_material";
  return file.name.toLowerCase().endsWith(".pdf") ? "autocad_pdf" : "autocad_image";
}

function materialName(material: StudioMaterial) {
  return (
    material.item_label ||
    material.cad_label ||
    material.client_product_name ||
    material.product?.name ||
    "Material"
  );
}

function materialImageUrl(material: StudioMaterial) {
  return material.image_url || material.product?.image_url || null;
}

function suggestRoomId(filename: string, rooms: StudioBootstrap["rooms"]) {
  const haystack = filename.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const matches = rooms
    .filter((room) => haystack.includes(room.name.toLowerCase().replace(/[^a-z0-9]+/g, " ")))
    .sort((a, b) => b.name.length - a.name.length);
  return matches[0]?.id || "";
}

function promptElevation(elevation: StudioElevation, correctionNote = elevation.correction_note) {
  const autocad = elevation.assets.find((asset) => asset.asset_type === "autocad");
  return {
    elevationId: elevation.elevation_id,
    sheetNumber: elevation.sheet_number,
    roomName: elevation.room?.name || elevation.room_name,
    title: elevation.title,
    presentationOrder: elevation.presentation_order,
    expectedRenderFilename: elevation.expected_render_filename,
    expectedSheetFilename: elevation.expected_sheet_filename,
    autocadFilename: elevation.expected_cad_filename || autocad?.filename || "AutoCAD source",
    materials: elevation.materials.map((material) => ({
      name: String(material.name || material.item_label || "Material"),
      category: material.category ? String(material.category) : null,
      finish: material.finish ? String(material.finish) : null,
      quantity: material.quantity ? Number(material.quantity) : null,
      notes: material.notes ? String(material.notes) : null,
    })),
    correctionNote,
  };
}

function statusClass(status: string) {
  if (status === "approved") return "bg-emerald-100 text-emerald-800";
  if (status === "correction_requested" || status === "rejected") {
    return "bg-red-100 text-red-800";
  }
  if (status === "pending_review") return "bg-amber-100 text-amber-800";
  return "bg-stone-100 text-stone-700";
}

function RenderingStudioPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [sourceLabel, setSourceLabel] = useState("");
  const [uploadingSources, setUploadingSources] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [savingElevations, setSavingElevations] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [resultBusy, setResultBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [drafts, setDrafts] = useState<ElevationDraft[]>([]);
  const [resultReport, setResultReport] = useState<{
    imported: number;
    unchanged: number;
    missing: string[];
    duplicates: string[];
    unexpected: string[];
  } | null>(null);
  const autocadRef = useRef<HTMLInputElement | null>(null);
  const supportRef = useRef<HTMLInputElement | null>(null);
  const resultRef = useRef<HTMLInputElement | null>(null);

  const query = useQuery({
    queryKey: ["renderingStudioWorkflow", id],
    queryFn: () => loadStudio(id),
    retry: false,
  });
  const studio = query.data;

  const autocadSources = useMemo(
    () =>
      (studio?.sources ?? [])
        .filter((source) => source.source_type === "autocad_image")
        .sort(
          (a, b) =>
            Number(a.page_number || 0) - Number(b.page_number || 0) ||
            a.filename.localeCompare(b.filename),
        ),
    [studio?.sources],
  );

  useEffect(() => {
    if (!studio) return;
    const materialIdsByRoom = new Map<string, string[]>();
    studio.materials.forEach((material) => {
      const current = materialIdsByRoom.get(material.room_id) ?? [];
      current.push(material.id);
      materialIdsByRoom.set(material.room_id, current);
    });
    const elevationByCadPath = new Map(
      studio.elevations.flatMap((elevation) => {
        const cad = elevation.assets.find((asset) => asset.asset_type === "autocad");
        return cad ? [[cad.storage_path, elevation] as const] : [];
      }),
    );
    setDrafts(
      autocadSources.map((source, index) => {
        const existing = elevationByCadPath.get(source.storage_path);
        const roomId = existing?.room_id || suggestRoomId(source.filename, studio.rooms);
        const ids = existing?.materials
          .map((material) => String(material.id || ""))
          .filter(Boolean);
        const elevationId = existing?.elevation_id || `ELEV-${String(index + 1).padStart(2, "0")}`;
        const roomName = studio.rooms.find((room) => room.id === roomId)?.name || "Room";
        return {
          sourceId: source.id,
          elevationId,
          sheetNumber: existing?.sheet_number || `Page ${source.page_number || index + 1}`,
          roomId,
          title: existing?.title || source.label,
          presentationOrder: existing?.presentation_order || index + 1,
          expectedRenderFilename:
            existing?.expected_render_filename ||
            defaultRenderingResultFilename(elevationId, roomName),
          expectedSheetFilename:
            existing?.expected_sheet_filename ||
            defaultRenderingResultFilename(elevationId, roomName, "sheet"),
          materialIds: ids?.length ? ids : (materialIdsByRoom.get(roomId) ?? []),
        };
      }),
    );
  }, [autocadSources, studio]);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["renderingStudioWorkflow", id],
    });
    await queryClient.invalidateQueries({
      queryKey: ["renderingStudioElevations", id],
    });
  };

  const uploadPreparedFiles = async (files: File[], purpose: "source" | "result") => {
    const prepared = await studioRequest<{
      bucket: string;
      uploads: PreparedUpload[];
    }>(id, "prepare_uploads", {
      purpose,
      files: files.map((file) => ({
        filename: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      })),
    });
    const uploaded = [];
    for (const [index, upload] of prepared.uploads.entries()) {
      const file = files[index];
      const { error } = await supabase.storage
        .from(prepared.bucket)
        .uploadToSignedUrl(upload.path, upload.token, file, {
          contentType: file.type || upload.mimeType,
          cacheControl: "31536000",
        });
      if (error) throw error;
      uploaded.push({
        filename: file.name,
        path: upload.path,
        mimeType: file.type || upload.mimeType,
        size: file.size,
      });
    }
    return uploaded;
  };

  const uploadSources = async (fileList: FileList | null, group: "autocad" | "support") => {
    const files = Array.from(fileList ?? []);
    if (!files.length || uploadingSources) return;
    setUploadingSources(true);
    try {
      const uploaded = await uploadPreparedFiles(files, "source");
      const saved = await studioRequest<{
        package: { id: string };
        sources: StudioSource[];
      }>(id, "save_sources", {
        packageId: studio?.activePackage?.id,
        sourceLabel: sourceLabel.trim() || studio?.project.name,
        sources: uploaded.map((upload, index) => ({
          ...upload,
          sourceType: sourceTypeForFile(files[index], group),
          label: sourceLabel.trim() || files[index].name.replace(/\.[^/.]+$/, ""),
        })),
      });
      const pdfSources = saved.sources.filter((source) => source.source_type === "autocad_pdf");
      for (const source of pdfSources) {
        toast.info(`Extracting ${source.filename} into AutoCAD pages...`);
        await studioRequest(id, "extract_autocad_pdf", {
          sourceId: source.id,
        });
      }
      toast.success(
        pdfSources.length
          ? "Source files saved and AutoCAD pages extracted."
          : "Source files saved.",
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Source upload failed.");
    } finally {
      setUploadingSources(false);
      if (autocadRef.current) autocadRef.current.value = "";
      if (supportRef.current) supportRef.current.value = "";
    }
  };

  const removeSourceSet = async (source: StudioSource) => {
    if (source.source_type !== "autocad_pdf" || deletingSourceId) return;
    setDeletingSourceId(source.id);
    try {
      const result = await studioRequest<{ removedSources: number; removedElevations: number }>(
        id,
        "delete_source",
        { sourceId: source.id },
      );
      toast.success(
        `Removed ${source.filename} and ${Math.max(0, result.removedSources - 1)} extracted pages.`,
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Source removal failed.");
    } finally {
      setDeletingSourceId(null);
    }
  };

  const patchDraft = (sourceId: string, patch: Partial<ElevationDraft>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.sourceId === sourceId ? { ...draft, ...patch } : draft)),
    );
  };

  const chooseRoom = (draft: ElevationDraft, roomId: string) => {
    const roomName = studio?.rooms.find((room) => room.id === roomId)?.name || "Room";
    const roomMaterialIds = (studio?.materials ?? [])
      .filter((material) => material.room_id === roomId)
      .map((material) => material.id);
    patchDraft(draft.sourceId, {
      roomId,
      materialIds: roomMaterialIds,
      expectedRenderFilename: defaultRenderingResultFilename(draft.elevationId, roomName),
      expectedSheetFilename: defaultRenderingResultFilename(draft.elevationId, roomName, "sheet"),
    });
  };

  const saveElevations = async () => {
    if (!studio?.activePackage?.id) {
      toast.error("Upload at least one source file first.");
      return;
    }
    if (!drafts.length || drafts.some((draft) => !draft.roomId)) {
      toast.error("Assign every AutoCAD page to a room.");
      return;
    }
    setSavingElevations(true);
    try {
      await studioRequest(id, "save_elevations", {
        packageId: studio.activePackage.id,
        elevations: drafts.map((draft) => {
          const room = studio.rooms.find((item) => item.id === draft.roomId);
          const selected = studio.materials
            .filter((material) => draft.materialIds.includes(material.id))
            .map((material) => ({
              id: material.id,
              name: materialName(material),
              category: material.category,
              finish: material.color || material.product?.finish || null,
              quantity: material.quantity,
              notes: material.notes,
              vendor: material.product?.vendor || null,
              imageUrl: materialImageUrl(material),
            }));
          return {
            ...draft,
            roomName: room?.name || "",
            materials: selected,
            expectedSheetFilename: draft.expectedSheetFilename,
          };
        }),
      });
      toast.success("Elevation setup saved.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Elevation setup failed.");
    } finally {
      setSavingElevations(false);
    }
  };

  const copyPrompt = async (kind: "render" | "correction") => {
    if (!studio?.elevations.length) {
      toast.error("Save elevation setup first.");
      return;
    }
    const elevations = studio.elevations.map((elevation) => promptElevation(elevation));
    const prompt =
      kind === "render"
        ? buildCodexRenderingPrompt({
            projectName: studio.project.name,
            elevations,
            packFilename: `${studio.project.name}_Codex_Render_Pack.zip`,
          })
        : buildCodexCorrectionPrompt({
            projectName: studio.project.name,
            elevations,
          });
    await navigator.clipboard.writeText(prompt);
    toast.success(
      kind === "render" ? "Codex rendering prompt copied." : "Correction prompt copied.",
    );
  };

  const downloadFromAction = async (action: "create_render_pack" | "download_backup") => {
    if (action === "create_render_pack") setHandoffBusy(true);
    else setBackupBusy(true);
    try {
      const response = await fetch("/api/rendering-studio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await authToken()}`,
        },
        body: JSON.stringify({ projectId: id, action }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Download failed.");
      }
      downloadBlob(
        await response.blob(),
        filenameFromDisposition(
          response,
          action === "create_render_pack" ? "Codex_Render_Pack.zip" : "Rendering_Studio_Backup.zip",
        ),
      );
      if (action === "create_render_pack") await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setHandoffBusy(false);
      setBackupBusy(false);
    }
  };

  const filesFromResults = async (fileList: FileList | null) => {
    const selected = Array.from(fileList ?? []);
    const images: File[] = [];
    for (const file of selected) {
      if (file.name.toLowerCase().endsWith(".zip")) {
        const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
        Object.entries(archive).forEach(([entryName, bytes]) => {
          if (!/\.(png|jpe?g|webp)$/i.test(entryName)) return;
          const filename = entryName.split("/").pop() || entryName;
          const type = filename.toLowerCase().endsWith(".png")
            ? "image/png"
            : filename.toLowerCase().endsWith(".webp")
              ? "image/webp"
              : "image/jpeg";
          images.push(new File([bytes], filename, { type }));
        });
      } else if (file.type.startsWith("image/")) {
        images.push(file);
      }
    }
    return images;
  };

  const importResults = async (fileList: FileList | null) => {
    if (!studio?.elevations.length || resultBusy) return;
    setResultBusy(true);
    setResultReport(null);
    try {
      const files = await filesFromResults(fileList);
      if (!files.length) throw new Error("Choose result images or a ZIP containing images.");
      const check = matchRenderingResultFilenames(
        studio.elevations.map((elevation) => ({
          elevationId: elevation.elevation_id,
          expectedRenderFilename: elevation.expected_render_filename,
          expectedSheetFilename: elevation.expected_sheet_filename,
        })),
        files.map((file) => file.name),
      );
      const acceptedNames = new Set(check.matches.map((match) => match.uploadedFilename));
      const accepted = files.filter((file) => acceptedNames.has(file.name));
      if (!accepted.length) {
        setResultReport({
          imported: 0,
          unchanged: 0,
          missing: check.missing,
          duplicates: check.duplicates,
          unexpected: check.unexpected,
        });
        throw new Error("No files matched the expected elevation filenames.");
      }
      const uploaded = await uploadPreparedFiles(accepted, "result");
      const report = await studioRequest<typeof resultReport>(id, "import_results", {
        uploads: uploaded,
      });
      setResultReport(report);
      toast.success(
        `${report?.imported || 0} elevation result${report?.imported === 1 ? "" : "s"} imported.`,
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Result import failed.");
    } finally {
      setResultBusy(false);
      if (resultRef.current) resultRef.current.value = "";
    }
  };

  const reviewElevation = async (
    elevationId: string,
    decision: "approve" | "reject",
    correctionNote = "",
  ) => {
    try {
      await studioRequest(id, "review_elevation", {
        elevationId,
        decision,
        correctionNote,
      });
      toast.success(
        decision === "approve" ? "Elevation approved for presentation." : "Correction requested.",
      );
      await refresh();
      await queryClient.invalidateQueries({
        queryKey: ["renderingStudioElevations", id],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Review could not be saved.");
    }
  };

  if (query.isLoading) {
    return (
      <AppShell>
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading Rendering Studio
        </div>
      </AppShell>
    );
  }

  if (query.error || !studio) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-5 py-12">
          <Link
            to="/projects/$id"
            params={{ id }}
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to project
          </Link>
          <div className="border border-amber-300 bg-amber-50 p-6">
            <h1 className="font-serif text-3xl">Rendering Studio setup needed</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-amber-950">
              {query.error instanceof Error
                ? query.error.message
                : "The local Rendering Studio workflow is not ready yet."}
            </p>
            <p className="mt-3 text-sm text-amber-900">
              This build remains local. No production project data was changed.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const approvedCount = studio.elevations.filter(
    (elevation) => elevation.workflow_status === "approved",
  ).length;
  const rejected = studio.elevations.filter(
    (elevation) => elevation.workflow_status === "correction_requested",
  );

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8">
        <header className="border-b border-border pb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Link
                to="/projects/$id"
                params={{ id }}
                className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to {studio.project.name}
              </Link>
              <h1 className="font-serif text-4xl">Rendering Studio</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {studio.activePackage
                  ? workflowLabels[studio.activePackage.workflow_status] ||
                    studio.activePackage.workflow_status
                  : "Start with project source files"}
                {studio.elevations.length
                  ? ` · ${approvedCount} of ${studio.elevations.length} approved`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/projects/$id/renderings"
                params={{ id }}
                className="border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                Project renderings
              </Link>
              <Link
                to="/presentations/$id"
                params={{ id }}
                className="border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                Presentation
              </Link>
              <button
                type="button"
                onClick={() => downloadFromAction("download_backup")}
                disabled={backupBusy || !studio.elevations.length}
                className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-40"
              >
                {backupBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Backup ZIP
              </button>
            </div>
          </div>
          {studio.elevations.length > 0 && (
            <div className="mt-5 h-2 overflow-hidden bg-stone-200">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{
                  width: `${(approvedCount / studio.elevations.length) * 100}%`,
                }}
              />
            </div>
          )}
        </header>

        <section className="border-b border-border py-8">
          <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Step 1
              </div>
              <h2 className="mt-2 font-serif text-2xl">Source files</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                AutoCAD originals and optional reference images remain private project files.
              </p>
            </div>
            <div>
              <div className="mb-5 max-w-md">
                <Label htmlFor="source-label">Source label</Label>
                <Input
                  id="source-label"
                  value={sourceLabel}
                  onChange={(event) => setSourceLabel(event.target.value)}
                  placeholder={`${studio.project.name} AutoCAD`}
                  className="mt-2"
                />
              </div>
              <div className="mb-4 flex items-start gap-3 border-y border-border py-3 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">Project Spec Book connected automatically</div>
                  <div className="mt-1 text-muted-foreground">
                    Room material images, finishes, quantities, notes, and product details are
                    pulled directly from this project.
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <SourceUploadButton
                  icon={FileText}
                  title="AutoCAD PDF or images"
                  detail="PDF pages extract automatically"
                  inputRef={autocadRef}
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  multiple
                  disabled={uploadingSources}
                  onChange={(files) => uploadSources(files, "autocad")}
                />
                <SourceUploadButton
                  icon={FileImage}
                  title="Supporting images"
                  detail="Material and finish references"
                  inputRef={supportRef}
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  disabled={uploadingSources}
                  onChange={(files) => uploadSources(files, "support")}
                />
              </div>
              {uploadingSources && (
                <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving private sources and preparing pages...
                </p>
              )}
              {!!studio.sources.length && (
                <div className="mt-6 divide-y border-y border-border">
                  {studio.sources.map((source) => (
                    <div
                      key={source.id}
                      className="flex items-center justify-between gap-4 py-3 text-sm"
                    >
                      <span className="min-w-0 truncate">{source.label}</span>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          {source.source_type.replaceAll("_", " ")}
                        </span>
                        {source.source_type === "autocad_pdf" && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-900 disabled:opacity-50"
                            aria-label={`Remove ${source.filename} and extracted pages`}
                            title="Remove this PDF and its extracted pages"
                            disabled={deletingSourceId !== null}
                            onClick={() => removeSourceSet(source)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove PDF + pages
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="border-b border-border py-8">
          <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Step 2
              </div>
              <h2 className="mt-2 font-serif text-2xl">Elevation setup</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Confirm room, order, source, assigned materials, and exact result filenames.
              </p>
            </div>
            <div>
              {!drafts.length ? (
                <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Upload AutoCAD images or a PDF to begin elevation setup.
                </div>
              ) : (
                <>
                  <div className="divide-y border-y border-border">
                    {drafts.map((draft, index) => {
                      const source = autocadSources.find((item) => item.id === draft.sourceId);
                      const roomMaterials = studio.materials.filter(
                        (material) => material.room_id === draft.roomId,
                      );
                      return (
                        <details
                          key={draft.sourceId}
                          className="group py-4"
                          open={drafts.length <= 4}
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-stone-100 text-xs">
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate font-medium">
                                  {draft.title || draft.elevationId}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {source?.filename} ·{" "}
                                  {studio.rooms.find((room) => room.id === draft.roomId)?.name ||
                                    "Room needed"}
                                </div>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground group-open:hidden">
                              Edit
                            </span>
                          </summary>
                          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <Field label="Elevation ID">
                              <Input
                                value={draft.elevationId}
                                onChange={(event) =>
                                  patchDraft(draft.sourceId, {
                                    elevationId: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="Sheet">
                              <Input
                                value={draft.sheetNumber}
                                onChange={(event) =>
                                  patchDraft(draft.sourceId, {
                                    sheetNumber: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="Room">
                              <Select
                                value={draft.roomId}
                                onValueChange={(roomId) => chooseRoom(draft, roomId)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Choose room" />
                                </SelectTrigger>
                                <SelectContent>
                                  {studio.rooms.map((room) => (
                                    <SelectItem key={room.id} value={room.id}>
                                      {room.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </Field>
                            <Field label="Presentation order">
                              <Input
                                type="number"
                                min={1}
                                value={draft.presentationOrder}
                                onChange={(event) =>
                                  patchDraft(draft.sourceId, {
                                    presentationOrder: Number(event.target.value) || 1,
                                  })
                                }
                              />
                            </Field>
                            <Field label="Elevation title">
                              <Input
                                value={draft.title}
                                onChange={(event) =>
                                  patchDraft(draft.sourceId, {
                                    title: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="Required rendering filename">
                              <Input
                                value={draft.expectedRenderFilename}
                                onChange={(event) =>
                                  patchDraft(draft.sourceId, {
                                    expectedRenderFilename: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="Required final-sheet filename">
                              <Input
                                value={draft.expectedSheetFilename}
                                onChange={(event) =>
                                  patchDraft(draft.sourceId, {
                                    expectedSheetFilename: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="AutoCAD source">
                              <div className="flex h-10 items-center border border-input px-3 text-sm text-muted-foreground">
                                <span className="truncate">
                                  {source?.filename || "Missing source"}
                                </span>
                              </div>
                            </Field>
                          </div>
                          <div className="mt-5 border-t border-border pt-4">
                            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Assigned room materials
                            </div>
                            {!draft.roomId ? (
                              <p className="text-sm text-muted-foreground">
                                Choose a room to load its materials.
                              </p>
                            ) : !roomMaterials.length ? (
                              <p className="text-sm text-muted-foreground">
                                No active materials are currently assigned to this room.
                              </p>
                            ) : (
                              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                {roomMaterials.map((material) => (
                                  <label
                                    key={material.id}
                                    className="flex cursor-pointer items-start gap-3 text-sm"
                                  >
                                    <Checkbox
                                      checked={draft.materialIds.includes(material.id)}
                                      onCheckedChange={(checked) =>
                                        patchDraft(draft.sourceId, {
                                          materialIds: checked
                                            ? [...draft.materialIds, material.id]
                                            : draft.materialIds.filter((id) => id !== material.id),
                                        })
                                      }
                                    />
                                    {materialImageUrl(material) && (
                                      <img
                                        src={materialImageUrl(material) || ""}
                                        alt={`${materialName(material)} reference`}
                                        className="h-12 w-12 shrink-0 border border-border object-cover"
                                        loading="lazy"
                                      />
                                    )}
                                    <span>
                                      {materialName(material)}
                                      {material.color && (
                                        <span className="block text-xs text-muted-foreground">
                                          {material.color}
                                        </span>
                                      )}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={saveElevations}
                    disabled={savingElevations}
                    className="mt-5 inline-flex items-center gap-2 bg-ink px-5 py-2.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {savingElevations ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Save elevation setup
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="border-b border-border py-8">
          <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Step 3
              </div>
              <h2 className="mt-2 font-serif text-2xl">Codex handoff</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The prompt and private source pack work together. The prompt alone has no file
                access.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => copyPrompt("render")}
                disabled={!studio.elevations.length}
                className="inline-flex items-center gap-2 border border-ink px-5 py-2.5 text-sm hover:bg-muted disabled:opacity-40"
              >
                <Clipboard className="h-4 w-4" />
                Copy Codex Rendering Prompt
              </button>
              <button
                type="button"
                onClick={() => downloadFromAction("create_render_pack")}
                disabled={handoffBusy || !studio.elevations.length}
                className="inline-flex items-center gap-2 bg-ink px-5 py-2.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {handoffBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileArchive className="h-4 w-4" />
                )}
                Download Codex Render Pack
              </button>
            </div>
          </div>
        </section>

        <section className="border-b border-border py-8">
          <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Step 4
              </div>
              <h2 className="mt-2 font-serif text-2xl">Result import</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Upload image files or one ZIP. Files are matched only by their required manifest
                names.
              </p>
            </div>
            <div>
              <input
                ref={resultRef}
                type="file"
                multiple
                accept=".zip,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => importResults(event.target.files)}
              />
              <button
                type="button"
                onClick={() => resultRef.current?.click()}
                disabled={resultBusy || !studio.elevations.length}
                className="inline-flex items-center gap-2 bg-ink px-5 py-2.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {resultBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Upload Codex Results
              </button>
              {resultReport && (
                <div className="mt-5 grid gap-4 border-y border-border py-4 text-sm md:grid-cols-4">
                  <ReportValue label="Imported" value={resultReport.imported} />
                  <ReportValue label="Already current" value={resultReport.unchanged} />
                  <ReportList label="Missing" values={resultReport.missing} />
                  <ReportList
                    label="Incorrect or extra"
                    values={[
                      ...resultReport.duplicates.map((item) => `${item} (duplicate)`),
                      ...resultReport.unexpected,
                    ]}
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="py-8">
          <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Step 5
              </div>
              <h2 className="mt-2 font-serif text-2xl">Review</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Approvals become available to the presentation. Denials preserve history and require
                a correction note.
              </p>
              {rejected.length > 0 && (
                <button
                  type="button"
                  onClick={() => copyPrompt("correction")}
                  className="mt-5 inline-flex items-center gap-2 border border-red-300 px-4 py-2 text-sm text-red-800 hover:bg-red-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Copy Correction Prompt
                </button>
              )}
            </div>
            <div>
              {!studio.elevations.length ? (
                <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Saved elevations will appear here.
                </div>
              ) : (
                <div className="space-y-8">
                  {studio.elevations.map((elevation) => (
                    <ElevationReview
                      key={elevation.id}
                      elevation={elevation}
                      onReview={reviewElevation}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function SourceUploadButton({
  icon: Icon,
  title,
  detail,
  inputRef,
  accept,
  multiple,
  disabled,
  onChange,
}: {
  icon: typeof FileText;
  title: string;
  detail: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onChange: (files: FileList | null) => void;
}) {
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(event) => onChange(event.target.files)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex min-h-28 items-center gap-4 border border-border p-4 text-left hover:bg-muted disabled:opacity-50"
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
        </span>
      </button>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ReportValue({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl">{value}</div>
    </div>
  );
}

function ReportList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 max-h-24 overflow-auto text-xs leading-5">
        {values.length ? values.join(", ") : "None"}
      </div>
    </div>
  );
}

function ElevationReview({
  elevation,
  onReview,
}: {
  elevation: StudioElevation;
  onReview: (
    elevationId: string,
    decision: "approve" | "reject",
    correctionNote?: string,
  ) => Promise<void>;
}) {
  const [note, setNote] = useState(elevation.correction_note || "");
  const [busy, setBusy] = useState(false);
  const assets = new Map(elevation.assets.map((asset) => [asset.asset_type, asset]));
  const handleReview = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await onReview(elevation.id, decision, note);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="border-t border-border pt-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-2xl">{elevation.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {elevation.elevation_id} · {elevation.sheet_number} ·{" "}
            {elevation.room?.name || elevation.room_name}
          </p>
        </div>
        <span
          className={cn("px-2.5 py-1 text-xs font-medium", statusClass(elevation.workflow_status))}
        >
          {workflowLabels[elevation.workflow_status] || elevation.workflow_status}
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <AssetPreview label="AutoCAD Source" asset={assets.get("autocad")} />
        <AssetPreview label="Final Rendering" asset={assets.get("final_rendering")} />
        <AssetPreview label="Final Presentation Sheet" asset={assets.get("final_sheet")} />
      </div>
      {assets.get("final_rendering") && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <Label htmlFor={`correction-${elevation.id}`}>Correction note</Label>
            <Textarea
              id={`correction-${elevation.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Required when denying. Describe only the proven correction needed."
              className="mt-2 min-h-20"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleReview("reject")}
              className="inline-flex items-center gap-2 border border-red-300 px-4 py-2 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Deny
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleReview("approve")}
              className="inline-flex items-center gap-2 bg-emerald-700 px-4 py-2 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve
            </button>
          </div>
        </div>
      )}
      {!!elevation.revisions.length && (
        <details className="mt-5 border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground">
            <History className="h-4 w-4" />
            Revision history ({elevation.revisions.length})
          </summary>
          <div className="mt-3 divide-y border-y border-border">
            {elevation.revisions.map((revision) => (
              <div
                key={revision.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <span>
                  Version {revision.revision_number} · {revision.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(revision.created_at).toLocaleString()}
                  {revision.correction_note ? ` · ${revision.correction_note}` : ""}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

function AssetPreview({ label, asset }: { label: string; asset?: StudioAsset }) {
  return (
    <figure>
      <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </figcaption>
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border border-border bg-stone-50">
        {asset?.url ? (
          <img
            src={asset.url}
            alt={`${label}: ${asset.filename}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-xs text-muted-foreground">Not uploaded</span>
        )}
      </div>
      <div className="mt-2 truncate text-xs text-muted-foreground">
        {asset?.filename || "No file"}
      </div>
    </figure>
  );
}
