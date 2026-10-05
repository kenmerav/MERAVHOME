import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncFinancialInvoiceToQuickBooks } from "@/lib/quickbooks.server";
import { combinedInvoicePaymentQuote } from "@/lib/combinedInvoicePayment.server";
import { INVOICE_ADJUSTMENT_PAYMENT_NOTE } from "@/lib/financialInvoiceLedger";

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
      ...(checkoutSessionId ? { stripe_checkout_session_id: checkoutSessionId } : {}),
      ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
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

export async function settleCombinedInvoicePayment(metadata: Record<string, string>,
  amountCents: number, reference: { checkoutSessionId?: string; paymentIntentId?: string }) {
  const ids = [...new Set((metadata.adjustment_ids ?? "").split(",").filter(Boolean))];
  const { data: payment, error } = await supabaseAdmin.from("financial_invoice_payments")
    .select("id,invoice_id,project_id,amount,status,stripe_payment_intent_id").eq("id", metadata.payment_id).maybeSingle();
  if (error) throw error;
  if (!payment || payment.invoice_id !== metadata.invoice_id) throw new Error("Combined invoice payment does not match this invoice.");
  const { data: charges, error: chargesError } = ids.length ? await supabaseAdmin.from("financial_invoice_adjustments")
    .select("id,invoice_id,amount,label,adjustment_type,status").eq("invoice_id", payment.invoice_id).in("id", ids)
    : { data: [], error: null };
  if (chargesError) throw chargesError;
  if ((charges ?? []).length !== ids.length || (charges ?? []).some(item => item.adjustment_type !== "charge" || !["open", "paid"].includes(item.status))) {
    throw new Error("Combined invoice items require payment review.");
  }
  const quote = combinedInvoicePaymentQuote(payment, charges ?? []);
  if (quote.hash !== metadata.quote_hash || quote.totalCents !== amountCents || quote.totalCents !== Number(metadata.quoted_amount_cents)) {
    throw new Error("Combined payment amount changed. Review the receipt before settling invoice items.");
  }
  if (payment.status === "paid" && payment.stripe_payment_intent_id !== reference.paymentIntentId) {
    throw new Error("This invoice phase was already paid by another payment.");
  }
  if (payment.status !== "paid" && (charges ?? []).some(item => item.status === "paid")) {
    throw new Error("An additional invoice item is already paid. Review the combined receipt.");
  }
  const result = await markPaymentLinkPaid({ paymentId: payment.id, ...reference });
  if (ids.length) {
    const { error: updateError } = await supabaseAdmin.from("financial_invoice_adjustments")
      .update({ status: "paid", settled_at: new Date().toISOString() }).eq("invoice_id", payment.invoice_id).in("id", ids).eq("status", "open");
    if (updateError) throw updateError;
    // Use each adjustment's UUID for an idempotent settlement allocation.
    // Existing QuickBooks sync can now reconcile the separately paid extras.
    const { error: settlementError } = await supabaseAdmin.from("financial_invoice_payments")
      .upsert((charges ?? []).map(item => ({ id: item.id, invoice_id: payment.invoice_id,
        project_id: payment.project_id, label: item.label, amount: Number(item.amount), status: "paid",
        notes: `${INVOICE_ADJUSTMENT_PAYMENT_NOTE} ${item.id}`, sort_order: 100000,
        paid_at: new Date().toISOString(),
        ...(reference.checkoutSessionId ? { stripe_checkout_session_id: reference.checkoutSessionId } : {}),
        ...(reference.paymentIntentId ? { stripe_payment_intent_id: reference.paymentIntentId } : {}),
      })) as any, { onConflict: "id" });
    if (settlementError) throw settlementError;
    await syncInvoiceTotals(payment.invoice_id);
  }
  return result;
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
          if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
            const session = event.data?.object ?? {};
            if (session.payment_status !== "paid") return json({ received: true, waitingForPayment: true });
            const result = session.metadata?.quote_hash ? await settleCombinedInvoicePayment(session.metadata,
              Number(session.amount_total), { checkoutSessionId: session.id,
                paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined }) : await markPaymentLinkPaid({
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
            const result = intent.metadata?.quote_hash ? await settleCombinedInvoicePayment(intent.metadata,
              Number(intent.amount_received), { paymentIntentId: intent.id }) : await markPaymentLinkPaid({
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
