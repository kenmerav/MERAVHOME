import type { Product } from "@/lib/db";
import { clientPriceFromMarkup, normalizeMoneyInput, type MarkupBasis } from "@/lib/money";
import { productPriceUnit, type ProductPriceUnit } from "@/lib/productPriceUnit";

export type ProductPricingDraft = {
  price: string;
  retail_price: string;
  unit_cost: string;
  markup_percent: string;
  markup_basis: MarkupBasis;
  shipping: string;
  // Optional so existing catalog/procurement callers preserve an already-set basis.
  price_unit?: ProductPriceUnit | "";
};

export function productPricingPatch(
  values: ProductPricingDraft,
  initial?: ProductPricingDraft,
): Partial<Product> {
  const money = (raw: string, label: string) => {
    const cleaned = raw.trim().replace(/[$,\s]/g, "");
    if (!cleaned) return null;
    if (!/^\d+(\.\d+)?$/.test(cleaned) && !/^\.\d+$/.test(cleaned))
      throw new Error(`Enter a valid ${label}.`);
    const value = Number(cleaned);
    if (!Number.isFinite(value)) throw new Error(`Enter a valid ${label}.`);
    return normalizeMoneyInput(value.toFixed(2));
  };
  const retail = money(values.retail_price, "retail price");
  const cost = money(values.unit_cost, "cost");
  const manualPrice = money(values.price, "price");
  const shipping = money(values.shipping, "shipping amount");
  const markup = values.markup_percent.trim() ? Number(values.markup_percent) : null;
  if (markup != null && (!Number.isFinite(markup) || markup < -100))
    throw new Error("Enter a valid markup percentage.");
  const calculated = clientPriceFromMarkup({
    retailPrice: retail,
    ourPrice: cost,
    markupPercent: markup,
    markupBasis: values.markup_basis,
  });
  if (markup != null && calculated == null)
    throw new Error(
      "Enter the price that the markup is based on, or clear the markup to enter a price directly.",
    );

  // Retail-only entry is a published price, not an internal cost. Fill a NEW
  // blank display price from it, without replacing an existing manual price,
  // changing a markup, or undoing an intentional clear of the display price.
  const manuallyCleared = Boolean(initial?.price.trim()) && !values.price.trim();
  const useRetail = calculated == null && manualPrice == null && retail != null && !manuallyCleared;
  const patch: Partial<Product> = {
    retail_price: retail,
    unit_cost: cost,
    price: calculated == null
      ? (manualPrice ?? (useRetail ? retail : null))
      : normalizeMoneyInput(calculated.toFixed(2)),
    shipping,
    markup_percent: markup,
    markup_basis: values.markup_basis,
  };

  if (values.price_unit !== undefined) {
    const unit = productPriceUnit(values.price_unit);
    if (values.price_unit !== "" && unit == null)
      throw new Error("Choose per unit or per square foot.");
    patch.price_unit = unit;
  }
  if (!initial) return patch;

  const changed: Partial<Product> = {};
  for (const key of [
    "retail_price",
    "unit_cost",
    "markup_percent",
    "markup_basis",
    "shipping",
  ] as const) {
    if (values[key] !== initial[key]) (changed as Record<string, unknown>)[key] = patch[key];
  }
  if (values.price_unit !== undefined && values.price_unit !== initial.price_unit)
    changed.price_unit = patch.price_unit;

  const formulaChanged = ["retail_price", "unit_cost", "markup_percent", "markup_basis"].some(
    (key) => values[key as keyof ProductPricingDraft] !== initial[key as keyof ProductPricingDraft],
  );
  const fillNewDisplayPrice = useRetail && !initial.price.trim() && (
    values.retail_price !== initial.retail_price ||
    (values.price_unit !== undefined && values.price_unit !== initial.price_unit)
  );
  if (
    values.price !== initial.price ||
    fillNewDisplayPrice ||
    (formulaChanged && patch.price !== money(initial.price, "price"))
  )
    changed.price = patch.price;
  if (values.markup_percent !== initial.markup_percent && markup != null)
    changed.markup_basis = values.markup_basis;
  return changed;
}
