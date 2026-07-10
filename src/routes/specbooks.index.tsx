import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isSharedProjectRole } from "@/lib/permissions";

export const Route = createFileRoute("/specbooks/")({
  head: () => ({ meta: [{ title: "Spec Books — MERAV Studio" }] }),
  component: SpecBooksIndex,
});

function SpecBooksIndex() {
  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const sharedProjectRole = isSharedProjectRole(profile?.role);
  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["specBookProjects", profile?.id, profile?.role],
    enabled: Boolean(profile),
    queryFn: async () => {
      if (!isSharedProjectRole(profile?.role)) return (await db.listProjects()) ?? [];
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return [];
      const response = await fetch("/api/client-dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json().catch(() => ({}))) as {
        projects?: Array<{
          id: string;
          name: string;
          client_name: string;
          status: string;
          access: { specBook?: boolean };
        }>;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Could not load spec books.");
      return (body.projects ?? []).filter((project) => project.access.specBook === true);
    },
  });
  const isLoading = loadingProfile || loadingProjects;
  const activeProjects = projects.filter((project) => project.status !== "Complete");
  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
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
              {sharedProjectRole
                ? "No spec books are ready to view yet."
                : "No active spec books. Completed projects are kept out of this working list."}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
