import { createFileRoute } from "@tanstack/react-router";
import { json, requireFinancialsAccess } from "@/lib/apiAuth.server";
import { getQuickBooksStatus } from "@/lib/quickbooks.server";

export const Route = createFileRoute("/api/quickbooks/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireFinancialsAccess(request);
          if ("error" in access) return access.error;

          const url = new URL(request.url);
          const projectId = url.searchParams.get("projectId");
          return json(await getQuickBooksStatus(projectId));
        } catch (error: any) {
          return json({ error: error?.message || "Could not load QuickBooks status." }, 500);
        }
      },
    },
  },
});
