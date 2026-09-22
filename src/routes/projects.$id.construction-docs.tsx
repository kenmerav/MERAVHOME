import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { estimateConstructionDocumentFinality } from "@/lib/constructionDocumentFinality";
import { db } from "@/lib/db";
import {
  canDownloadConstructionDocs,
  canViewProjectSurface,
  isStudioTeamRole,
} from "@/lib/permissions";

const PROJECT_FILES_BUCKET = "project-files";
const PROJECT_FILE_LIMIT = 50 * 1024 * 1024;

export const Route = createFileRoute("/projects/$id/construction-docs")({
  head: () => ({ meta: [{ title: "Construction Docs — MERAV Studio" }] }),
  component: ConstructionDocsPage,
});

function ConstructionDocsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.getProject(id),
  });
  const canManageDocs = profile?.is_active === true && isStudioTeamRole(profile.role);
  const canViewDocs = canViewProjectSurface(profile, project, "constructionDocs");
  const canDownloadDocs = canDownloadConstructionDocs(profile, project);
  const { data: docs = [], isLoading: loadingDocs } = useQuery({
    queryKey: ["projectDocuments", id],
    queryFn: async () => (await db.listProjectDocuments(id)) ?? [],
    enabled: canViewDocs,
  });

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
            <div className="divide-y divide-border">
              {[...docs]
                .sort(
                  (left, right) =>
                    new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
                )
                .map((doc) => (
                  <div
                    key={doc.id}
                    className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <div className="eyebrow">{doc.document_type}</div>
                        {canManageDocs && (
                          <FinalityBadge
                            estimate={doc.finality_estimate}
                            override={doc.finality_override}
                            superseded={Boolean(doc.superseded_by_document_id)}
                          />
                        )}
                      </div>
                      <div className="font-display text-2xl">{doc.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {doc.file_name || "Uploaded file"}
                        {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ""}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Uploaded {formatUploadedAt(doc.created_at)}
                      </div>
                      {canManageDocs && doc.finality_override && (
                        <div className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                          Marked manually
                          {doc.finality_overridden_at
                            ? ` ${formatUploadedAt(doc.finality_overridden_at)}`
                            : ""}
                          . The email estimate remains available below.
                        </div>
                      )}
                      {canManageDocs && doc.finality_reason && (
                        <div className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                          Email estimate ({doc.finality_confidence || "low"} confidence):{" "}
                          {doc.finality_reason}
                        </div>
                      )}
                      {canManageDocs && (doc.finality_revision || doc.finality_document_date) && (
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {doc.finality_revision && <span>Revision {doc.finality_revision}</span>}
                          {doc.finality_document_date && (
                            <span>
                              Document date {formatDocumentDate(doc.finality_document_date)}
                            </span>
                          )}
                        </div>
                      )}
                      {canManageDocs && doc.finality_evidence?.length > 0 && (
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
                          disabled={
                            statusMutation.isPending &&
                            statusMutation.variables?.documentId === doc.id
                          }
                          onValueChange={(value) =>
                            statusMutation.mutate({
                              documentId: doc.id,
                              status:
                                value === "automatic"
                                  ? null
                                  : (value as "final" | "in_progress" | "superseded"),
                            })
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
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            analysisMutation.isPending && analysisMutation.variables === doc.id
                          }
                          onClick={() => analysisMutation.mutate(doc.id)}
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${
                              analysisMutation.isPending && analysisMutation.variables === doc.id
                                ? "animate-spin"
                                : ""
                            }`}
                          />
                          Recheck estimate
                        </Button>
                      )}
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink"
                      >
                        <ExternalLink className="h-4 w-4" /> Open
                      </a>
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
                          onClick={() => deleteMutation.mutate(doc.id)}
                          className="inline-flex items-center gap-2 border border-destructive/30 px-4 py-2 text-sm text-destructive hover:border-destructive"
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
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
