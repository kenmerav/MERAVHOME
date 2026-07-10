import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { LayoutTemplate } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isSharedProjectRole } from "@/lib/permissions";

export const Route = createFileRoute("/presentations/")({
  head: () => ({ meta: [{ title: "Presentation Boards — MERAV Studio" }] }),
  component: PresentationsIndex,
});

function PresentationsIndex() {
  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const sharedProjectRole = isSharedProjectRole(profile?.role);
  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["presentationProjects", profile?.id, profile?.role],
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
          access: { presentations?: boolean };
        }>;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Could not load presentation boards.");
      return (body.projects ?? []).filter((project) => project.access.presentations === true);
    },
  });
  const isLoading = loadingProfile || loadingProjects;
  const activeProjects = projects.filter((project) => project.status !== "Complete");
  const activeProjectIds = activeProjects.map((project) => project.id);
  const { data: allRooms = [] } = useQuery({
    queryKey: ["presentationRooms", activeProjectIds],
    enabled: activeProjectIds.length > 0,
    queryFn: async () =>
      (
        await supabase
          .from("rooms")
          .select("id,project_id")
          .in("project_id", activeProjectIds)
          .order("created_at")
      ).data ?? [],
  });

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <div className="mb-12">
          <div className="eyebrow mb-3">Editorial</div>
          <h1 className="editorial-hero text-5xl lg:text-7xl">Presentation Boards</h1>
          <p className="mt-4 text-muted-foreground">One presentation per project — scroll to see each room.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading && (
            <div className="text-sm text-muted-foreground border border-dashed border-border p-10 md:col-span-2 lg:col-span-3">
              Loading presentation boards...
            </div>
          )}
          {activeProjects.map(p => {
            const rooms = (allRooms as any[]).filter(r => r.project_id === p.id);
            return (
              <Link key={p.id} to="/presentations/$id" params={{ id: p.id }} className="block border border-border p-6 hover:border-ink transition-colors">
                <LayoutTemplate className="w-5 h-5 text-brass mb-6" />
                <h3 className="font-display text-2xl leading-tight">{p.name}</h3>
                <div className="eyebrow mt-2 text-[10px]">{p.client_name}</div>
                <div className="text-xs text-muted-foreground mt-3">{rooms.length} {rooms.length === 1 ? "room" : "rooms"}</div>
              </Link>
            );
          })}
          {!isLoading && activeProjects.length === 0 && (
            <div className="text-sm text-muted-foreground border border-dashed border-border p-10 md:col-span-2 lg:col-span-3">
              {sharedProjectRole
                ? "No presentation boards are ready to view yet."
                : "No active presentation boards. Completed projects are kept out of this working list."}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
