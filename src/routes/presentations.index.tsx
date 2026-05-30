import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { LayoutTemplate } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/presentations/")({
  head: () => ({ meta: [{ title: "Presentation Boards — MERAV Studio" }] }),
  component: PresentationsIndex,
});

function PresentationsIndex() {
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: async () => (await db.listProjects()) ?? [] });
  const { data: allRooms = [] } = useQuery({
    queryKey: ["allRooms"],
    queryFn: async () => (await supabase.from("rooms").select("*, project:projects(name, client_name)").order("created_at")).data ?? [],
  });

  return (
    <AppShell>
      <div className="px-8 lg:px-16 py-12 lg:py-16 max-w-[1500px]">
        <div className="mb-12">
          <div className="eyebrow mb-3">Editorial</div>
          <h1 className="editorial-hero text-5xl lg:text-7xl">Presentation Boards</h1>
          <p className="mt-4 text-muted-foreground">One presentation per project — scroll to see each room.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(p => {
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
        </div>
      </div>
    </AppShell>
  );
}
