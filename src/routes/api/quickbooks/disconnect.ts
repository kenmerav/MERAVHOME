import { createFileRoute } from "@tanstack/react-router";
import { json, requireFinancialsAccess } from "@/lib/apiAuth.server";
import { disconnectQuickBooks } from "@/lib/quickbooks.server";

function html() {
  return new Response(`<!doctype html>
<html>
  <head>
    <title>Disconnect QuickBooks</title>
    <style>
      body { font-family: Georgia, serif; padding: 48px; color: #16120f; background: #f7f4ef; }
      div { max-width: 680px; margin: 0 auto; background: white; border: 1px solid #ddd8ce; padding: 32px; }
      h1 { font-weight: 400; font-size: 40px; margin: 0 0 16px; }
      p { font-family: system-ui, sans-serif; color: #5f5850; line-height: 1.5; }
      a { color: #16120f; }
    </style>
  </head>
  <body>
    <div>
      <h1>Disconnect QuickBooks</h1>
      <p>QuickBooks can be disconnected from MERAV Studio by an authorized Studio administrator from inside the Studio financials workflow.</p>
      <p>If you need help disconnecting QuickBooks, contact Merav Interiors at <a href="mailto:katie@meravinteriors.com">katie@meravinteriors.com</a>.</p>
    </div>
  </body>
</html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/quickbooks/disconnect")({
  server: {
    handlers: {
      GET: async () => html(),
      POST: async ({ request }) => {
        try {
          const access = await requireFinancialsAccess(request);
          if ("error" in access) return access.error;
          await disconnectQuickBooks();
          return json({ ok: true });
        } catch (error: any) {
          return json({ error: error?.message || "Could not disconnect QuickBooks." }, 500);
        }
      },
    },
  },
});
