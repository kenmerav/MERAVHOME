import { describe, expect, it } from "vitest";
import { financialInvoiceLedger } from "../src/lib/financialInvoiceLedger";

describe("financialInvoiceLedger", () => {
  it("shows an open credit when a paid item is removed", () => {
    const ledger = financialInvoiceLedger({
      payments: [{ amount: 100, status: "paid" }],
      adjustments: [
        { adjustment_type: "credit", amount: 100, status: "open" },
      ],
    });

    expect(ledger.adjustedTotal).toBe(0);
    expect(ledger.balanceDue).toBe(0);
    expect(ledger.creditOwed).toBe(100);
  });

  it("shows only the price difference for a lower-cost replacement", () => {
    const ledger = financialInvoiceLedger({
      payments: [{ amount: 100, status: "paid" }],
      adjustments: [
        { adjustment_type: "credit", amount: 20, status: "open" },
      ],
    });

    expect(ledger.adjustedTotal).toBe(80);
    expect(ledger.creditOwed).toBe(20);
  });

  it("shows an additional amount due for a higher-cost replacement", () => {
    const ledger = financialInvoiceLedger({
      payments: [{ amount: 100, status: "paid" }],
      adjustments: [
        { adjustment_type: "charge", amount: 20, status: "open" },
      ],
    });

    expect(ledger.adjustedTotal).toBe(120);
    expect(ledger.balanceDue).toBe(20);
    expect(ledger.creditOwed).toBe(0);
  });

  it("clears a client credit after it is refunded", () => {
    const ledger = financialInvoiceLedger({
      payments: [{ amount: 100, status: "paid" }],
      adjustments: [
        { adjustment_type: "credit", amount: 100, status: "refunded" },
      ],
    });

    expect(ledger.refundedTotal).toBe(100);
    expect(ledger.netPaid).toBe(0);
    expect(ledger.creditOwed).toBe(0);
  });
});
