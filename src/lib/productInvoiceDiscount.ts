import { isKnownPrice, moneyValue } from "./money";
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

export function productInvoiceDiscount(lines: readonly DiscountInvoiceLine[]) {
  let retail = 0;
  let discount = 0;
  let incomplete = 0;
  for (const line of lines) {
    if (!line.selected) continue;
    const qty = invoiceQuantityNumber(line.quantity);
    const unitsMatch = line.priceUnit === "sq_ft"
      ? line.quantityUnit === "square_feet"
      : line.priceUnit === "unit" && line.quantityUnit !== "square_feet";
    if (qty === null || !unitsMatch || !isKnownPrice(line.retailUnitPrice) || !isKnownPrice(line.unitPrice)) {
      incomplete++;
      continue;
    }
    const retailPrice = moneyValue(line.retailUnitPrice);
    retail += retailPrice * qty;
    discount += (retailPrice - moneyValue(line.unitPrice)) * qty;
  }
  return { retail, discount, incomplete };
}
