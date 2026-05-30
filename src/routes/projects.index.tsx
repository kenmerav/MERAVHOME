import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await db.listProjects()) ?? [],
  });

  return (
    <AppShell>
      <div className="px-8 lg:px-16 py-12 lg:py-16 max-w-[1500px]">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">Index</div>
            <h1 className="editorial-hero text-5xl lg:text-6xl">Projects</h1>
          </div>
          <NewProjectDialog />
        </div>

        <div className="border-t border-border">
          {projects.map((p) => (
            <Link
              key={p.id}
              to="/projects/$id"
              params={{ id: p.id }}
              className="grid grid-cols-[80px_1fr_auto] lg:grid-cols-[100px_2fr_1.5fr_1fr_auto] items-center gap-6 py-5 border-b border-border hover:bg-bone/40 transition-colors group"
            >
              <div className="aspect-[4/5] bg-bone overflow-hidden">
                {p.cover_image_url && (
                  <img src={resolveImage(p.cover_image_url)} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-2xl leading-tight">{p.name}</h3>
                <div className="eyebrow mt-1">{p.project_type}</div>
              </div>
              <div className="hidden lg:block text-sm text-muted-foreground">{p.client_name}</div>
              <div className="hidden lg:block"><StatusBadge status={p.status} /></div>
              <div className="text-xs text-muted-foreground hidden lg:block">
                {new Date(p.updated_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
