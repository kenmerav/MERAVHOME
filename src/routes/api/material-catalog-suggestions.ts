import { createFileRoute } from "@tanstack/react-router";
import { materialCatalogRequest } from "@/lib/materialCatalogSuggestions.server";
export const Route = createFileRoute("/api/material-catalog-suggestions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await materialCatalogRequest(request);
        } catch {
          return Response.json(
            {
              error:
                "Could not load or add the catalog selection. Refresh Materials and try again.",
            },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
