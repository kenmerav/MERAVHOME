import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/projects/$id/measured-rendering")({
  validateSearch: (s: Record<string, unknown>) => ({
    roomId: typeof s.roomId === "string" ? s.roomId : undefined,
  }),
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/projects/$id/rendering-studio",
      params: { id: params.id },
      search: { roomId: search.roomId },
      replace: true,
    });
  },
});
