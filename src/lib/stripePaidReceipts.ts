type ReceiptInvoice = { project_id?: string | null; raw_text?: string | null; paid_amount?: number | null; balance_due?: number | null };

export function stripePaidReceipt(invoice: ReceiptInvoice) {
  if (!invoice.raw_text) return null;
  try {
    const raw = JSON.parse(invoice.raw_text);
    if (raw.type !== "stripe_paid_receipt" || raw.version !== 1 ||
      typeof raw.description !== "string" || !raw.description.trim() ||
      typeof raw.stripe_payment_intent_id !== "string" || !/^pi_[a-zA-Z0-9]+$/.test(raw.stripe_payment_intent_id) ||
      !Number.isSafeInteger(raw.amount_cents) || raw.amount_cents <= 0 || raw.currency !== "usd" ||
      invoice.paid_amount == null || invoice.balance_due == null ||
      Math.round(Number(invoice.paid_amount) * 100) !== raw.amount_cents || Number(invoice.balance_due) !== 0) return null;
    let receiptUrl: string | null = null;
    try {
      const url = new URL(raw.original_receipt_url);
      if (url.protocol === "https:" && url.hostname === "pay.stripe.com" && url.pathname.startsWith("/receipts/") && !url.username && !url.password)
        receiptUrl = url.href;
    } catch { /* A saved payment remains reviewable even if its receipt link is missing. */ }
    return { description: raw.description.trim(), amount: raw.amount_cents / 100,
      paymentIntentId: raw.stripe_payment_intent_id as string, receiptUrl };
  } catch { return null; }
}
