import { describe, it, expect } from "vitest";
import { stripePaidReceipt } from "../src/lib/stripePaidReceipts";

const record = (raw: Record<string, unknown> = {}) => ({ paid_amount: 123.45, balance_due: 0,
  raw_text: JSON.stringify({ type: "stripe_paid_receipt", version: 1, description: "Design document delivery",
    stripe_payment_intent_id: "pi_verified", amount_cents: 12345, currency: "usd",
    original_receipt_url: "https://pay.stripe.com/receipts/payment/source", ...raw }) });
describe("saved paid Stripe receipts", () => {
  it("reads a verified paid receipt and preserves its original source", () => {
    expect(stripePaidReceipt(record())).toMatchObject({ amount: 123.45, description: "Design document delivery",
      paymentIntentId: "pi_verified", receiptUrl: "https://pay.stripe.com/receipts/payment/source" });
  });
  it("does not treat regular invoices or malformed JSON as imported receipts", () => {
    for (const invoice of [{ raw_text: "{broken" }, record({ type: "design_service_invoice" }), { raw_text: null }])
      expect(stripePaidReceipt(invoice)).toBeNull();
  });
  it("requires full payment and zero remaining balance", () => {
    expect(stripePaidReceipt({ ...record(), paid_amount: 120 })).toBeNull();
    expect(stripePaidReceipt({ ...record(), balance_due: 10 })).toBeNull();
    for (const raw of [{ amount_cents: 0 }, { amount_cents: 12.5 }, { currency: "eur" }, { stripe_payment_intent_id: "invalid" }])
      expect(stripePaidReceipt(record(raw))).toBeNull();
  });
  it("never opens untrusted or non-Stripe receipt URLs", () => {
    for (const original_receipt_url of ["javascript:alert(1)", "https://pay.stripe.com.attacker.test/receipts/payment/x", "https://attacker.test/", "https://user:password@pay.stripe.com/receipts/payment/x", "http://pay.stripe.com/receipts/payment/x"])
      expect(stripePaidReceipt(record({ original_receipt_url }))?.receiptUrl).toBeNull();
  });
});
