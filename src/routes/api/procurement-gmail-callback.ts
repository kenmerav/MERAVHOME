import { createFileRoute } from "@tanstack/react-router";
import { completeProcurementGmailOauth } from "@/lib/procurementEmail.server";

function destination(
  requestUrl: string,
  returnPath: string,
  status: "connected" | "error",
  detail?: string,
) {
  const url = new URL(returnPath, new URL(requestUrl).origin);
  url.searchParams.set("procurement_gmail", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 180));
  return url;
}

export const Route = createFileRoute("/api/procurement-gmail-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        try {
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          if (!code || !state) {
            throw new Error(
              url.searchParams.get("error") || "Google did not return an authorization code.",
            );
          }
          const result = await completeProcurementGmailOauth(code, state);
          return Response.redirect(destination(request.url, result.returnPath, "connected"));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Google connection failed.";
          return Response.redirect(destination(request.url, "/specbooks", "error", message));
        }
      },
    },
  },
});
