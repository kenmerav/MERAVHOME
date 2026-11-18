import { describe, expect, it } from "vitest";
import { parseInvoiceCost, productInvoiceProfit } from "../src/lib/productInvoiceProfit";

const invoice = {
  subtotal: 520,
  shipping: 40,
  fees: [
    { key: "0", name: "Receiving", amount: 75 },
    { key: "1", name: "Installation", amount: 165 },
  ],
  lines: [
    { quantity: "2", unitCost: "$149.99" },
    { quantity: 2.5, unitCost: "$10/sq ft" },
  ],
};

describe("saved procurement invoice profit", () => {
  it("subtracts product, shipping and fee costs from pre-tax client charges", () => {
    const profit = productInvoiceProfit({
      ...invoice,
      costs: { shipping_cost: 43.2, fee_costs: { "0": 30, "1": 190 } },
    });
    expect(profit).toMatchObject({
      clientCharges: 800,
      productCost: 324.98,
      shippingCost: 43.2,
      feeCost: 220,
      totalCost: 588.18,
      grossProfit: 211.82,
    });
  });

  it("reports incomplete profit until each actual cost is known, including any no-cost fee", () => {
    const costs = { shipping_cost: null, fee_costs: { "1": 0 } };
    expect(productInvoiceProfit({ ...invoice, shipping: 0, costs })).toMatchObject({
      grossProfit: null,
      missingFees: 1,
    });
    expect(
      productInvoiceProfit({
        ...invoice,
        costs: { shipping_cost: 0, fee_costs: { "0": 0, "1": 0 } },
      }).grossProfit,
    ).toBe(475.02);
  });

  it("keeps missing historic costs and quantities incomplete while allowing a real zero cost", () => {
    const costs = { shipping_cost: 0, fee_costs: {} };
    expect(
      productInvoiceProfit({
        ...invoice,
        fees: [],
        lines: [
          { quantity: "1", unitCost: "" },
          { quantity: "TBD", unitCost: 5 },
        ],
        costs,
      }),
    ).toMatchObject({ missingProducts: 2, grossProfit: null });
    expect(
      productInvoiceProfit({
        ...invoice,
        fees: [],
        lines: [{ quantity: "1", unitCost: "$0.00" }],
        costs,
      }),
    ).toMatchObject({ productCost: 0, grossProfit: 560 });
  });

  it("shows a loss when expenses exceed client charges", () => {
    expect(
      productInvoiceProfit({
        ...invoice,
        costs: { shipping_cost: 250, fee_costs: { "0": 65, "1": 250 } },
      }).grossProfit,
    ).toBe(-89.98);
  });
});

describe("internal cost entry", () => {
  it("treats blank, zero and currency-formatted amounts distinctly", () => {
    expect(parseInvoiceCost(" ")).toBeNull();
    expect(parseInvoiceCost("0")).toBe(0);
    expect(parseInvoiceCost("$1,234.50")).toBe(1234.5);
  });

  it("rejects invalid, negative, over-precision and out-of-range costs", () => {
    for (const input of ["-5", "TBD", "12.999", "1,2", "10000000000", "9".repeat(500)]) {
      expect(() => parseInvoiceCost(input)).toThrow("Enter a nonnegative dollar amount");
    }
  });
});
