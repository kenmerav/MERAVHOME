import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { BookOpen } from "lucide-react";

export const Route = createFileRoute("/specbooks/")({
  head: () => ({ meta: [{ title: "Spec Books — MERAV Studio" }] }),
  component: SpecBooksIndex,
});

function SpecBooksIndex() {
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await db.listProjects()) ?? [],
  });
  const activeProjects = projects.filter((project) => project.status !== "Complete");
  return (
    <AppShell>
      <div className="px-8 lg:px-16 py-12 lg:py-16 max-w-[1500px]">
        <div className="mb-12">
          <div className="eyebrow mb-3">Documentation</div>
          <h1 className="editorial-hero text-5xl lg:text-7xl">Spec Books</h1>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {isLoading && (
            <div className="text-sm text-muted-foreground border border-dashed border-border p-10 md:col-span-2 lg:col-span-3">
              Loading spec books...
            </div>
          )}
          {activeProjects.map(p => (
            <Link key={p.id} to="/specbooks/$id" params={{ id: p.id }} className="block border border-border p-6 hover:border-ink transition-colors">
              <BookOpen className="w-5 h-5 text-brass mb-6" />
              <h3 className="font-display text-2xl leading-tight">{p.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{p.client_name}</p>
            </Link>
          ))}
          {!isLoading && activeProjects.length === 0 && (
            <div className="text-sm text-muted-foreground border border-dashed border-border p-10 md:col-span-2 lg:col-span-3">
              No active spec books. Completed projects are kept out of this working list.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
