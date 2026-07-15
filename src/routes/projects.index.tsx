import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, LoaderCircle, Pin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/db";
import type { Project } from "@/lib/db";
import { resolveImage } from "@/lib/local-assets";
import { canManageStudio, isSharedProjectRole } from "@/lib/permissions";
import { NewProjectDialog, StatusBadge } from "./index";
import { toast } from "sonner";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [{ title: "Projects — MERAV Studio" }],
  }),
  component: ProjectsListPage,
});

function ProjectsListPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"active" | "archive">("active");
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const {
    data: projects = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await db.listProjects()) ?? [],
  });
  const activeProjects = projects.filter((p) => p.status !== "Complete");
  const archivedProjects = projects.filter((p) => p.status === "Complete");
  const visibleProjects = filter === "archive" ? archivedProjects : activeProjects;
  const isSharedUser = isSharedProjectRole(profile?.role);
  const canPinProjects = !profileLoading && !isSharedUser;
  const canDuplicateProjects = !profileLoading && canManageStudio(profile);

  const togglePinned = async (projectId: string, pinned: boolean) => {
    try {
      await db.updateProject(projectId, { is_pinned: !pinned });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(!pinned ? "Project pinned" : "Project unpinned");
    } catch {
      toast.error("Could not update pinned project.");
    }
  };

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">Index</div>
            <h1 className="editorial-hero text-5xl lg:text-6xl">Projects</h1>
          </div>
          {!profileLoading && !isSharedUser && <NewProjectDialog />}
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          <button
            type="button"
            onClick={() => setFilter("active")}
            className={`px-4 py-2 text-[10px] tracking-[0.18em] uppercase border transition-colors ${
              filter === "active"
                ? "bg-ink text-primary-foreground border-ink"
                : "border-border text-muted-foreground hover:bg-bone"
            }`}
          >
            Active ({activeProjects.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("archive")}
            className={`px-4 py-2 text-[10px] tracking-[0.18em] uppercase border transition-colors ${
              filter === "archive"
                ? "bg-ink text-primary-foreground border-ink"
                : "border-border text-muted-foreground hover:bg-bone"
            }`}
          >
            Archive ({archivedProjects.length})
          </button>
        </div>

        <div className="border-t border-border">
          {isLoading || (isFetching && projects.length === 0) ? (
            <div className="py-16 text-sm text-muted-foreground">Loading projects...</div>
          ) : visibleProjects.length === 0 ? (
            <div className="py-16 text-sm text-muted-foreground">
              {filter === "archive"
                ? "No completed projects in the archive yet."
                : "No active projects. Completed projects live in Archive."}
            </div>
          ) : (
            visibleProjects.map((p) => {
              const pinned = Boolean(p.is_pinned);
              const recentDate = p.last_opened_at || p.updated_at;
              return (
                <div
                  key={p.id}
                  className="relative border-b border-border transition-colors hover:bg-bone/40"
                >
                  <Link
                    to="/projects/$id"
                    params={{ id: p.id }}
                    className="grid grid-cols-[72px_1fr] sm:grid-cols-[80px_1fr_auto] lg:grid-cols-[100px_2fr_1.5fr_1fr_auto_84px] items-center gap-4 sm:gap-6 py-5 pr-24 lg:pr-28 group"
                  >
                    <div className="aspect-[4/5] bg-bone overflow-hidden">
                      {p.cover_image_url && (
                        <img
                          src={resolveImage(p.cover_image_url)}
                          alt={p.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {pinned && <Pin className="h-3.5 w-3.5 fill-ink text-ink" />}
                        <h3 className="font-display text-xl sm:text-2xl leading-tight">{p.name}</h3>
                      </div>
                      <div className="eyebrow mt-1">
                        {p.project_label || p.project_type}
                        <span className="lg:hidden"> · {p.client_name}</span>
                      </div>
                    </div>
                    <div className="hidden lg:block text-sm text-muted-foreground">
                      {p.client_name}
                    </div>
                    <div className="hidden lg:block">
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="text-xs text-muted-foreground hidden lg:block">
                      {p.last_opened_at ? "Opened " : "Updated "}
                      {new Date(recentDate).toLocaleDateString()}
                    </div>
                  </Link>
                  {(canPinProjects || canDuplicateProjects) && (
                    <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-2">
                      {canDuplicateProjects && <DuplicateProjectDialog project={p} />}
                      {canPinProjects && (
                        <button
                          type="button"
                          onClick={() => togglePinned(p.id, pinned)}
                          className={`inline-flex h-10 w-10 items-center justify-center border transition-colors ${
                            pinned
                              ? "border-ink bg-ink text-primary-foreground"
                              : "border-border bg-background text-muted-foreground hover:border-ink hover:text-ink"
                          }`}
                          aria-label={pinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
                          title={pinned ? "Unpin project" : "Pin project"}
                        >
                          <Pin className={`h-4 w-4 ${pinned ? "fill-current" : ""}`} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DuplicateProjectDialog({ project }: { project: Project }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${project.name} Copy`);
  const [clientName, setClientName] = useState(project.client_name);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const reset = () => {
    setName(`${project.name} Copy`);
    setClientName(project.client_name);
    setErrorMessage("");
  };

  const duplicate = async () => {
    if (!name.trim() || !clientName.trim()) {
      toast.error("Project name and client are required.");
      return;
    }

    setBusy(true);
    setErrorMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch("/api/duplicate-project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          source_project_id: project.id,
          name: name.trim(),
          client_name: clientName.trim(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to duplicate project.");

      await qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project duplicated");
      setOpen(false);
      reset();
      await navigate({ to: "/projects/$id", params: { id: body.project.id } });
    } catch (error: unknown) {
      console.error("Duplicate project failed", error);
      const message = error instanceof Error ? error.message : "Unable to duplicate project.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (busy) return;
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center border border-border bg-background text-muted-foreground transition-colors hover:border-ink hover:text-ink"
          aria-label={`Duplicate ${project.name}`}
          title="Duplicate project"
        >
          <Copy className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Duplicate Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <label className="block space-y-2">
            <span className="eyebrow">Project name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-ink"
              autoFocus
            />
          </label>
          <label className="block space-y-2">
            <span className="eyebrow">Client</span>
            <input
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              className="h-11 w-full border border-border bg-background px-3 text-sm outline-none focus:border-ink"
            />
          </label>
          <div className="border-l-2 border-border pl-4 text-xs leading-5 text-muted-foreground">
            Financials, access, tasks, approvals, ordering status, and version history start fresh.
          </div>
          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="h-11 border border-border px-5 text-sm hover:border-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={duplicate}
              disabled={busy}
              className="inline-flex h-11 items-center gap-2 bg-ink px-5 text-sm text-primary-foreground hover:bg-ink/90 disabled:opacity-50"
            >
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Duplicate
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
