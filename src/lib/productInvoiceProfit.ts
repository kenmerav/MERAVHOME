import { isKnownPrice, moneyValue } from "./money";
import { invoiceQuantityNumber } from "./specQuantity";

export type ProductInvoiceCostLine = {
  quantity?: unknown;
  unitCost?: unknown;
};

export type ProductInvoiceFee = {
  key: string;
  name: string;
  amount: number;
};

export type ProductInvoiceInternalCosts = {
  shipping_cost: number | null;
  fee_costs: Record<string, number>;
};

export function parseInvoiceCost(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  const cost = Number(value.replace(/[$,\s]/g, ""));
  const valid = /^\$?\s*(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?|\.\d{1,2})$/.test(value);
  if (!valid || cost > 9999999999.99) {
    throw new Error("Enter a nonnegative dollar amount with up to two decimal places.");
  }
  return cost;
}

export function productInvoiceProfit({
  subtotal,
  shipping,
  fees,
  lines,
  costs,
}: {
  subtotal?: number;
  shipping?: number;
  fees: ProductInvoiceFee[];
  lines: ProductInvoiceCostLine[];
  costs: ProductInvoiceInternalCosts | null;
}) {
  let productCostTotal = 0;
  let missingProducts = 0;
  for (const line of lines) {
    const quantity =
      typeof line.quantity === "string" || typeof line.quantity === "number"
        ? invoiceQuantityNumber(String(line.quantity))
        : null;
    if (quantity === null || !isKnownPrice(line.unitCost)) {
      missingProducts++;
      continue;
    }
    productCostTotal += moneyValue(line.unitCost as string | number) * quantity;
  }
  const shippingCost = costs?.shipping_cost ?? null;
  let feeCostTotal = 0;
  let missingFees = 0;
  for (const fee of fees) {
    const cost = costs?.fee_costs[fee.key];
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
      feeCostTotal += cost;
    } else {
      missingFees++;
    }
  }
  const productCost = lines.length > 0 && missingProducts === 0 ? productCostTotal : null;
  const clientCharges =
    subtotal !== undefined && shipping !== undefined
      ? subtotal + shipping + fees.reduce((sum, fee) => sum + fee.amount, 0)
      : null;
  const totalCost =
    productCost !== null && shippingCost !== null && missingFees === 0
      ? productCost + shippingCost + feeCostTotal
      : null;
  const roundMoney = (amount: number) => Math.round(amount * 100) / 100;
  return {
    clientCharges: clientCharges === null ? null : roundMoney(clientCharges),
    productCost: productCost === null ? null : roundMoney(productCost),
    shippingCost,
    feeCost: missingFees === 0 ? roundMoney(feeCostTotal) : null,
    totalCost: totalCost === null ? null : roundMoney(totalCost),
    grossProfit:
      clientCharges === null || totalCost === null ? null : roundMoney(clientCharges - totalCost),
    missingProducts,
    missingFees,
  };
}
