import { createFileRoute } from "@tanstack/react-router";
import { suggestPlanDimensions } from "@/lib/planDimensionSuggestion.server";

export const Route = createFileRoute("/api/suggest-plan-dimensions")({
  server: { handlers: { POST: async ({ request }) => {
    try { return await suggestPlanDimensions(request); }
    catch { return Response.json({ error: "Could not review dimensions for this selection. Please retry." }, {
      status: 500, headers: { "Cache-Control": "no-store" },
    }); }
  } } },
});
