import { createFileRoute } from "@tanstack/react-router";
import { json, requireFinancialsAccess } from "@/lib/apiAuth.server";
import { listQuickBooksCustomers } from "@/lib/quickbooks.server";

export const Route = createFileRoute("/api/quickbooks/customers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireFinancialsAccess(request);
          if ("error" in access) return access.error;

          const url = new URL(request.url);
          const search = url.searchParams.get("search");
          const customers = await listQuickBooksCustomers(search);
          return json({ customers });
        } catch (error: any) {
          return json({ error: error?.message || "Could not load QuickBooks customers." }, 500);
        }
      },
    },
  },
});
