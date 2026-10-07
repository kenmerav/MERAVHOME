import type { Product } from "@/lib/db";
import { clientPriceFromMarkup, normalizeMoneyInput, type MarkupBasis } from "@/lib/money";

export type ProductPricingDraft = {
  price: string;
  retail_price: string;
  unit_cost: string;
  markup_percent: string;
  markup_basis: MarkupBasis;
  shipping: string;
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
  const patch: Partial<Product> = {
    retail_price: retail,
    unit_cost: cost,
    price: calculated == null ? manualPrice : normalizeMoneyInput(calculated.toFixed(2)),
    shipping,
    markup_percent: markup,
    markup_basis: values.markup_basis,
  };
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
  const formulaChanged = ["retail_price", "unit_cost", "markup_percent", "markup_basis"].some(
    (key) => values[key as keyof ProductPricingDraft] !== initial[key as keyof ProductPricingDraft],
  );
  if (
    values.price !== initial.price ||
    (formulaChanged && patch.price !== money(initial.price, "price"))
  )
    changed.price = patch.price;
  if (values.markup_percent !== initial.markup_percent && markup != null)
    changed.markup_basis = values.markup_basis;
  return changed;
}
