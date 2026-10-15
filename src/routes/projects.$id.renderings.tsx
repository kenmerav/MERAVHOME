import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/projects/$id/renderings")({
  validateSearch: (search: Record<string, unknown>): { roomId?: string; gallery?: boolean } => ({
    roomId: typeof search.roomId === "string" ? search.roomId : undefined,
    gallery: search.gallery === true || search.gallery === "true" ? true : undefined,
  }),
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/projects/$id/rendering-studio",
      params: { id: params.id },
      search,
      replace: true,
    });
  },
});
