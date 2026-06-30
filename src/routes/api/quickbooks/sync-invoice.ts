import { createFileRoute } from "@tanstack/react-router";
import { json, requireFinancialsAccess } from "@/lib/apiAuth.server";
import { syncFinancialInvoiceToQuickBooks } from "@/lib/quickbooks.server";

export const Route = createFileRoute("/api/quickbooks/sync-invoice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireFinancialsAccess(request);
          if ("error" in access) return access.error;

          const body = await request.json();
          if (!body.invoiceId) return json({ error: "Missing invoice." }, 400);
          const result = await syncFinancialInvoiceToQuickBooks(body.invoiceId);
          return json(result);
        } catch (error: any) {
          return json({ error: error?.message || "Could not send invoice to QuickBooks." }, 500);
        }
      },
    },
  },
});
