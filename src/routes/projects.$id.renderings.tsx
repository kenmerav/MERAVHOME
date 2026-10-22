import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { ProjectRenderingStudio } from "@/components/ProjectRenderingStudio";
import { db } from "@/lib/db";
import { isStudioTeamRole } from "@/lib/permissions";

export const Route = createFileRoute("/projects/$id/renderings")({
  head: () => ({ meta: [{ title: "Renderings — MERAV Studio" }] }),
  validateSearch: (search: Record<string, unknown>): { roomId?: string } => ({
    roomId: typeof search.roomId === "string" ? search.roomId : undefined,
  }),
  component: RenderingsPage,
});

function RenderingsPage() {
  const { id } = Route.useParams();
  const { roomId } = Route.useSearch();
  const { data: profile, isPending } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  if (isPending)
    return (
      <AppShell>
        <p className="page-pad text-muted-foreground">Loading…</p>
      </AppShell>
    );
  if (!profile?.is_active || !isStudioTeamRole(profile.role))
    return (
      <AppShell>
        <div className="page-pad">
          <p>This page is unavailable for this account.</p>
          <Link to="/projects/$id" params={{ id }} className="inline-block mt-4 underline">
            Back to project
          </Link>
        </div>
      </AppShell>
    );
  return <ProjectRenderingStudio key={id} projectId={id} initialRoomId={roomId} libraryOnly />;
}
