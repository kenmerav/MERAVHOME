import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, ExternalLink, FileText, Trash2, Upload } from "lucide-react";
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
import { db, type ProjectDocumentType } from "@/lib/db";

const DOCUMENT_TYPES: ProjectDocumentType[] = [
  "Construction Doc",
  "Layout Doc",
  "SketchUp Rendering",
  "AI Rendering",
];

export const Route = createFileRoute("/projects/$id/construction-docs")({
  head: () => ({ meta: [{ title: "Construction Docs — MERAV Studio" }] }),
  component: ConstructionDocsPage,
});

function ConstructionDocsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState<ProjectDocumentType>("Construction Doc");

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.getProject(id),
  });
  const { data: docs = [], isLoading: loadingDocs } = useQuery({
    queryKey: ["projectDocuments", id],
    queryFn: async () => (await db.listProjectDocuments(id)) ?? [],
    enabled: !!project,
  });

  const canManageDocs =
    profile?.is_active === true && (profile.role === "Admin" || profile.role === "Employee");
  const canViewDocs = canManageDocs || (profile?.is_active === true && profile.role === "Contractor");

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
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
          dataUrl: await fileToDataUrl(file),
        }),
      });
      const uploadBody = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) throw new Error(uploadBody?.error || "Upload failed.");

      return db.createProjectDocument({
        project_id: id,
        title: title.trim() || file.name.replace(/\.[^/.]+$/, ""),
        document_type: documentType,
        file_url: uploadBody.url,
        file_name: file.name,
        file_size: uploadBody.size ?? file.size,
        mime_type: uploadBody.contentType ?? file.type,
        visible_to_contractors: true,
        visible_to_clients: false,
        created_by: sessionData.session?.user.id ?? null,
      });
    },
    onSuccess: () => {
      toast.success("Construction doc uploaded.");
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
          <Link to="/projects/$id" params={{ id }} className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Back to project
          </Link>
          <h1 className="editorial-hero text-5xl">Construction Docs</h1>
          <p className="mt-4 text-muted-foreground">These docs are not available for this login.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-pad max-w-[1200px]">
        <Link to="/projects/$id" params={{ id }} className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {project.name}
        </Link>
        <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="eyebrow mb-3">Builder Resources</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">Construction Docs</h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              Upload layout docs, SketchUp references, renderings, and construction files for the GC/builder.
            </p>
          </div>
        </div>

        {canManageDocs && (
          <section className="mb-10 border border-border bg-background p-6">
            <div className="mb-5 flex items-center gap-2">
              <Upload className="h-4 w-4" />
              <h2 className="font-display text-3xl">Upload document</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1fr_220px_1.3fr_auto] lg:items-end">
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Layout Plan, AI Rendering, SketchUp View..." />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={documentType} onValueChange={(value) => setDocumentType(value as ProjectDocumentType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>File</Label>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadMutation.mutate(file);
                  }}
                />
              </div>
              <Button type="button" disabled={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
                {uploadMutation.isPending ? "Uploading..." : "Choose File"}
              </Button>
            </div>
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
              {docs.map((doc) => (
                <div key={doc.id} className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="eyebrow mb-2">{doc.document_type}</div>
                    <div className="font-display text-2xl">{doc.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {doc.file_name || "Uploaded file"}{doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={doc.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink">
                      <ExternalLink className="h-4 w-4" /> Open
                    </a>
                    <a href={doc.file_url} download className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink">
                      <Download className="h-4 w-4" /> Download
                    </a>
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

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
