import { isKnownPrice, moneyValue, retailPriceOrClient } from "./money";
import { invoiceQuantityNumber, type SpecQuantityUnit } from "./specQuantity";
import type { ProductPriceUnit } from "./productPriceUnit";

export type DiscountInvoiceLine = {
  selected: boolean;
  quantity: string;
  quantityUnit: SpecQuantityUnit;
  unitPrice: string;
  retailUnitPrice: string;
  priceUnit: ProductPriceUnit | null;
};

export function productInvoiceDiscountLineIssues(line: DiscountInvoiceLine): string[] {
  if (!line.selected) return [];
  const issues: string[] = [];
  if (invoiceQuantityNumber(line.quantity) === null) issues.push("quantity needed");
  if (!isKnownPrice(line.unitPrice)) issues.push("client price needed");
  const retail = retailPriceOrClient(line.retailUnitPrice, line.unitPrice);
  if (line.retailUnitPrice.trim() && !isKnownPrice(retail)) issues.push("retail price needs correction");
  const unitsMatch = line.priceUnit === "sq_ft"
    ? line.quantityUnit === "square_feet"
    : line.priceUnit === "unit" && line.quantityUnit !== "square_feet";
  if (!unitsMatch) issues.push("price and quantity units need review");
  return issues;
}

export function productInvoiceDiscount(lines: readonly DiscountInvoiceLine[]) {
  let retail = 0;
  let discount = 0;
  let incomplete = 0;
  for (const line of lines) {
    if (!line.selected) continue;
    const qty = invoiceQuantityNumber(line.quantity);
    const retailValue = retailPriceOrClient(line.retailUnitPrice, line.unitPrice);
    if (qty === null || productInvoiceDiscountLineIssues(line).length) {
      incomplete++;
      continue;
    }
    const retailPrice = moneyValue(retailValue);
    retail += retailPrice * qty;
    discount += (retailPrice - moneyValue(line.unitPrice)) * qty;
  }
  return { retail, discount, incomplete };
}
