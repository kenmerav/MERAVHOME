import { createFileRoute } from "@tanstack/react-router";
import { ProjectRenderingStudio } from "@/components/ProjectRenderingStudio";

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
  return (
    <ProjectRenderingStudio
      key={id}
      projectId={id}
      initialRoomId={search.roomId}
      initialGalleryOpen={search.gallery}
    />
  );
}
