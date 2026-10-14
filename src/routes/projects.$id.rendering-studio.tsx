import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ProjectRenderingStudio } from "@/components/ProjectRenderingStudio";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { canUseRenderingStudio } from "@/lib/permissions";

export const Route = createFileRoute("/projects/$id/rendering-studio")({
  head: () => ({ meta: [{ title: "Rendering Studio — MERAV Studio" }] }),
  validateSearch: (search: Record<string, unknown>): { roomId?: string; gallery?: boolean } => ({
    roomId: typeof search.roomId === "string" ? search.roomId : undefined,
    gallery: search.gallery === true || search.gallery === "true" ? true : undefined,
  }),
  component: RenderingStudioPage,
});

function RenderingStudioPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
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
  if (!canUseRenderingStudio(profile))
    return (
      <AppShell>
        <div className="page-pad">
          <p>This page is temporarily unavailable.</p>
          <Link to="/projects/$id" params={{ id }} className="inline-block mt-4 underline">
            Back to project
          </Link>
        </div>
      </AppShell>
    );
  return (
    <ProjectRenderingStudio
      key={id}
      projectId={id}
      initialRoomId={search.roomId}
      initialGalleryOpen={search.gallery}
    />
  );
}
