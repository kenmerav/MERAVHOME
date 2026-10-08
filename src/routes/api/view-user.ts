import { createFileRoute } from "@tanstack/react-router";
import { startUserView } from "@/lib/userView.server";

export const Route = createFileRoute("/api/view-user")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await startUserView(request);
        } catch {
          return Response.json(
            { error: "Could not open this account view." },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
