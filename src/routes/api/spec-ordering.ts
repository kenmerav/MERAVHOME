import { createFileRoute } from "@tanstack/react-router";
import { updateSpecOrdering } from "@/lib/specOrdering.server";

export const Route = createFileRoute("/api/spec-ordering")({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        try {
          return await updateSpecOrdering(request);
        } catch {
          return Response.json(
            { error: "Could not update ordering. Please try again." },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
