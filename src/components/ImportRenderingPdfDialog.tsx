import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  FileUp,
  GripVertical,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { RoomImage } from "@/lib/db";
import {
  renderingImportPageText,
  suggestRenderingImportRoom,
} from "@/lib/renderingPdfImport";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const PROJECT_FILES_BUCKET = "project-files";
const MAX_PDF_SIZE = 50 * 1024 * 1024;

type ImportSource = {
  id: string;
  fileName: string;
  fileSize: number;
  path: string;
  url: string;
  fileHash: string;
};

type ImportPageStatus =
  | "queued"
  | "extracting"
  | "ready"
  | "failed"
  | "duplicate"
  | "importing"
  | "imported";

type ImportPage = {
  id: string;
  sourceId: string;
  fileHash: string;
  fileName: string;
  pageNumber: number;
  previewUrl: string;
  caption: string;
  elevationId: string | null;
  roomId: string;
  suggestedRoomName: string | null;
  linkedSketchupId: string;
  presentationOrder: number;
  included: boolean;
  status: ImportPageStatus;
  error: string;
  dimensions: string;
};

type FileIssue = {
  id: string;
  fileName: string;
  message: string;
};

type ApiResponse = Record<string, any>;

async function renderingImportRequest(projectId: string, action: string, payload: object) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to import rendering PDFs.");

  const response = await fetch("/api/import-rendering-pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, projectId, ...payload }),
  });
  const body = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok) throw new Error(body.error || "Rendering PDF import failed.");
  return body;
}

export function ImportRenderingPdfDialog({
  projectId,
  rooms,
  sketchupsByRoom,
}: {
  projectId: string;
  rooms: Array<{ id: string; name: string }>;
  sketchupsByRoom: Map<string, RoomImage[]>;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [pages, setPages] = useState<ImportPage[]>([]);
  const [fileIssues, setFileIssues] = useState<FileIssue[]>([]);
  const [processingFiles, setProcessingFiles] = useState(false);
  const [importing, setImporting] = useState(false);
  const [approved, setApproved] = useState(true);
  const [addToPresentation, setAddToPresentation] = useState(true);
  const [bulkRoomId, setBulkRoomId] = useState("");
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);

  const includedPages = pages.filter(
    (page) => page.included && page.status !== "duplicate" && page.status !== "imported",
  );
  const unassignedCount = includedPages.filter((page) => !page.roomId).length;
  const failedCount = includedPages.filter((page) => page.status === "failed").length;
  const readyCount = pages.filter(
    (page) => page.status === "ready" || page.status === "duplicate" || page.status === "imported",
  ).length;
  const selectedSourceIds = useMemo(
    () => new Set(includedPages.map((page) => page.sourceId)),
    [includedPages],
  );

  const reset = () => {
    setSources([]);
    setPages([]);
    setFileIssues([]);
    setProcessingFiles(false);
    setImporting(false);
    setApproved(true);
    setAddToPresentation(true);
    setBulkRoomId("");
    setDraggingPageId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updatePage = (pageId: string, patch: Partial<ImportPage>) => {
    setPages((current) =>
      current.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
    );
  };

  const extractPage = async (page: ImportPage, source: ImportSource) => {
    updatePage(page.id, { status: "extracting", error: "" });
    try {
      const result = await renderingImportRequest(projectId, "extract-page", {
        path: source.path,
        fileHash: source.fileHash,
        pageNumber: page.pageNumber,
      });
      updatePage(page.id, {
        status: "ready",
        previewUrl: String(result.url || ""),
        dimensions:
          result.width && result.height ? `${result.width} x ${result.height}px` : "",
      });
    } catch (error) {
      updatePage(page.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Page extraction failed.",
      });
    }
  };

  const selectFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length || processingFiles || importing) return;
    const validFiles = files.filter((file) => {
      if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
        toast.error(`${file.name} is not a PDF.`);
        return false;
      }
      if (file.size > MAX_PDF_SIZE) {
        toast.error(`${file.name} is larger than 50 MB.`);
        return false;
      }
      return true;
    });
    if (!validFiles.length) return;

    setProcessingFiles(true);
    setFileIssues([]);
    const knownHashes = new Set(sources.map((source) => source.fileHash));
    let nextOrder = pages.length + 1;

    for (const file of validFiles) {
      try {
        const prepared = await renderingImportRequest(projectId, "prepare", {
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || "application/pdf",
        });
        const { error: uploadError } = await supabase.storage
          .from(PROJECT_FILES_BUCKET)
          .uploadToSignedUrl(prepared.path, prepared.token, file, {
            contentType: "application/pdf",
            cacheControl: "31536000",
          });
        if (uploadError) throw uploadError;

        const inspected = await renderingImportRequest(projectId, "inspect", {
          path: prepared.path,
          fileName: file.name,
        });
        const hash = String(inspected.fileHash || "");
        if (knownHashes.has(hash)) {
          setFileIssues((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              fileName: file.name,
              message: "This same PDF is already in the current review.",
            },
          ]);
          continue;
        }
        knownHashes.add(hash);

        const source: ImportSource = {
          id: crypto.randomUUID(),
          fileName: file.name,
          fileSize: file.size,
          path: String(prepared.path),
          url: String(prepared.url),
          fileHash: hash,
        };
        setSources((current) => [...current, source]);

        const newPages = (Array.isArray(inspected.pages) ? inspected.pages : []).map(
          (rawPage: ApiResponse) => {
            const pageNumber = Number(rawPage.pageNumber);
            const text = String(rawPage.text || "");
            const labels = renderingImportPageText(text, file.name, pageNumber);
            const suggestedRoom = suggestRenderingImportRoom(
              `${labels.caption}\n${text}`,
              rooms,
            );
            const duplicate = rawPage.duplicate && typeof rawPage.duplicate === "object"
              ? rawPage.duplicate
              : null;
            const page: ImportPage = {
              id: `${hash}:${pageNumber}`,
              sourceId: source.id,
              fileHash: hash,
              fileName: file.name,
              pageNumber,
              previewUrl: duplicate?.url ? String(duplicate.url) : "",
              caption: labels.caption,
              elevationId: labels.elevationId,
              roomId: duplicate?.room_id
                ? String(duplicate.room_id)
                : suggestedRoom?.roomId || "",
              suggestedRoomName: suggestedRoom?.roomName || null,
              linkedSketchupId: "",
              presentationOrder: nextOrder,
              included: !duplicate,
              status: duplicate ? "duplicate" : "queued",
              error: duplicate ? "This page is already in the project." : "",
              dimensions: "",
            };
            nextOrder += 1;
            return page;
          },
        );
        setPages((current) => [...current, ...newPages]);

        for (const page of newPages) {
          if (page.status === "duplicate") continue;
          await extractPage(page, source);
        }
      } catch (error) {
        setFileIssues((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            fileName: file.name,
            message: error instanceof Error ? error.message : "PDF processing failed.",
          },
        ]);
      }
    }

    setProcessingFiles(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const retryPage = async (page: ImportPage) => {
    const source = sources.find((item) => item.id === page.sourceId);
    if (!source) return toast.error("The source PDF is no longer available.");
    await extractPage(page, source);
  };

  const reorderPage = (pageId: string, targetId: string) => {
    if (pageId === targetId) return;
    setPages((current) => {
      const sourceIndex = current.findIndex((page) => page.id === pageId);
      const targetIndex = current.findIndex((page) => page.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next.map((page, index) => ({ ...page, presentationOrder: index + 1 }));
    });
  };

  const movePage = (pageId: string, direction: -1 | 1) => {
    const currentIndex = pages.findIndex((page) => page.id === pageId);
    const target = pages[currentIndex + direction];
    if (target) reorderPage(pageId, target.id);
  };

  const applyBulkRoom = (onlyUnassigned: boolean) => {
    if (!bulkRoomId) return;
    setPages((current) =>
      current.map((page) => {
        if (!page.included || page.status === "duplicate") return page;
        if (onlyUnassigned && page.roomId) return page;
        return { ...page, roomId: bulkRoomId, linkedSketchupId: "" };
      }),
    );
  };

  const importPages = async () => {
    if (!includedPages.length) return toast.error("Include at least one extracted page.");
    if (unassignedCount) return toast.error(`Assign a room to ${unassignedCount} included page${unassignedCount === 1 ? "" : "s"}.`);
    if (failedCount) return toast.error("Retry or exclude failed pages before importing.");
    if (includedPages.some((page) => page.status !== "ready")) {
      return toast.error("Wait for all included pages to finish extracting.");
    }

    setImporting(true);
    setPages((current) =>
      current.map((page) =>
        includedPages.some((included) => included.id === page.id)
          ? { ...page, status: "importing" }
          : page,
      ),
    );
    try {
      const result = await renderingImportRequest(projectId, "confirm", {
        pages: includedPages.map((page) => ({
          fileHash: page.fileHash,
          pageNumber: page.pageNumber,
          roomId: page.roomId,
          caption: page.caption,
          linkedSketchupId: page.linkedSketchupId || null,
          approved,
          presentationVisible: addToPresentation,
          presentationOrder: page.presentationOrder,
        })),
        sources: sources
          .filter((source) => selectedSourceIds.has(source.id))
          .map((source) => ({
            path: source.path,
            url: source.url,
            fileName: source.fileName,
            fileSize: source.fileSize,
            fileHash: source.fileHash,
          })),
      });
      const resultByPage = new Map<string, ApiResponse>(
        (Array.isArray(result.results) ? result.results : []).map((item: ApiResponse) => [
          `${item.fileHash}:${item.pageNumber}`,
          item,
        ]),
      );
      setPages((current) =>
        current.map((page) => {
          const pageResult = resultByPage.get(page.id);
          if (!pageResult) return page;
          if (pageResult.status === "imported") {
            return { ...page, status: "imported", included: false, error: "" };
          }
          if (pageResult.status === "duplicate") {
            return {
              ...page,
              status: "duplicate",
              included: false,
              error: String(pageResult.message || "This page is already in the project."),
            };
          }
          return {
            ...page,
            status: "failed",
            error: String(pageResult.message || "Page import failed."),
          };
        }),
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectRoomImages", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["designBoard", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["projectDocuments", projectId] }),
        ...rooms.map((room) =>
          queryClient.invalidateQueries({ queryKey: ["roomImages", room.id] }),
        ),
      ]);

      if (result.importedCount) {
        toast.success(
          `${result.importedCount} rendering page${result.importedCount === 1 ? "" : "s"} imported.`,
        );
      }
      if (result.failedCount) toast.error(`${result.failedCount} page${result.failedCount === 1 ? "" : "s"} still need attention.`);
      const warnings = Array.isArray(result.warnings)
        ? result.warnings.filter((warning: unknown): warning is string => typeof warning === "string")
        : [];
      for (const warning of warnings) {
        toast.warning(warning);
      }
    } catch (error) {
      setPages((current) =>
        current.map((page) =>
          page.status === "importing"
            ? {
                ...page,
                status: "failed",
                error: error instanceof Error ? error.message : "Import failed.",
              }
            : page,
        ),
      );
      toast.error(error instanceof Error ? error.message : "Rendering PDF import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && !processingFiles && !importing) reset();
      }}
    >
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 border border-ink px-3 py-1.5 text-sm transition-colors hover:bg-ink hover:text-primary-foreground">
          <FileUp className="h-3.5 w-3.5" /> Import Rendering PDF
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[94vh] w-[min(96vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4 pr-8">
            <div>
              <DialogTitle className="font-display text-3xl font-normal">
                Place Renderings
              </DialogTitle>
              <div className="mt-1 text-xs text-muted-foreground">
                {pages.length
                  ? `${readyCount} of ${pages.length} pages ready`
                  : "Choose one or more rendering PDFs"}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <Switch checked={approved} onCheckedChange={setApproved} />
                Already approved
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <Switch
                  checked={addToPresentation}
                  onCheckedChange={setAddToPresentation}
                />
                Add to Presentation
              </label>
              <Input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="sr-only"
                onChange={(event) => void selectFiles(event.target.files)}
              />
              <button
                type="button"
                disabled={processingFiles || importing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-10 items-center gap-2 border border-border px-4 text-sm hover:border-ink disabled:opacity-50"
              >
                {processingFiles ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                {pages.length ? "Add PDFs" : "Choose PDFs"}
              </button>
            </div>
          </div>
        </DialogHeader>

        {pages.length > 0 && (
          <div className="shrink-0 border-b border-border bg-bone/40 px-6 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px]">
                <Label className="eyebrow">Bulk room assignment</Label>
                <Select value={bulkRoomId} onValueChange={setBulkRoomId}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Choose room" />
                  </SelectTrigger>
                  <SelectContent>
                    {rooms.map((room) => (
                      <SelectItem key={room.id} value={room.id}>
                        {room.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                type="button"
                disabled={!bulkRoomId}
                onClick={() => applyBulkRoom(true)}
                className="h-10 border border-border bg-background px-3 text-xs hover:border-ink disabled:opacity-50"
              >
                Assign unassigned
              </button>
              <button
                type="button"
                disabled={!bulkRoomId}
                onClick={() => applyBulkRoom(false)}
                className="h-10 border border-border bg-background px-3 text-xs hover:border-ink disabled:opacity-50"
              >
                Assign all included
              </button>
              <div className="ml-auto text-xs text-muted-foreground">
                {includedPages.length} included
                {unassignedCount > 0 && ` · ${unassignedCount} need a room`}
                {failedCount > 0 && ` · ${failedCount} failed`}
              </div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!pages.length && !processingFiles && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[360px] w-full flex-col items-center justify-center border border-dashed border-border bg-bone/30 text-center hover:border-ink"
            >
              <FileUp className="mb-4 h-8 w-8 text-muted-foreground" />
              <span className="font-display text-2xl">Import final rendering sheets</span>
              <span className="mt-2 text-sm text-muted-foreground">PDF · up to 50 MB per file</span>
            </button>
          )}

          {processingFiles && pages.length === 0 && (
            <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Preparing PDF pages...
            </div>
          )}

          {fileIssues.length > 0 && (
            <div className="mb-4 space-y-2">
              {fileIssues.map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <span className="font-medium">{issue.fileName}: </span>
                    {issue.message}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-4">
            {pages.map((page, index) => {
              const roomSketchups = page.roomId
                ? sketchupsByRoom.get(page.roomId) ?? []
                : [];
              const isBusy = page.status === "extracting" || page.status === "importing";
              return (
                <article
                  key={page.id}
                  draggable={!isBusy && !importing}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", page.id);
                    setDraggingPageId(page.id);
                  }}
                  onDragEnd={() => setDraggingPageId(null)}
                  onDragOver={(event) => {
                    if (draggingPageId && draggingPageId !== page.id) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId = event.dataTransfer.getData("text/plain") || draggingPageId;
                    if (sourceId) reorderPage(sourceId, page.id);
                    setDraggingPageId(null);
                  }}
                  className={cn(
                    "grid gap-4 border border-border bg-background p-4 md:grid-cols-[220px_minmax(0,1fr)]",
                    draggingPageId === page.id && "opacity-50",
                    !page.included && "bg-bone/30 opacity-70",
                  )}
                >
                  <div className="relative flex min-h-[170px] items-center justify-center overflow-hidden border border-border bg-bone">
                    {page.previewUrl ? (
                      <img
                        src={normalizeSupabaseImageUrl(page.previewUrl)}
                        alt={page.caption}
                        className="max-h-[240px] h-auto w-auto max-w-full object-contain"
                        loading="lazy"
                      />
                    ) : page.status === "failed" ? (
                      <AlertCircle className="h-7 w-7 text-destructive" />
                    ) : (
                      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                    )}
                    <div className="absolute left-2 top-2 bg-background/95 px-2 py-1 text-[10px] uppercase tracking-wider">
                      Page {page.pageNumber}
                    </div>
                  </div>

                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex cursor-grab items-center gap-1 text-xs text-muted-foreground active:cursor-grabbing"
                        aria-label={`Drag page ${page.pageNumber} to reorder`}
                      >
                        <GripVertical className="h-4 w-4" />
                        Order {page.presentationOrder}
                      </button>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => movePage(page.id, -1)}
                        className="border border-border p-1 disabled:opacity-30"
                        aria-label="Move page earlier"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === pages.length - 1}
                        onClick={() => movePage(page.id, 1)}
                        className="border border-border p-1 disabled:opacity-30"
                        aria-label="Move page later"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <div className="truncate text-xs text-muted-foreground">
                        {page.fileName}
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        {page.status === "ready" && (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                          </span>
                        )}
                        {page.status === "duplicate" && (
                          <span className="text-xs text-amber-700">Already imported</span>
                        )}
                        {page.status === "imported" && (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Imported
                          </span>
                        )}
                        {isBusy && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {page.status === "importing" ? "Importing" : "Extracting"}
                          </span>
                        )}
                        <label className="inline-flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={page.included}
                            disabled={page.status === "duplicate" || page.status === "imported"}
                            onCheckedChange={(checked) =>
                              updatePage(page.id, { included: checked === true })
                            }
                          />
                          Include
                        </label>
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <div>
                        <Label className="eyebrow">Detected sheet / elevation</Label>
                        <Input value={page.elevationId || "Not detected"} readOnly />
                      </div>
                      <div>
                        <Label className="eyebrow">Presentation order</Label>
                        <Input
                          type="number"
                          min={1}
                          value={page.presentationOrder}
                          onChange={(event) =>
                            updatePage(page.id, {
                              presentationOrder: Math.max(1, Number(event.target.value) || 1),
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label className="eyebrow">Room</Label>
                        <Select
                          value={page.roomId || "unassigned"}
                          onValueChange={(value) =>
                            updatePage(page.id, {
                              roomId: value === "unassigned" ? "" : value,
                              linkedSketchupId: "",
                              suggestedRoomName:
                                value === "unassigned" ? page.suggestedRoomName : null,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose room" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {rooms.map((room) => (
                              <SelectItem key={room.id} value={room.id}>
                                {room.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {page.suggestedRoomName && page.roomId && (
                          <div className="mt-1 text-[11px] text-emerald-700">
                            Auto-detected from page text: {page.suggestedRoomName}
                          </div>
                        )}
                      </div>
                      <div>
                        <Label className="eyebrow">Linked SketchUp source</Label>
                        <Select
                          value={page.linkedSketchupId || "none"}
                          disabled={!page.roomId}
                          onValueChange={(value) =>
                            updatePage(page.id, {
                              linkedSketchupId: value === "none" ? "" : value,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Optional" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No SketchUp source</SelectItem>
                            {roomSketchups.map((sketchup, sketchupIndex) => (
                              <SelectItem key={sketchup.id} value={sketchup.id}>
                                {sketchup.caption?.trim() || `SketchUp ${sketchupIndex + 1}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="eyebrow">Caption</Label>
                      <Input
                        value={page.caption}
                        onChange={(event) => updatePage(page.id, { caption: event.target.value })}
                      />
                    </div>

                    {(page.error || page.dimensions) && (
                      <div
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-2 text-xs",
                          page.status === "failed" || page.status === "duplicate"
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        <span>{page.error || page.dimensions}</span>
                        {page.status === "failed" && (
                          <button
                            type="button"
                            onClick={() => void retryPage(page)}
                            className="inline-flex items-center gap-1 border border-border px-2 py-1 text-ink hover:border-ink"
                          >
                            <RotateCcw className="h-3 w-3" /> Retry page
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-muted-foreground">
              {approved
                ? addToPresentation
                  ? "Approved pages will be added to Presentation."
                  : "Approved pages will stay in Renderings until you add them to Presentation."
                : "Pages will stay pending until approved."}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={processingFiles || importing}
                onClick={() => setOpen(false)}
                className="h-10 border border-border px-4 text-sm hover:border-ink disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                disabled={
                  processingFiles ||
                  importing ||
                  !includedPages.length ||
                  unassignedCount > 0 ||
                  failedCount > 0 ||
                  includedPages.some((page) => page.status !== "ready")
                }
                onClick={() => void importPages()}
                className="inline-flex h-10 items-center gap-2 bg-ink px-5 text-sm text-primary-foreground disabled:opacity-40"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {includedPages.length || ""} Page{includedPages.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
