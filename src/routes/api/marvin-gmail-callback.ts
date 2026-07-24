import { createFileRoute } from "@tanstack/react-router";
import { completeGmailOauth } from "@/lib/marvin.server";

function commandCenterUrl(requestUrl: string, status: "connected" | "error", detail?: string) {
  const url = new URL("/project-management", new URL(requestUrl).origin);
  url.searchParams.set("tab", "marvin");
  url.searchParams.set("gmail", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 180));
  return url;
}

export const Route = createFileRoute("/api/marvin-gmail-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        try {
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          if (!code || !state)
            throw new Error(
              url.searchParams.get("error") || "Google did not return an authorization code.",
            );
          await completeGmailOauth(code, state);
          return Response.redirect(commandCenterUrl(request.url, "connected"));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Google connection failed.";
          return Response.redirect(commandCenterUrl(request.url, "error", message));
        }
      },
    },
  },
});
