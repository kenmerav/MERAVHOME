import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/projects/$id/presentation")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/presentations/$id", params: { id: params.id } });
  },
});
