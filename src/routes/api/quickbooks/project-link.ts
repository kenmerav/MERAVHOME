import { createFileRoute } from "@tanstack/react-router";
import { json, requireFinancialsAccess } from "@/lib/apiAuth.server";
import { saveQuickBooksProjectLink } from "@/lib/quickbooks.server";

export const Route = createFileRoute("/api/quickbooks/project-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireFinancialsAccess(request);
          if ("error" in access) return access.error;

          const body = await request.json();
          if (!body.projectId) return json({ error: "Missing Studio project." }, 400);
          const projectLink = await saveQuickBooksProjectLink({
            projectId: body.projectId,
            quickbooksCustomerId: body.quickbooksCustomerId,
            quickbooksCustomerName: body.quickbooksCustomerName,
            quickbooksProjectId: body.quickbooksProjectId,
            quickbooksProjectName: body.quickbooksProjectName,
          });
          return json({ projectLink });
        } catch (error: any) {
          return json({ error: error?.message || "Could not save QuickBooks project link." }, 500);
        }
      },
    },
  },
});
