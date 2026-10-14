import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { MeasuredRenderingWorkspace } from "@/components/MeasuredRenderingWorkspace";
export const Route = createFileRoute("/projects/$id/measured-rendering")({
  head: () => ({ meta: [{ title: "Measured Renderings — MERAV Studio" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    roomId: typeof s.roomId === "string" ? s.roomId : undefined,
  }),
  component: MeasuredRenderingPage,
});
function MeasuredRenderingPage() {
  const { id } = Route.useParams(),
    search = Route.useSearch();
  return (
    <AppShell>
      <MeasuredRenderingWorkspace key={id} projectId={id} initialRoomId={search.roomId} />
    </AppShell>
  );
}
