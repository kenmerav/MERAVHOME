import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { combinedInvoicePaymentQuote } from "../src/lib/combinedInvoicePayment.server";
import { financialInvoiceLedger, INVOICE_ADJUSTMENT_PAYMENT_NOTE } from "../src/lib/financialInvoiceLedger";
import { invoiceDueNow } from "../src/lib/serviceInvoicePayments";
const mock = vi.hoisted(() => ({ query: vi.fn(), sync: vi.fn() }));
vi.mock("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: { id: "staff" } }, error: null }) },
  from: (table: string) => {
    const state: any = { table, op: "select", filters: [], single: false };
    const chain: any = {};
    for (const method of ["select", "eq", "in", "maybeSingle", "single", "update", "upsert"]) chain[method] = (...args: any[]) => {
      if (["eq", "in"].includes(method)) state.filters.push([method, ...args]);
      if (["single", "maybeSingle"].includes(method)) state.single = true;
      if (["update", "upsert"].includes(method)) { state.op = method; state.patch = args[0]; }
      return chain;
    };
    chain.then = (resolve: any, reject: any) => Promise.resolve(mock.query(state)).then(resolve, reject);
    return chain;
  },
} }));
vi.mock("../src/lib/quickbooks.server", () => ({ syncFinancialInvoiceToQuickBooks: mock.sync }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
import { Route as PaymentRoute } from "../src/routes/api/mark-financial-payment-due";
import { Route as WebhookRoute, settleCombinedInvoicePayment } from "../src/routes/api/stripe/webhook";
const handler = (route: any) => route.options.server.handlers.POST;
const id = "11111111-1111-4111-8111-111111111111";
const invoiceId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
let payment: any;
let charge: any;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "test-only");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "test-webhook-secret");
  payment = { id, invoice_id: invoiceId, project_id: "project", amount: 9000, status: "due", notes: null,
    stripe_payment_link_id: "plink_old", stripe_payment_intent_id: null,
    invoice: { id: invoiceId, project_id: "project", client_name: "Client", project: { name: "Project" } } };
  charge = { id: itemId, invoice_id: invoiceId, amount: 2500, label: "Material Ordering", status: "open", adjustment_type: "charge" };
  mock.query.mockImplementation((state: any) => {
    if (state.table === "user_profiles") return { data: { email: "ken@meravinteriors.com", is_active: true }, error: null };
    if (state.op === "upsert") return { data: null, error: null };
    if (state.op === "update") {
      if (state.table === "financial_invoice_adjustments") Object.assign(charge, state.patch);
      if (state.table === "financial_invoice_payments") Object.assign(payment, state.patch);
      return { data: state.single ? payment : [{ id, invoice_id: invoiceId }], error: null };
    }
    if (state.table === "financial_invoice_adjustments") return { data: [charge], error: null };
    if (state.table === "financial_invoice_payments") return { data: state.single ? payment : [payment], error: null };
    return { data: { id: invoiceId, total_amount: 18000 }, error: null };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function metadata() { const quote = combinedInvoicePaymentQuote(payment, [charge]); return {
  payment_id: id, invoice_id: invoiceId, adjustment_ids: itemId, quote_hash: quote.hash, quoted_amount_cents: String(quote.totalCents),
}; }
function eventRequest(type: string, data: unknown) {
  const body = JSON.stringify({ type, data: { object: data } });
  const time = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", "test-webhook-secret").update(`${time}.${body}`).digest("hex");
  return new Request("https://studio.example/api/stripe/webhook", { method: "POST", body,
    headers: { "stripe-signature": `t=${time},v1=${sig}` } });
}
describe("combined invoice collection", () => {
  it("shows $11,500 and uses a link only when it includes the same extra items", () => {
    const phase = { ...payment, notes: "Stripe payment link: https://buy.stripe.com/test\nStripe payment amount: 11500.00\nStripe adjustment ids: " + itemId };
    const summary = { payments: [phase], totalAmount: 18000, adjustments: [charge] };
    expect(invoiceDueNow(summary)).toMatchObject({ amount: 11500, link: "https://buy.stripe.com/test" });
    expect(invoiceDueNow({ ...summary, payments: [{ ...phase, notes: "https://buy.stripe.com/test" }] }).link).toBeNull();
    expect(invoiceDueNow({ ...summary, adjustments: [{ ...charge, id: "different" }] }).link).toBeNull();
    expect(invoiceDueNow({ ...summary, adjustments: [{ ...charge, status: "paid" }] })).toMatchObject({ amount: 9000, link: null });
  });
  it("creates two Stripe line items without increasing the stored design phase amount", async () => {
    let counter = 0;
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("payment_links")
      ? { id: "plink_new", url: "https://buy.stripe.com/test_combined" } : { id: `object_${++counter}` })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await handler(PaymentRoute)({ request: new Request("https://studio.example/api/mark-financial-payment-due", {
      method: "POST", headers: { Authorization: "Bearer test-user" }, body: JSON.stringify({ paymentId: id, includeCharges: true }),
    }) });
    expect(response.status).toBe(200);
    expect((await response.json()).amount).toBe(11500);
    const linkCall: any = fetchMock.mock.calls.find(call => call[0].endsWith("/payment_links"));
    const params = linkCall[1].body as URLSearchParams;
    expect(params.get("line_items[1][price]")).toBeTruthy();
    expect(params.get("metadata[adjustment_ids]")).toBe(itemId);
    expect(params.get("restrictions[completed_sessions][limit]")).toBe("1");
    expect(payment.amount).toBe(9000);
    expect(payment.notes).toContain("Stripe payment amount: 11500.00");
    expect(fetchMock.mock.calls.some(call => call[0].endsWith("payment_links/plink_old"))).toBe(true);
  });
  it("requires financial access before creating a link", async () => {
    const response = await handler(PaymentRoute)({ request: new Request("https://studio.example/api/mark-financial-payment-due", { method: "POST", body: "{}" }) });
    expect(response.status).toBe(401);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("settles both the phase and extra and creates one repeatable QuickBooks allocation", async () => {
    const meta = metadata();
    for (let i = 0; i < 2; i++) await settleCombinedInvoicePayment(meta, 1150000, { paymentIntentId: "pi_test", checkoutSessionId: "cs_test" });
    expect(payment.status).toBe("paid");
    expect(charge.status).toBe("paid");
    const allocations = mock.query.mock.calls.map(call => call[0]).filter(state => state.op === "upsert");
    expect(allocations).toHaveLength(2);
    expect(allocations[0].patch[0]).toMatchObject({ id: itemId, amount: 2500, notes: `${INVOICE_ADJUSTMENT_PAYMENT_NOTE} ${itemId}` });
    expect(allocations[1].patch[0].id).toBe(itemId);
    const ledger = financialInvoiceLedger({ payments: [{ amount: 9000, status: "paid" }, payment, allocations[0].patch[0]], adjustments: [charge] });
    expect(ledger).toMatchObject({ originalTotal: 18000, adjustedTotal: 20500, grossPaid: 20500, balanceDue: 0 });
  });
  it("rejects altered amounts before changing any records", async () => {
    const meta = metadata();
    charge.amount = 2600;
    await expect(settleCombinedInvoicePayment(meta, 1150000, { paymentIntentId: "pi_test" })).rejects.toThrow("amount changed");
    expect(mock.query.mock.calls.some(call => call[0].op === "update")).toBe(false);
  });
  it("waits for an ACH payment to succeed rather than settling an unpaid completed checkout", async () => {
    const object = { id: "cs_test", payment_intent: "pi_test", metadata: metadata(), amount_total: 1150000, payment_status: "unpaid" };
    expect((await handler(WebhookRoute)({ request: eventRequest("checkout.session.completed", object) })).status).toBe(200);
    expect(mock.query).not.toHaveBeenCalled();
    const response = await handler(WebhookRoute)({ request: eventRequest("checkout.session.async_payment_succeeded", { ...object, payment_status: "paid" }) });
    expect(response.status).toBe(200);
    expect(charge.status).toBe("paid");
    expect(mock.sync).toHaveBeenCalledWith(invoiceId);
  });
});
