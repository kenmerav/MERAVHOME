/** The price denominator is deliberately independent of the quantity unit. */
export type ProductPriceUnit = "unit" | "sq_ft";

export function productPriceUnit(value: unknown): ProductPriceUnit | null {
  return value === "unit" || value === "sq_ft" ? value : null;
}

type PriceUnitContext = {
  price_unit?: unknown;
  price?: string | null;
  retail_price?: string | null;
  unit_cost?: string | null;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  product_url?: string | null;
};

/** Saved choices and price denominators outrank usual selling units. Coverage
 * and quantity units are intentionally excluded: neither identifies a price. */
export function inferProductPriceUnit(context: PriceUnitContext, { allowAreaDefault = true } = {}): ProductPriceUnit | null {
  const saved = productPriceUnit(context.price_unit);
  if (saved) return saved;
  const price = context.price?.trim() || context.retail_price?.trim() || context.unit_cost?.trim() || "";
  const denominator = /(?:\/|\bper\s+)\s*(sq\.?\s*ft\.?|square\s+(?:foot|feet)|sf\b|each\b|item\b|unit\b|sheet\b|piece\b|set\b|box\b|carton\b|case\b|roll\b|gallon\b|linear\s+(?:foot|feet)|lin\.?\s*ft\.?|sq\.?\s*yd\.?|square\s+yards?)/i.exec(price)?.[1];
  if (denominator) {
    if (/^(?:sq\.?\s*ft\.?|square\s+(?:foot|feet)|sf)$/i.test(denominator)) return "sq_ft";
    if (/^(?:each|item|unit|sheet|piece|set|box|carton|case|roll|gallon)$/i.test(denominator)) return "unit";
    return null; // Do not relabel linear-foot or square-yard prices as square feet.
  }
  let path = "";
  try { path = decodeURIComponent(new URL(context.product_url || "").pathname).replace(/[-_]/g, " "); }
  catch { /* Item metadata can still identify the usual selling unit. */ }
  const name = `${context.name || ""} ${context.subcategory || ""} ${path}`;
  if (/\b(?:interior|exterior) doors?\b|\bdoor slabs?\b/i.test(name)) return "unit";
  // Discrete products win over broad or misassigned categories (e.g. rugs in Flooring).
  if (/\b(?:faucets?|sinks?|toilets?|tubs?|shower\s*(?:heads?|systems?|trim)|valves?|drains?|pot fillers?|pendants?|sconces?|chandeliers?|lamps?|ceiling fans?|(?:ceiling|vanity|wall|pendant|recessed) lights?|light fixtures?|mirrors?|knobs?|pulls?|handles?|hooks?|hinges?|towel\s*(?:bars?|rings?|holders?)|(?:toilet paper|tp) holders?|dispensers?|vanit(?:y|ies)|refrigerators?|fridges?|dishwashers?|microwaves?|ranges?|ovens?|washers?|dryers?|sofas?|chairs?|benches?|desks?|tables?|beds?|ottomans?|rugs?|mats?|planters?|plants?|signage|water fountains?|roman clay|limewash|wallpaper|reformers?|pilates|yoga)\b/i.test(name)) return "unit";
  if (/\b(?:per|priced by|sold by|sold as)\s+(?:the\s+)?(?:box|case|carton|sheet|piece|set|roll)\b|\b(?:box|case|pack)\s+of\s+\d+/i.test(name)) return "unit";
  // Mosaics may be priced by sheet; trims by piece/linear foot; slabs by slab/area.
  if (/\b(?:mosaics?|slabs?|countertops?|tile trims?|bullnose|pencils?|liners?|baseboards?|mouldings?|moldings?)\b/i.test(name)) return null;
  if (/\b(?:tiles?|flooring|hardwood|engineered wood|vinyl plank|backsplash)\b/i.test(name)) return allowAreaDefault ? "sq_ft" : null;
  if (/\b(?:dumbbells?|weights?)\b/i.test(name)) return "unit";
  if (/^(?:Flooring|Tile|Tile & Stone)$/i.test(context.category || "")) return allowAreaDefault ? "sq_ft" : null;
  if (/^(?:Lighting|Plumbing|Hardware|Appliances|Furniture|Accent Mirrors|Workout Equipment|Signs|Styling|Accessories|Paint)$/i.test(context.category || "")) return "unit";
  return null;
}

export function materialPriceUnit(item: {
  item_label?: string | null;
  category?: string | null;
  product_url?: string | null;
  product?: PriceUnitContext | null;
}): ProductPriceUnit | null {
  return inferProductPriceUnit({
    ...item.product,
    name: `${item.item_label || ""} ${item.product?.name || ""}`,
    category: item.category || item.product?.category,
    product_url: item.product_url || item.product?.product_url,
  });
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
