import { createFileRoute } from "@tanstack/react-router";
import { suggestBoardColor } from "@/lib/boardColorSuggestion.server";

export const Route = createFileRoute("/api/suggest-board-color")({
  server: { handlers: { POST: async ({ request }) => {
    try { return await suggestBoardColor(request); }
    catch { return Response.json({ error: "Could not review this item's board image. Please retry." }, {
      status: 500, headers: { "Cache-Control": "no-store" },
    }); }
  } } },
});
