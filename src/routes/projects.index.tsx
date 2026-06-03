import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { resolveImage } from "@/lib/local-assets";
import { NewProjectDialog, StatusBadge } from "./index";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [{ title: "Projects — MERAV Studio" }],
  }),
  component: ProjectsListPage,
});

function ProjectsListPage() {
  const [filter, setFilter] = useState<"active" | "archive">("active");
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

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">Index</div>
            <h1 className="editorial-hero text-5xl lg:text-6xl">Projects</h1>
          </div>
          <NewProjectDialog />
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
            visibleProjects.map((p) => (
              <Link
                key={p.id}
                to="/projects/$id"
                params={{ id: p.id }}
                className="grid grid-cols-[72px_1fr] sm:grid-cols-[80px_1fr_auto] lg:grid-cols-[100px_2fr_1.5fr_1fr_auto] items-center gap-4 sm:gap-6 py-5 border-b border-border hover:bg-bone/40 transition-colors group"
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
                  <h3 className="font-display text-xl sm:text-2xl leading-tight">{p.name}</h3>
                  <div className="eyebrow mt-1">
                    {p.project_label || p.project_type}
                    <span className="lg:hidden"> · {p.client_name}</span>
                  </div>
                </div>
                <div className="hidden lg:block text-sm text-muted-foreground">{p.client_name}</div>
                <div className="hidden lg:block">
                  <StatusBadge status={p.status} />
                </div>
                <div className="text-xs text-muted-foreground hidden lg:block">
                  {new Date(p.updated_at).toLocaleDateString()}
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
