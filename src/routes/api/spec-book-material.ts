import { createFileRoute } from "@tanstack/react-router";
import { setSpecBookMaterialRemoved } from "@/lib/specBookMaterialRemoval.server";

export const Route = createFileRoute("/api/spec-book-material")({
  server: { handlers: { PATCH: async ({ request }) => {
    try {
      return await setSpecBookMaterialRemoved(request);
    } catch {
      return Response.json({ error: "Could not update the project item. Please retry." }, {
        status: 500, headers: { "Cache-Control": "no-store" },
      });
    }
  } } },
});
