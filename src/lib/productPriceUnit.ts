/** The price denominator is deliberately independent of the quantity unit. */
export type ProductPriceUnit = "unit" | "sq_ft";

export function productPriceUnit(value: unknown): ProductPriceUnit | null {
  return value === "unit" || value === "sq_ft" ? value : null;
}

export function productPriceUnitLabel(value: unknown): string {
  const unit = productPriceUnit(value);
  return unit === "sq_ft" ? "Per sq ft" : unit === "unit" ? "Per unit" : "Price basis not set";
}

export function formatPriceWithUnit(
  amount: string | null | undefined,
  value: unknown,
): string | null {
  const price = amount?.trim();
  if (!price) return null;
  const unit = productPriceUnit(value);
  if (unit === "sq_ft") return `${price} / sq ft`;
  if (unit === "unit") return `${price} / unit`;
  // Do not silently label legacy tile, carton, sheet, or area prices as each.
  return `${price} (price basis not set)`;
}
