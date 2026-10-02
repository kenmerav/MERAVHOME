import { describe, expect, it } from "vitest";
import { prepareInvoiceHtml } from "../src/lib/invoiceDocuments";
import {
  currentDueInvoicePayment, invoicePaymentStripeUrl, invoiceDraftPricingChanged,
  refreshServiceInvoicePayments, renderServiceInvoicePayments,
} from "../src/lib/serviceInvoicePayments";

const payments = [
  { label: "Phase 1 - Project Start", amount: 5000, status: "paid", notes: "https://buy.stripe.com/test_old", sort_order: 0 },
  { label: "Phase 2 - Design Presentation", amount: 2500, status: "due", notes: "Stripe payment link: https://buy.stripe.com/test_presentation", sort_order: 1 },
  { label: "Phase 3 - Design Document Delivery", amount: 2000, status: "not_due", notes: null, sort_order: 2 },
  { label: "Phase 4 - Project Completion", amount: 500, status: "not_due", notes: null, sort_order: 3 },
];
const legacy = `<!doctype html><html><head><style>.current-phase { font-weight:700 }</style></head><body>
<h1>SERVICE INVOICE</h1><table><tr><td>Original scope and selections</td></tr></table>
<section class="summary">
<div class="fee-row"><strong class="fee-label">Total Design Fee:</strong><span class="fee-box">$10,000.00</span></div>
<div class="summary-row"><strong>Paid:</strong><span></span></div>
<div class="summary-row current-phase">Due on Project Start: $5,000.00</div>
<div class="pay"><div><a href="https://buy.stripe.com/test_old">CLICK HERE TO PAY</a></div><div>$5,000.00</div></div>
<div class="sig"><span>Authorized by Client</span><span>Date</span></div>
<div class="sig"><span>Authorized by MERAV INTERIORS</span><span>Date</span></div>
</section></body></html>`;

describe("service invoice current payment summary", () => {
  it("invalidates a draft link when its selected phase or pricing changes, not when client details change", () => {
    const draft = { currentPhase: "Project Start", squareFeet: "2000", clientName: "Sample", paid: "" };
    expect(invoiceDraftPricingChanged(draft, { currentPhase: "Design Presentation" })).toBe(true);
    expect(invoiceDraftPricingChanged(draft, { squareFeet: "2500" })).toBe(true);
    expect(invoiceDraftPricingChanged(draft, { paid: "100" })).toBe(true);
    expect(invoiceDraftPricingChanged(draft, { clientName: "Another name" })).toBe(false);
    expect(invoiceDraftPricingChanged(draft, { currentPhase: "Project Start" })).toBe(false);
  });
  it("strikes paid labels and amounts and bolds the current due phase with its own link/amount", () => {
    const html = renderServiceInvoicePayments({ payments, totalAmount: 10000 });
    expect(html).toContain("<s>Due on Project Start:</s>");
    expect(html).toContain("<s>$5,000.00</s>");
    expect(html).not.toContain("<small>Paid</small>");
    expect(html).toContain("<span><s>Due on Project Start:</s></span><s>$5,000.00</s>");
    expect(html).toContain('class="summary-row current-phase" style="font-weight:700"><span>Due at Design Presentation:');
    expect(html).toContain('href="https://buy.stripe.com/test_presentation"');
    expect(html).toContain('<div>$2,500.00</div>');
    expect(html).toContain("<strong>Paid:</strong><span>$5,000.00</span>");
    expect(html).toContain("<u>$5,000.00</u>");
    expect(html).not.toContain("test_old");
    expect(payments[0].status).toBe("paid");
    expect(payments[2].status).toBe("not_due");
  });
  it("uses the latest due phase by sequence, even if received in a different order", () => {
    const rows = [{ ...payments[2], status: "due", notes: "https://buy.stripe.com/test_documents" }, ...payments];
    expect(currentDueInvoicePayment(rows)).toBe(rows[0]);
    const html = renderServiceInvoicePayments({ payments: rows, totalAmount: 12000 });
    expect(html).toContain('href="https://buy.stripe.com/test_documents"');
    expect(html).not.toContain('href="https://buy.stripe.com/test_presentation"');
    expect(html).toContain('<div>$2,000.00</div>');
  });
  it("never falls back to an earlier link when the latest due phase has no link", () => {
    const rows = [...payments, { ...payments[2], status: "due" }];
    expect(invoicePaymentStripeUrl(currentDueInvoicePayment(rows))).toBeNull();
    const html = renderServiceInvoicePayments({ payments: rows, totalAmount: 10000 });
    expect(html).toContain("Amount due now");
    expect(html).toContain('<div>$2,000.00</div>');
    expect(html).not.toContain("stripe.com");
  });
  it("shows no payment link or bold phase when every phase is paid", () => {
    const html = renderServiceInvoicePayments({ payments: payments.map(p => ({ ...p, status: "paid" })), totalAmount: 10000 });
    expect(html.match(/<s>/g)).toHaveLength(8);
    expect(html).not.toContain("<small>Paid</small>");
    expect(html).toContain("<u>$0.00</u>");
    expect(html).toContain("No payment currently due");
    expect(html).not.toContain("CLICK HERE TO PAY");
    expect(html).not.toContain("current-phase");
  });
  it("does not infer due/paid status from phase order or create a future obligation", () => {
    const rows = payments.map(p => ({ ...p, status: "not_due" }));
    expect(currentDueInvoicePayment(rows)).toBeNull();
    expect(renderServiceInvoicePayments({ payments: rows, totalAmount: 10000 })).not.toContain("<s>");
  });
  it("distinguishes waived from paid and excludes zero/invalid due amounts", () => {
    const rows = [{ ...payments[0], status: "waived" }, { ...payments[1], amount: 0 }, { ...payments[2], status: "due", amount: NaN }];
    const html = renderServiceInvoicePayments({ payments: rows, totalAmount: 10000 });
    expect(html).toContain("<small>Waived</small>");
    expect(html).toContain("<strong>Paid:</strong><span>$0.00</span>");
    expect(html).not.toContain("stripe.com");
    expect(currentDueInvoicePayment(rows)).toBeNull();
  });
  it("includes previous external payments once and respects current ledger totals", () => {
    const rows = [{ label: "Previously Paid", status: "paid", amount: 1000, sort_order: -1 }, ...payments];
    const html = renderServiceInvoicePayments({ payments: rows, totalAmount: 11000, paidAmount: 6000, balanceDue: 4800 });
    expect(html).toContain("<strong>Paid:</strong><span>$6,000.00</span>");
    expect(html).toContain("<u>$4,800.00</u>");
    expect(html).not.toContain("Due at Previously Paid");
  });
  it("escapes client content and link attributes", () => {
    const row = { label: "Phase 1 - <script>bad</script>", amount: 100, status: "due", notes: 'https://buy.stripe.com/test?x=1&y=2" onclick="bad' };
    const html = renderServiceInvoicePayments({ payments: [row], totalAmount: 100 });
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("?x=1&amp;y=2");
    expect(html).not.toContain('onclick=');
  });
});

describe("saved invoice views and downloads", () => {
  const summary = { payments, totalAmount: 10000 };
  it("refreshes legacy saved HTML without changing scope, header, fee or signatures", () => {
    const result = prepareInvoiceHtml(legacy, { paymentUrl: "https://buy.stripe.com/test_wrong", servicePayments: summary });
    expect(result).toContain("Original scope and selections");
    expect(result).toContain('<span class="fee-box">$10,000.00</span>');
    expect(result).toContain("Authorized by Client");
    expect(result).toContain("Authorized by MERAV INTERIORS");
    expect(result).toContain("<s>Due on Project Start:</s>");
    expect(result).toContain('href="https://buy.stripe.com/test_presentation"');
    expect(result).not.toContain("test_old");
    expect(result).not.toContain("test_wrong");
    expect(legacy).toContain("test_old");
  });
  it("reopens a previously refreshed invoice after another phase is paid", () => {
    const first = refreshServiceInvoicePayments(legacy, summary);
    const rows = payments.map((p, i) => i === 1 ? { ...p, status: "paid" } : i === 2 ? { ...p, status: "due", notes: "https://buy.stripe.com/test_documents" } : p);
    const result = prepareInvoiceHtml(first, { servicePayments: { payments: rows, totalAmount: 10000 } });
    expect(result.match(/<s>/g)).toHaveLength(4);
    expect(result).not.toContain("<small>Paid</small>");
    expect(result.match(/<!-- service-payments:start -->/g)).toHaveLength(1);
    expect(result).toContain("<strong>Paid:</strong><span>$7,500.00</span>");
    expect(result).toContain('href="https://buy.stripe.com/test_documents"');
    expect(result).not.toContain("test_presentation");
  });
  it("keeps an amount-only due row when no current link exists", () => {
    const result = prepareInvoiceHtml(legacy, { servicePayments: { payments: payments.map(p => ({ ...p, notes: null })), totalAmount: 10000 } });
    expect(result).toContain("Amount due now");
    expect(result).not.toContain("stripe.com");
  });
  it("leaves non-service/procurement content alone", () => {
    const html = "<h1>Product Invoice</h1><table><tr><td>Faucet</td></tr></table>";
    expect(refreshServiceInvoicePayments(html, summary)).toBe(html);
  });
});
