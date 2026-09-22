import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Minus,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  estimateConstructionDocumentFinality,
  groupConstructionDocumentVersions,
} from "@/lib/constructionDocumentFinality";
import { db, type ProjectDocument } from "@/lib/db";
import {
  canChatWithConstructionDocuments,
  canDownloadConstructionDocs,
  canViewProjectSurface,
  isStudioTeamRole,
} from "@/lib/permissions";

const PROJECT_FILES_BUCKET = "project-files";
const PROJECT_FILE_LIMIT = 50 * 1024 * 1024;

type DocumentViewerSelection = {
  document: ProjectDocument;
  previousDocument: ProjectDocument | null;
};

export const Route = createFileRoute("/projects/$id/construction-docs")({
  head: () => ({ meta: [{ title: "Construction Docs — MERAV Studio" }] }),
  component: ConstructionDocsPage,
});

function ConstructionDocsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});
  const [viewingDocument, setViewingDocument] = useState<DocumentViewerSelection | null>(null);

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.getProject(id),
  });
  const canManageDocs = profile?.is_active === true && isStudioTeamRole(profile.role);
  const canChatDocs = canChatWithConstructionDocuments(profile);
  const canViewDocs = canViewProjectSurface(profile, project, "constructionDocs");
  const canDownloadDocs = canDownloadConstructionDocs(profile, project);
  const { data: docs = [], isLoading: loadingDocs } = useQuery({
    queryKey: ["projectDocuments", id],
    queryFn: async () => (await db.listProjectDocuments(id)) ?? [],
    enabled: canViewDocs,
  });
  const documentGroups = groupConstructionDocumentVersions(docs);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (
        !file.name.toLowerCase().endsWith(".pdf") ||
        (file.type && file.type !== "application/pdf")
      ) {
        throw new Error("Choose a PDF construction document.");
      }
      if (file.size > PROJECT_FILE_LIMIT) {
        throw new Error("File is too large. Keep construction docs under 50 MB.");
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in to upload construction docs.");

      const uploadRes = await fetch("/api/upload-project-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: id,
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || "application/pdf",
        }),
      });
      const uploadBody = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) throw new Error(uploadBody?.error || "Upload failed.");

      const { error: storageError } = await supabase.storage
        .from(PROJECT_FILES_BUCKET)
        .uploadToSignedUrl(uploadBody.path, uploadBody.token, file, {
          contentType: "application/pdf",
          cacheControl: "31536000",
        });
      if (storageError) throw storageError;

      const finality = estimateConstructionDocumentFinality({ fileName: file.name });

      const document = await db.createProjectDocument({
        project_id: id,
        title: title.trim() || file.name.replace(/\.[^/.]+$/, ""),
        document_type: "Construction Doc",
        file_url: uploadBody.url,
        file_name: file.name,
        file_size: uploadBody.size ?? file.size,
        mime_type: uploadBody.contentType ?? file.type,
        visible_to_contractors: true,
        visible_to_clients: true,
        created_by: sessionData.session?.user.id ?? null,
        finality_estimate: finality.estimate,
        finality_confidence: finality.confidence,
        finality_reason: finality.reason,
        finality_estimated_at: new Date().toISOString(),
        finality_evidence: finality.evidence,
        finality_revision: finality.revision,
        finality_document_date: finality.documentDate,
        finality_method: "rules",
        finality_pdf_text_available: false,
        finality_override: null,
        finality_overridden_at: null,
        finality_overridden_by: null,
        superseded_by_document_id: null,
      });
      if (!document) throw new Error("The document uploaded but its record was not created.");

      const analysisResponse = await fetch("/api/analyze-project-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ documentId: document.id }),
      });
      return {
        document,
        analysisWarning: analysisResponse.ok
          ? null
          : (await analysisResponse.json().catch(() => ({})))?.error ||
            "The deeper estimate will be retried later.",
      };
    },
    onSuccess: (result) => {
      if (result.analysisWarning) toast.warning(`Document uploaded. ${result.analysisWarning}`);
      else toast.success("Construction doc uploaded and analyzed.");
      setTitle("");
      qc.invalidateQueries({ queryKey: ["projectDocuments", id] });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Upload failed."),
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => db.deleteProjectDocument(documentId),
    onSuccess: () => {
      toast.success("Construction doc removed.");
      qc.invalidateQueries({ queryKey: ["projectDocuments", id] });
    },
    onError: () => toast.error("Could not remove construction doc."),
  });

  const statusMutation = useMutation({
    mutationFn: async ({
      documentId,
      status,
    }: {
      documentId: string;
      status: "final" | "in_progress" | "superseded" | null;
    }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in to update the document status.");

      const response = await fetch("/api/project-document-finality", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ documentId, status }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not update document status.");
      return body;
    },
    onSuccess: (_, variables) => {
      toast.success(variables.status ? "Document status updated." : "Email estimate restored.");
      qc.invalidateQueries({ queryKey: ["projectDocuments", id] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not update document status."),
  });

  const analysisMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in to analyze the document.");
      const response = await fetch("/api/analyze-project-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ documentId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Document analysis failed.");
      return body;
    },
    onSuccess: () => {
      toast.success("Email and PDF estimate refreshed.");
      qc.invalidateQueries({ queryKey: ["projectDocuments", id] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Document analysis failed."),
  });

  if (loadingProfile || loadingProject) {
    return (
      <AppShell>
        <div className="page-pad text-muted-foreground">Loading construction docs...</div>
      </AppShell>
    );
  }

  if (!project || !canViewDocs) {
    return (
      <AppShell>
        <div className="page-pad max-w-3xl">
          <Link
            to="/projects/$id"
            params={{ id }}
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" /> Back to project
          </Link>
          <h1 className="editorial-hero text-5xl">Construction Docs</h1>
          <p className="mt-4 text-muted-foreground">
            These docs have not been shared with this login yet.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-pad max-w-[1200px]">
        <Link
          to="/projects/$id"
          params={{ id }}
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> {project.name}
        </Link>
        <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="eyebrow mb-3">Builder Resources</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">Construction Docs</h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              Upload PDF construction documents for the client and GC/builder portal.
            </p>
          </div>
        </div>

        {canManageDocs && (
          <section className="mb-10 border border-border bg-background p-6">
            <div className="mb-5 flex items-center gap-2">
              <Upload className="h-4 w-4" />
              <h2 className="font-display text-3xl">Upload document</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <Label>Title</Label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Construction Set, Floor Plan, Electrical Plan..."
                />
              </div>
              <Input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                aria-label="Construction document PDF"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                }}
              />
              <Button
                type="button"
                disabled={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadMutation.isPending ? "Uploading..." : "Choose PDF"}
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Client and Builder/GC visibility is controlled from the project Access settings.
            </p>
          </section>
        )}

        <section className="border border-border">
          <div className="border-b border-border px-6 py-4">
            <div className="eyebrow">Shared Files</div>
          </div>
          {loadingDocs ? (
            <div className="p-8 text-sm text-muted-foreground">Loading docs...</div>
          ) : docs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <FileText className="mx-auto mb-4 h-8 w-8" />
              No construction docs have been uploaded yet.
            </div>
          ) : (
            <div>
              {documentGroups.map((group) => {
                const isExpanded = Boolean(expandedFamilies[group.key]);
                return (
                  <div key={group.key} className="border-b border-border last:border-b-0">
                    <DocumentRow
                      doc={group.current}
                      canManageDocs={canManageDocs}
                      canDownloadDocs={canDownloadDocs}
                      statusPending={
                        statusMutation.isPending &&
                        statusMutation.variables?.documentId === group.current.id
                      }
                      analysisPending={
                        analysisMutation.isPending &&
                        analysisMutation.variables === group.current.id
                      }
                      onStatusChange={(status) =>
                        statusMutation.mutate({ documentId: group.current.id, status })
                      }
                      onView={() =>
                        setViewingDocument({
                          document: group.current,
                          previousDocument: group.previous[0] ?? null,
                        })
                      }
                      onAnalyze={() => analysisMutation.mutate(group.current.id)}
                      onDelete={() => deleteMutation.mutate(group.current.id)}
                    />
                    {group.previous.length > 0 && (
                      <div className="border-t border-border bg-muted/15">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() =>
                            setExpandedFamilies((current) => ({
                              ...current,
                              [group.key]: !current[group.key],
                            }))
                          }
                          className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm text-muted-foreground hover:text-ink"
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                          {isExpanded ? "Hide" : "View"} {group.previous.length} previous{" "}
                          {group.previous.length === 1 ? "version" : "versions"}
                        </button>
                        {isExpanded && (
                          <div className="divide-y divide-border border-t border-border">
                            {group.previous.map((doc, index) => (
                              <DocumentRow
                                key={doc.id}
                                doc={doc}
                                compact
                                canManageDocs={canManageDocs}
                                canDownloadDocs={canDownloadDocs}
                                statusPending={
                                  statusMutation.isPending &&
                                  statusMutation.variables?.documentId === doc.id
                                }
                                analysisPending={
                                  analysisMutation.isPending &&
                                  analysisMutation.variables === doc.id
                                }
                                onStatusChange={(status) =>
                                  statusMutation.mutate({ documentId: doc.id, status })
                                }
                                onView={() =>
                                  setViewingDocument({
                                    document: doc,
                                    previousDocument: group.previous[index + 1] ?? null,
                                  })
                                }
                                onAnalyze={() => analysisMutation.mutate(doc.id)}
                                onDelete={() => deleteMutation.mutate(doc.id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <ConstructionDocumentViewer
        document={viewingDocument?.document ?? null}
        previousDocument={viewingDocument?.previousDocument ?? null}
        canDownload={canDownloadDocs}
        canChat={canChatDocs}
        onClose={() => setViewingDocument(null)}
      />
    </AppShell>
  );
}

type DocumentStatus = "final" | "in_progress" | "superseded" | null;

function DocumentRow({
  doc,
  compact = false,
  canManageDocs,
  canDownloadDocs,
  statusPending,
  analysisPending,
  onStatusChange,
  onView,
  onAnalyze,
  onDelete,
}: {
  doc: ProjectDocument;
  compact?: boolean;
  canManageDocs: boolean;
  canDownloadDocs: boolean;
  statusPending: boolean;
  analysisPending: boolean;
  onStatusChange: (status: DocumentStatus) => void;
  onView: () => void;
  onAnalyze: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`flex flex-col gap-4 md:flex-row md:items-center md:justify-between ${
        compact ? "bg-muted/10 px-5 py-4 pl-10" : "p-5"
      }`}
    >
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="eyebrow">{compact ? "Previous version" : doc.document_type}</div>
          {canManageDocs && (
            <FinalityBadge
              estimate={doc.finality_estimate}
              override={doc.finality_override}
              superseded={Boolean(doc.superseded_by_document_id)}
            />
          )}
        </div>
        <div className={`font-display ${compact ? "text-xl" : "text-2xl"}`}>{doc.title}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {doc.file_name || "Uploaded file"}
          {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ""}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          Uploaded {formatUploadedAt(doc.created_at)}
        </div>
        {!compact && canManageDocs && doc.finality_override && (
          <div className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
            Marked manually
            {doc.finality_overridden_at ? ` ${formatUploadedAt(doc.finality_overridden_at)}` : ""}.
            The email estimate remains available below.
          </div>
        )}
        {!compact && canManageDocs && doc.finality_reason && (
          <div className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
            Email estimate ({doc.finality_confidence || "low"} confidence): {doc.finality_reason}
          </div>
        )}
        {canManageDocs && (doc.finality_revision || doc.finality_document_date) && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {doc.finality_revision && <span>Revision {doc.finality_revision}</span>}
            {doc.finality_document_date && (
              <span>Document date {formatDocumentDate(doc.finality_document_date)}</span>
            )}
          </div>
        )}
        {!compact && canManageDocs && doc.finality_evidence?.length > 0 && (
          <div className="mt-3 max-w-2xl space-y-1 border-l border-border pl-3 text-xs leading-5 text-muted-foreground">
            {doc.finality_evidence.slice(0, 3).map((item, index) => (
              <div key={`${item.source}-${item.page || 0}-${index}`}>
                <span className="font-medium text-ink">
                  {item.source === "pdf"
                    ? `PDF${item.page ? ` page ${item.page}` : ""}`
                    : item.source === "email"
                      ? "Current email"
                      : item.source === "history"
                        ? "Email history"
                        : "Filename"}
                  :
                </span>{" "}
                “{item.text}”
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {canManageDocs && (
          <Select
            value={doc.finality_override || "automatic"}
            disabled={statusPending}
            onValueChange={(value) =>
              onStatusChange(
                value === "automatic" ? null : (value as "final" | "in_progress" | "superseded"),
              )
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue aria-label="Document status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="automatic">Use email estimate</SelectItem>
              <SelectItem value="final">Final</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="superseded">Superseded</SelectItem>
            </SelectContent>
          </Select>
        )}
        {canManageDocs && (
          <Button type="button" variant="outline" disabled={analysisPending} onClick={onAnalyze}>
            <RefreshCw className={`h-4 w-4 ${analysisPending ? "animate-spin" : ""}`} />
            Recheck estimate
          </Button>
        )}
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink"
        >
          <FileText className="h-4 w-4" /> View document
        </button>
        {canDownloadDocs && (
          <a
            href={doc.file_url}
            download
            className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink"
          >
            <Download className="h-4 w-4" /> Download
          </a>
        )}
        {canManageDocs && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-2 border border-destructive/30 px-4 py-2 text-sm text-destructive hover:border-destructive"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

function ConstructionDocumentViewer({
  document,
  previousDocument,
  canDownload,
  canChat,
  onClose,
}: {
  document: ProjectDocument | null;
  previousDocument: ProjectDocument | null;
  canDownload: boolean;
  canChat: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(document)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[94vh] w-[96vw] max-w-[1500px] flex-col gap-0 overflow-hidden p-0">
        {document && (
          <>
            <DialogHeader className="border-b border-border px-5 py-4 pr-12">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <DialogTitle className="truncate font-display text-2xl font-normal">
                    {document.title}
                  </DialogTitle>
                  <DialogDescription className="truncate">
                    {document.file_name || "Construction document"}
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <a
                    href={document.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink"
                  >
                    <ExternalLink className="h-4 w-4" /> Open in new tab
                  </a>
                  {canDownload && (
                    <a
                      href={document.file_url}
                      download
                      className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink"
                    >
                      <Download className="h-4 w-4" /> Download
                    </a>
                  )}
                </div>
              </div>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <PdfDocumentCanvas url={document.file_url} title={document.title} />
              {canChat && (
                <ConstructionDocumentChat
                  key={document.id}
                  document={document}
                  previousDocument={previousDocument}
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type PdfPageProxy = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void>; cancel: () => void };
};

type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  destroy: () => Promise<void>;
};

function PdfDocumentCanvas({ url, title }: { url: string; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PdfDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => setViewportWidth(Math.max(320, viewport.clientWidth - 32));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PdfDocumentProxy | null = null;
    setLoading(true);
    setError(null);
    setPageNumber(1);
    setZoom(1);

    void import("pdfjs-dist/build/pdf.mjs")
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadedDocument = (await pdfjs.getDocument({ url }).promise) as PdfDocumentProxy;
        if (cancelled) {
          await loadedDocument.destroy();
          return;
        }
        setPdf(loadedDocument);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "The PDF could not be loaded.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      setPdf(null);
      if (loadedDocument) void loadedDocument.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    setLoading(true);
    setError(null);

    void pdf
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;
        const naturalViewport = page.getViewport({ scale: 1 });
        const fitScale = viewportWidth / naturalViewport.width;
        const renderScale = Math.max(0.1, fitScale * zoom);
        const renderViewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(renderViewport.width * pixelRatio);
        canvas.height = Math.floor(renderViewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(renderViewport.width)}px`;
        canvas.style.height = `${Math.floor(renderViewport.height)}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The PDF canvas is unavailable.");
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport: renderViewport,
        });
        return renderTask.promise;
      })
      .then(() => {
        if (!cancelled) setLoading(false);
      })
      .catch((renderError) => {
        if (
          !cancelled &&
          !(renderError instanceof Error && renderError.name === "RenderingCancelledException")
        ) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : "This PDF page could not be shown.",
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdf, viewportWidth, zoom]);

  const totalPages = pdf?.numPages ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/30">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!pdf || pageNumber <= 1}
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            aria-label="Previous PDF page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-24 text-center text-sm">
            {pdf ? `Page ${pageNumber} of ${totalPages}` : "Loading pages..."}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!pdf || pageNumber >= totalPages}
            onClick={() => setPageNumber((current) => Math.min(totalPages, current + 1))}
            aria-label="Next PDF page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!pdf || zoom <= 0.6}
            onClick={() => setZoom((current) => Math.max(0.6, current - 0.2))}
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="min-w-14 text-center text-sm">{Math.round(zoom * 100)}%</span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!pdf || zoom >= 2}
            onClick={() => setZoom((current) => Math.min(2, current + 0.2))}
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <div className="mx-auto mt-16 max-w-md border border-border bg-background p-6 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <div className="font-medium">This PDF could not be displayed inside Studio.</div>
            <div className="mt-2 text-sm text-muted-foreground">{error}</div>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink"
            >
              <ExternalLink className="h-4 w-4" /> Open {title} in a new tab
            </a>
          </div>
        ) : (
          <div className="flex min-h-full min-w-full items-start justify-center">
            <canvas
              ref={canvasRef}
              aria-label={`${title}, page ${pageNumber}`}
              className="bg-white shadow-lg"
            />
          </div>
        )}
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading PDF...
          </div>
        )}
      </div>
    </div>
  );
}

type DocumentChatCitation = {
  documentId: string;
  documentTitle: string;
  version: "current" | "previous";
  pageNumber: number;
  support: string;
};

type DocumentChatMessage =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      confidence: "high" | "medium" | "low";
      confidenceReason: string;
      citations: DocumentChatCitation[];
      comparedWithPrevious: boolean;
      previousDocumentTitle: string | null;
    };

const DOCUMENT_CHAT_PROMPTS = [
  "How many square feet is the office?",
  "What changed from the previous version?",
  "What appliances and sizes are shown?",
];

function ConstructionDocumentChat({
  document,
  previousDocument,
}: {
  document: ProjectDocument;
  previousDocument: ProjectDocument | null;
}) {
  const [messages, setMessages] = useState<DocumentChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);

  const ask = async (value: string) => {
    const nextQuestion = value.trim();
    if (!nextQuestion || pending) return;
    const userMessage: DocumentChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: nextQuestion,
    };
    const history = messages.map((message) => ({ role: message.role, content: message.content }));
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setPending(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again to ask this document a question.");
      const response = await fetch("/api/chat-project-document", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentId: document.id,
          previousDocumentId: previousDocument?.id ?? null,
          question: nextQuestion,
          history,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "The document could not answer right now.");
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: String(body.answer || "I could not find that in this document."),
          confidence: ["high", "medium", "low"].includes(body.confidence) ? body.confidence : "low",
          confidenceReason: String(body.confidenceReason || "Based on the cited PDF pages."),
          citations: Array.isArray(body.citations) ? body.citations : [],
          comparedWithPrevious: body.comparedWithPrevious === true,
          previousDocumentTitle: body.previousDocumentTitle || null,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content:
            error instanceof Error ? error.message : "The document could not answer right now.",
          confidence: "low",
          confidenceReason: "No answer was generated.",
          citations: [],
          comparedWithPrevious: false,
          previousDocumentTitle: null,
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <aside className="flex min-h-[320px] max-h-[44%] flex-col border-t border-border bg-background lg:max-h-none lg:w-[410px] lg:flex-none lg:border-l lg:border-t-0">
      <div className="border-b border-border px-4 py-3">
        <div className="eyebrow">Document assistant</div>
        <h3 className="mt-1 font-display text-2xl">Ask this drawing</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Answers use the open PDF and show the evidence page. Comparison questions also use the
          prior version when available.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="space-y-2">
            {DOCUMENT_CHAT_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={pending || (!previousDocument && /previous version/i.test(prompt))}
                onClick={() => void ask(prompt)}
                className="w-full border border-border px-3 py-2 text-left text-sm hover:border-ink disabled:cursor-not-allowed disabled:opacity-45"
              >
                {prompt}
              </button>
            ))}
            {!previousDocument && (
              <p className="pt-1 text-xs text-muted-foreground">
                No earlier version is available for this document set.
              </p>
            )}
          </div>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="ml-8 bg-ink px-3 py-2 text-sm text-background">
              {message.content}
            </div>
          ) : (
            <div key={message.id} className="space-y-3 border border-border p-3">
              <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="border border-border px-2 py-1 uppercase tracking-[0.16em]">
                  {message.confidence} confidence
                </span>
                {message.comparedWithPrevious && message.previousDocumentTitle && (
                  <span>Compared with {message.previousDocumentTitle}</span>
                )}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{message.confidenceReason}</p>
              {message.citations.map((citation, index) => (
                <DocumentChatEvidence
                  key={`${message.id}-${citation.documentId}-${citation.pageNumber}-${index}`}
                  citation={citation}
                />
              ))}
              {message.citations.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No drawing page directly supported an answer.
                </p>
              )}
            </div>
          ),
        )}
        {pending && (
          <div className="flex items-center border border-border p-3 text-sm text-muted-foreground">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Reading the drawing...
          </div>
        )}
      </div>
      <form
        className="border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about rooms, dimensions, appliances, or revisions..."
          className="min-h-20 resize-none"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void ask(question);
            }
          }}
        />
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          Asking sends this PDF to MERAV's OpenAI account for analysis. A prior version is included
          only for comparison questions. Chats are not saved, and nothing is emailed.
        </p>
        <Button type="submit" className="mt-2 w-full" disabled={pending || !question.trim()}>
          <Send className="h-4 w-4" /> Ask document
        </Button>
      </form>
    </aside>
  );
}

function DocumentChatEvidence({ citation }: { citation: DocumentChatCitation }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const token = data.session?.access_token;
        if (!token) throw new Error("Sign in again to view evidence.");
        const params = new URLSearchParams({
          document_id: citation.documentId,
          page: String(citation.pageNumber),
        });
        const response = await fetch(`/api/ea-document-evidence?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Evidence page could not be rendered.");
        objectUrl = URL.createObjectURL(await response.blob());
        if (!cancelled) setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [citation.documentId, citation.pageNumber]);

  return (
    <figure className="border border-border bg-muted/20 p-2">
      <figcaption className="mb-2 text-xs leading-5">
        <div className="font-medium text-ink">
          {citation.version === "previous" ? "Previous version" : "Current document"} · Page{" "}
          {citation.pageNumber}
        </div>
        <div className="text-muted-foreground">{citation.support}</div>
      </figcaption>
      {imageUrl ? (
        <a href={imageUrl} target="_blank" rel="noreferrer" title="Open evidence image">
          <img
            src={imageUrl}
            alt={`${citation.documentTitle}, evidence page ${citation.pageNumber}`}
            className="max-h-52 w-full border border-border bg-white object-contain"
          />
        </a>
      ) : error ? (
        <div className="py-5 text-center text-xs text-muted-foreground">
          Evidence screenshot unavailable.
        </div>
      ) : (
        <div className="flex items-center justify-center py-5 text-xs text-muted-foreground">
          <RefreshCw className="mr-2 h-3 w-3 animate-spin" /> Loading evidence page...
        </div>
      )}
    </figure>
  );
}

function FinalityBadge({
  estimate,
  override,
  superseded,
}: {
  estimate?: string | null;
  override?: string | null;
  superseded?: boolean;
}) {
  if (override) {
    const label =
      override === "final" ? "Final" : override === "in_progress" ? "In progress" : "Superseded";
    const classes =
      override === "final"
        ? "border-emerald-700/30 bg-emerald-50 text-emerald-900"
        : override === "in_progress"
          ? "border-amber-700/30 bg-amber-50 text-amber-900"
          : "border-border bg-muted text-muted-foreground";
    return <span className={`border px-2 py-1 text-[11px] font-medium ${classes}`}>{label}</span>;
  }
  if (superseded) {
    return (
      <span className="border border-border bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
        Superseded
      </span>
    );
  }
  const label =
    estimate === "likely_final"
      ? "Likely final"
      : estimate === "likely_not_final"
        ? "Likely not final"
        : "Final status unclear";
  const classes =
    estimate === "likely_final"
      ? "border-emerald-700/30 bg-emerald-50 text-emerald-900"
      : estimate === "likely_not_final"
        ? "border-amber-700/30 bg-amber-50 text-amber-900"
        : "border-border bg-muted/40 text-muted-foreground";
  return <span className={`border px-2 py-1 text-[11px] font-medium ${classes}`}>{label}</span>;
}

function formatDocumentDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatUploadedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "at an unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
