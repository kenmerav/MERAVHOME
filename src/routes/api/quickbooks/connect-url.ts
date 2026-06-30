import { createFileRoute } from "@tanstack/react-router";
import { createHmac, randomBytes } from "node:crypto";
import { json, requireFinancialsAccess } from "@/lib/apiAuth.server";
import { getQuickBooksConfig, quickBooksAuthorizationUrl } from "@/lib/quickbooks.server";

export const Route = createFileRoute("/api/quickbooks/connect-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireFinancialsAccess(request);
          if ("error" in access) return access.error;

          const config = getQuickBooksConfig();
          if (!config.clientId || !config.clientSecret) {
            return json({ error: "Missing QuickBooks Client ID or Client Secret in Vercel environment variables." }, 500);
          }

          const payload = Buffer.from(JSON.stringify({
            nonce: randomBytes(16).toString("hex"),
            exp: Date.now() + 10 * 60 * 1000,
          })).toString("base64url");
          const signature = createHmac("sha256", config.clientSecret).update(payload).digest("base64url");
          const state = `${payload}.${signature}`;

          return json({ url: quickBooksAuthorizationUrl(state) });
        } catch (error: any) {
          return json({ error: error?.message || "Could not start QuickBooks connection." }, 500);
        }
      },
    },
  },
});
