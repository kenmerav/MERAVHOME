import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
import { db } from "@/lib/db";

const receipt = { id: "receipt", project_id: null, paid_amount: 123.45, balance_due: 0,
  raw_text: JSON.stringify({ type: "stripe_paid_receipt", version: 1, description: "Design delivery",
    stripe_payment_intent_id: "pi_verified", amount_cents: 12345, currency: "usd" }) };
const queries: any[] = [];
function result(data: any, error: any = null) {
  const chain: any = { then: (resolve: any) => Promise.resolve({ data, error }).then(resolve) };
  for (const method of ["select", "update", "eq", "is", "single"]) chain[method] = vi.fn(() => chain);
  queries.push(chain);
  mocks.from.mockReturnValueOnce(chain);
  return chain;
}
beforeEach(() => {
  mocks.from.mockReset(); queries.length = 0;
  vi.spyOn(db, "getCurrentUserProfile").mockResolvedValue({ email: "ken@meravinteriors.com", is_active: true } as any);
});
afterEach(() => vi.restoreAllMocks());

it("denies assignment before querying financial records for an unauthorized user", async () => {
  vi.mocked(db.getCurrentUserProfile).mockResolvedValue({ email: "client@example.com", is_active: true } as any);
  await expect(db.assignPaidStripeReceipt("receipt", "project")).rejects.toThrow("Only Ken and Katie");
  expect(mocks.from).not.toHaveBeenCalled();
});
it.each([{ ...receipt, project_id: "already-assigned" }, { ...receipt, paid_amount: 100 }, { ...receipt, raw_text: "ordinary invoice" }])(
  "rejects already assigned or unverified invoices without changing them", async (invoice) => {
    result(invoice);
    await expect(db.assignPaidStripeReceipt("receipt", "project")).rejects.toThrow("already been assigned or needs review");
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(queries[0].update).not.toHaveBeenCalled();
  });
it("assigns both records while preserving internal visibility and all payment details", async () => {
  result(receipt); result({ id: "project" });
  const invoice = result({ id: "receipt" }); const payment = result([{ id: "paid-line" }]);
  await db.assignPaidStripeReceipt("receipt", "project");
  expect(invoice.update).toHaveBeenCalledWith({ project_id: "project", client_visible: false });
  expect(invoice.is).toHaveBeenCalledWith("project_id", null);
  expect(payment.update).toHaveBeenCalledWith({ project_id: "project" });
  expect(payment.eq).toHaveBeenCalledWith("invoice_id", "receipt");
});
it.each(["error", "missing"])("restores the unassigned invoice when its payment update is %s", async (failure) => {
  result(receipt); result({ id: "project" }); result({ id: "receipt" });
  result(failure === "error" ? null : [], failure === "error" ? { message: "denied" } : null);
  const rollback = result(null);
  await expect(db.assignPaidStripeReceipt("receipt", "project")).rejects.toThrow("Could not assign");
  expect(rollback.update).toHaveBeenCalledWith({ project_id: null, client_visible: false });
  expect(rollback.eq).toHaveBeenCalledWith("project_id", "project");
});
it("stops before moving payment records if another session assigned the receipt", async () => {
  result(receipt); result({ id: "project" }); result(null, { message: "no row" });
  await expect(db.assignPaidStripeReceipt("receipt", "project")).rejects.toThrow("receipt changed");
  expect(mocks.from).toHaveBeenCalledTimes(3);
});
