import { createFileRoute } from "@tanstack/react-router";
import { specDrawingMatchesApi } from "@/lib/specDrawingMatches.server";
export const Route = createFileRoute("/api/spec-drawing-matches")({
  server: {
    handlers: {
      GET: ({ request }) => specDrawingMatchesApi(request),
      POST: ({ request }) => specDrawingMatchesApi(request),
    },
  },
});
