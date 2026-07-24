import { createFileRoute } from "@tanstack/react-router";
import {
  getProcurementEmailConnection,
  procurementGmailAuthorizationUrl,
  requireProcurementEmailUser,
} from "@/lib/procurementEmail.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/procurement-email")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireProcurementEmailUser(request);
          if ("error" in access) return access.error;
          return json(await getProcurementEmailConnection());
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Could not load the draft email connection.";
          return json({ error: message }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const access = await requireProcurementEmailUser(request);
          if ("error" in access) return access.error;
          const body = (await request.json()) as { action?: string; return_to?: string };
          if (body.action !== "connect") return json({ error: "Unknown action." }, 400);
          return json({
            url: procurementGmailAuthorizationUrl({
              access,
              origin: new URL(request.url).origin,
              returnPath: body.return_to,
            }),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Could not start the Google connection.";
          return json({ error: message }, 500);
        }
      },
    },
  },
});
