import { createFileRoute } from "@tanstack/react-router";
import { SpecBookDocument } from "./specbooks.$id";

export const Route = createFileRoute("/specbooks/public/$id")({
  head: () => ({ meta: [{ title: "Spec Book — MERAV Studio" }] }),
  component: PublicSpecBookPage,
});

function PublicSpecBookPage() {
  const { id } = Route.useParams();

  return (
    <div className="min-h-screen bg-background">
      <SpecBookDocument projectId={id} publicView />
    </div>
  );
}
