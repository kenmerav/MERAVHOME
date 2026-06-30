import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { exchangeQuickBooksCode, getQuickBooksConfig } from "@/lib/quickbooks.server";

function html(message: string, ok = true) {
  return new Response(`<!doctype html>
<html>
  <head>
    <title>QuickBooks ${ok ? "Connected" : "Connection Failed"}</title>
    <style>
      body { font-family: Georgia, serif; padding: 48px; color: #16120f; background: #f7f4ef; }
      div { max-width: 620px; margin: 0 auto; background: white; border: 1px solid #ddd8ce; padding: 32px; }
      h1 { font-weight: 400; font-size: 40px; margin: 0 0 16px; }
      p { font-family: system-ui, sans-serif; color: #5f5850; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div>
      <h1>${ok ? "QuickBooks connected" : "QuickBooks connection failed"}</h1>
      <p>${message}</p>
      <p>You can close this tab and return to MERAV Studio.</p>
    </div>
  </body>
</html>`, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function verifyState(state: string | null) {
  const secret = getQuickBooksConfig().clientSecret;
  if (!state || !secret || !state.includes(".")) return false;
  const [payload, signature] = state.split(".");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature ?? "");
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(parsed.exp || 0) > Date.now();
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/quickbooks/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const error = url.searchParams.get("error");
          if (error) return html(`QuickBooks returned: ${error}`, false);

          const code = url.searchParams.get("code");
          const realmId = url.searchParams.get("realmId");
          const state = url.searchParams.get("state");

          if (!verifyState(state)) return html("The connection request expired. Start the QuickBooks connection from Studio again.", false);
          if (!code || !realmId) return html("QuickBooks did not return the required connection details.", false);

          await exchangeQuickBooksCode(code, realmId);
          return html("MERAV Studio can now send paid Studio invoices to QuickBooks.");
        } catch (error: any) {
          return html(error?.message || "Could not connect QuickBooks.", false);
        }
      },
    },
  },
});
