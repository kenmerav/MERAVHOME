import { createFileRoute } from "@tanstack/react-router";
import { materialCatalogRequest } from "@/lib/materialCatalogSuggestions.server";
import { saveMaterialProductLinkRequest } from "@/lib/materialProductLink.server";
export const Route = createFileRoute("/api/material-catalog-suggestions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if ((await request.clone().json().catch(() => null))?.action === "link") return await saveMaterialProductLinkRequest(request);
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
