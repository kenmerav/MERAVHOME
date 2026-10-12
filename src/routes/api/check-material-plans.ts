import { createFileRoute } from "@tanstack/react-router";
import { checkMaterialPlans } from "@/lib/materialPlanCheck.server";

export const Route = createFileRoute("/api/check-material-plans")({
  server: { handlers: { POST: async ({ request }) => {
    try { return await checkMaterialPlans(request); }
    catch { return Response.json({ error: "Could not check construction documents. Please retry." }, {
      status: 500, headers: { "Cache-Control": "no-store" },
    }); }
  } } },
});
