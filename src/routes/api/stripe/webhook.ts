import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncFinancialInvoiceToQuickBooks } from "@/lib/quickbooks.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function verifyStripeSignature(payload: string, signatureHeader: string | null, secret: string) {
  if (!signatureHeader) return false;
  const parts = new Map(signatureHeader.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

async function syncInvoiceTotals(invoiceId: string) {
  const { data: invoice } = await supabaseAdmin
    .from("financial_invoices")
    .select("id,total_amount")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return;

  const { data: payments = [] } = await supabaseAdmin
    .from("financial_invoice_payments")
    .select("amount,status")
    .eq("invoice_id", invoiceId);

  const paidAmount = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const totalAmount = Number(invoice.total_amount || 0);

  await supabaseAdmin
    .from("financial_invoices")
    .update({
      paid_amount: paidAmount,
      balance_due: Math.max(totalAmount - paidAmount, 0),
    } as any)
    .eq("id", invoiceId);
}

async function markPaymentLinkPaid({
  paymentId,
  paymentLinkId,
  checkoutSessionId,
  paymentIntentId,
}: {
  paymentId?: string | null;
  paymentLinkId?: string | null;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
}) {
  if (!paymentId && !paymentLinkId && !paymentIntentId) return { updated: 0 };

  let query = supabaseAdmin
    .from("financial_invoice_payments")
    .update({
      status: "paid",
      stripe_checkout_session_id: checkoutSessionId ?? null,
      stripe_payment_intent_id: paymentIntentId ?? null,
      paid_at: new Date().toISOString(),
    } as any)
    .select("id,invoice_id");

  query = paymentId
    ? query.eq("id", paymentId)
    : paymentLinkId
    ? query.eq("stripe_payment_link_id", paymentLinkId)
    : query.eq("stripe_payment_intent_id", paymentIntentId);

  const { data: updated = [], error } = await query;
  if (error) throw error;

  const invoiceIds = [...new Set(updated.map((payment) => payment.invoice_id).filter(Boolean))];
  await Promise.all(invoiceIds.map(syncInvoiceTotals));
  return { updated: updated.length, invoiceIds };
}

async function syncPaidInvoicesToQuickBooks(invoiceIds: string[]) {
  await Promise.all(invoiceIds.map(async (invoiceId) => {
    try {
      await syncFinancialInvoiceToQuickBooks(invoiceId);
    } catch (error) {
      // QuickBooks sync should never block Stripe from marking Studio payments paid.
      console.warn("QuickBooks auto-sync skipped", invoiceId, error);
    }
  }));
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) return json({ error: "Missing STRIPE_WEBHOOK_SECRET." }, 500);

        const payload = await request.text();
        if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), webhookSecret)) {
          return json({ error: "Invalid Stripe signature." }, 400);
        }

        const event = JSON.parse(payload);
        try {
          if (event.type === "checkout.session.completed") {
            const session = event.data?.object ?? {};
            const result = await markPaymentLinkPaid({
              paymentId: typeof session.metadata?.payment_id === "string" ? session.metadata.payment_id : null,
              paymentLinkId: typeof session.payment_link === "string" ? session.payment_link : null,
              checkoutSessionId: session.id ?? null,
              paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
            });
            await syncPaidInvoicesToQuickBooks(result.invoiceIds);
            return json({ received: true, ...result });
          }

          if (event.type === "payment_intent.succeeded") {
            const intent = event.data?.object ?? {};
            const result = await markPaymentLinkPaid({
              paymentId: typeof intent.metadata?.payment_id === "string" ? intent.metadata.payment_id : null,
              paymentIntentId: intent.id ?? null,
            });
            await syncPaidInvoicesToQuickBooks(result.invoiceIds);
            return json({ received: true, ...result });
          }

          return json({ received: true, ignored: true });
        } catch (error: any) {
          return json({ error: error?.message || "Could not process Stripe webhook." }, 500);
        }
      },
    },
  },
});
