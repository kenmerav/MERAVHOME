import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canViewFinancials } from "@/lib/permissions";
import { combinedInvoicePaymentQuote } from "@/lib/combinedInvoicePayment.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function stripePost(path: string, body: URLSearchParams, apiKey: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Stripe request failed.");
  return data;
}

async function requireInvoiceAccess(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in as Ken or Katie to use invoice tools." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!canViewFinancials(profile)) return { error: json({ error: "Only Ken and Katie can use invoice tools." }, 403) };

  return { user: userData.user };
}

function appendStripeLinkNote(notes: string | null | undefined, url: string) {
  const cleanNotes = (notes ?? "").replace(/Stripe payment link:\s*https:\/\/(?:buy|checkout)\.stripe\.com\/[^\s"')<]+/gi, "").trim();
  return [cleanNotes, `Stripe payment link: ${url}`].filter(Boolean).join("\n");
}

export const Route = createFileRoute("/api/mark-financial-payment-due")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireInvoiceAccess(request);
          if ("error" in access) return access.error;

          const { paymentId, includeCharges = false } = (await request.json()) as { paymentId?: string; includeCharges?: boolean };
          if (!paymentId) return json({ error: "Missing payment id." }, 400);

          const { data: payment, error: paymentError } = await supabaseAdmin
            .from("financial_invoice_payments")
            .select("*, invoice:financial_invoices(id,file_name,client_name,project_id,project:projects(id,name,client_name))")
            .eq("id", paymentId)
            .maybeSingle();
          if (paymentError) return json({ error: paymentError.message }, 500);
          if (!payment) return json({ error: "Payment not found." }, 404);
          const previousLinkId = payment.stripe_payment_link_id;
          if (includeCharges && payment.status === "paid") return json({ error: "This phase is already paid." }, 400);

          let charges: Array<{ id: string; amount: number; label: string }> = [];
          if (includeCharges) {
            const { data, error } = await supabaseAdmin.from("financial_invoice_adjustments")
              .select("id,amount,label,adjustment_type,status").eq("invoice_id", payment.invoice_id).eq("status", "open");
            if (error) throw error;
            if ((data ?? []).some(item => item.adjustment_type === "credit")) {
              return json({ error: "Review the open credit before generating a combined payment link." }, 400);
            }
            charges = (data ?? []).filter(item => item.adjustment_type === "charge");
          }
          const quote = combinedInvoicePaymentQuote(payment, charges);

          const amount = Number((payment as any).amount || 0);
          if (amount <= 0) return json({ error: "Payment amount must be greater than $0 before it can be marked due." }, 400);

          const apiKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
          if (!apiKey) {
            const { data: updated, error: updateError } = await supabaseAdmin
              .from("financial_invoice_payments")
              .update({ status: "due" })
              .eq("id", paymentId)
              .select()
              .single();
            if (updateError) return json({ error: updateError.message }, 500);
            return json({
              payment: updated,
              warning: "Marked due, but STRIPE_SECRET_KEY is missing so no payment link was created.",
            });
          }

          const invoice = (payment as any).invoice;
          const project = invoice?.project;
          const projectName = project?.name ?? invoice?.file_name ?? "MERAV Studio";
          const label = (payment as any).label || "Payment Due";
          const clientName = invoice?.client_name || project?.client_name || "Client";
          const cents = Math.round(amount * 100);

          const product = await stripePost("products", new URLSearchParams({
            name: `${projectName} - ${label}`,
            type: "service",
            description: `${clientName} - ${label}`,
          }), apiKey);
          const price = await stripePost("prices", new URLSearchParams({
            product: product.id,
            unit_amount: String(cents),
            currency: "usd",
          }), apiKey);
          const linkParams = new URLSearchParams({
            "line_items[0][price]": price.id,
            "line_items[0][quantity]": "1",
            "metadata[invoice_id]": invoice?.id ?? "",
            "metadata[payment_id]": paymentId,
            "metadata[project_id]": invoice?.project_id ?? (payment as any).project_id ?? "",
            "metadata[payment_label]": label,
          });
          if (includeCharges) {
            linkParams.set("restrictions[completed_sessions][limit]", "1");
            linkParams.set("metadata[adjustment_ids]", quote.ids);
            linkParams.set("metadata[quote_hash]", quote.hash);
            linkParams.set("metadata[quoted_amount_cents]", String(quote.totalCents));
            linkParams.set("payment_intent_data[metadata][invoice_id]", invoice?.id ?? "");
            linkParams.set("payment_intent_data[metadata][payment_id]", paymentId);
            linkParams.set("payment_intent_data[metadata][adjustment_ids]", quote.ids);
            linkParams.set("payment_intent_data[metadata][quote_hash]", quote.hash);
            linkParams.set("payment_intent_data[metadata][quoted_amount_cents]", String(quote.totalCents));
            for (let index = 0; index < charges.length; index++) {
              const item = charges[index];
              const extraProduct = await stripePost("products", new URLSearchParams({ name: `${projectName} - ${item.label}` }), apiKey);
              const extraPrice = await stripePost("prices", new URLSearchParams({ product: extraProduct.id,
                unit_amount: String(Math.round(Number(item.amount) * 100)), currency: "usd" }), apiKey);
              linkParams.set(`line_items[${index + 1}][price]`, extraPrice.id);
              linkParams.set(`line_items[${index + 1}][quantity]`, "1");
            }
          }
          const link = await stripePost("payment_links", linkParams, apiKey);

          const cleanNotes = (payment.notes ?? "").replace(/^Stripe (payment amount|adjustment ids):[^\n]*(\n|$)/gm, "");
          const notes = [appendStripeLinkNote(cleanNotes, link.url),
            `Stripe payment amount: ${(quote.totalCents / 100).toFixed(2)}`,
            `Stripe adjustment ids: ${quote.ids}`].join("\n");

          const { data: updated, error: updateError } = await supabaseAdmin
            .from("financial_invoice_payments")
            .update({
              status: "due",
              notes,
              stripe_payment_link_id: link.id,
              stripe_checkout_session_id: null,
              stripe_payment_intent_id: null,
            })
            .eq("id", paymentId)
            .select()
            .single();
          if (updateError) return json({ error: updateError.message }, 500);

          let warning: string | undefined;
          if (includeCharges && previousLinkId && previousLinkId !== link.id) {
            try {
              await stripePost(`payment_links/${previousLinkId}`, new URLSearchParams({ active: "false" }), apiKey);
            } catch {
              warning = "The new link is ready, but the previous payment link could not be disabled.";
            }
          }

          return json({ payment: updated, url: link.url, id: link.id, amount: quote.totalCents / 100, warning });
        } catch (e: any) {
          return json({ error: e?.message || "Could not mark payment due." }, 500);
        }
      },
    },
  },
});
