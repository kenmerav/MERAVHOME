/* eslint-disable @typescript-eslint/no-explicit-any -- Fathom payloads are external data. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decryptCredentials,
  ingestFathomPayload,
  json,
  verifyFathomWebhook,
} from "@/lib/marvin.server";

const admin = supabaseAdmin as any;

export const Route = createFileRoute("/api/marvin-fathom-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        try {
          const { data: integration } = await admin
            .from("marvin_integrations")
            .select("*")
            .eq("provider", "fathom")
            .eq("status", "connected")
            .maybeSingle();
          if (!integration) return json({ error: "Fathom is not connected." }, 404);
          const credentials = decryptCredentials(integration);
          if (
            !credentials.webhook_secret ||
            !verifyFathomWebhook(rawBody, request.headers, credentials.webhook_secret)
          ) {
            return json({ error: "Invalid webhook signature." }, 401);
          }
          const webhookId = request.headers.get("webhook-id") || "";
          const { error: eventError } = await admin.from("marvin_webhook_events").insert({
            provider: "fathom",
            external_id: webhookId,
          });
          if (eventError?.code === "23505") return json({ ok: true, duplicate: true });
          if (eventError) throw eventError;
          const payload = JSON.parse(rawBody);
          await ingestFathomPayload(payload, integration.owner_user_id);
          await admin
            .from("marvin_webhook_events")
            .update({ processed_at: new Date().toISOString() })
            .eq("provider", "fathom")
            .eq("external_id", webhookId);
          return json({ ok: true });
        } catch (error: any) {
          console.error("Fathom webhook failed", error?.message);
          return json({ error: "Unable to process this Fathom event." }, 500);
        }
      },
    },
  },
});
