import { createFileRoute } from "@tanstack/react-router";
import { savedSpecCompletionRequest } from "@/lib/savedSpecCompletionApi.server";
export const Route = createFileRoute("/api/spec-completion-review")({
  server: { handlers: { POST: async ({ request }) => {
    try { return await savedSpecCompletionRequest(request); }
    catch { return Response.json({ error: "Could not load your saved review. Please retry." }, {
      status: 500, headers: { "Cache-Control": "no-store" },
    }); }
  } } },
});
