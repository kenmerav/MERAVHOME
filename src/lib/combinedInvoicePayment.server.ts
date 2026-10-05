import { createHash } from "node:crypto";

export function combinedInvoicePaymentQuote(payment: { id: string; amount: number },
  charges: Array<{ id: string; amount: number }>) {
  const paymentCents = Math.round(Number(payment.amount) * 100);
  const items = [...charges].sort((a, b) => a.id.localeCompare(b.id))
    .map(item => ({ id: item.id, cents: Math.round(Number(item.amount) * 100) }));
  if (!Number.isSafeInteger(paymentCents) || paymentCents <= 0 || items.some(item => !Number.isSafeInteger(item.cents) || item.cents <= 0)) throw new Error("Invalid invoice payment amount.");
  const ids = items.map(item => item.id).join(",");
  if (ids.length > 500) throw new Error("Too many extra items for one payment link.");
  return { ids, paymentCents, totalCents: paymentCents + items.reduce((sum, item) => sum + item.cents, 0),
    hash: createHash("sha256").update(JSON.stringify([payment.id, paymentCents, items])).digest("hex") };
}
