import { parseMoney, type ProcurementSnapshot } from "@/lib/procurementCart";
import { type CartPricingSync, type verifiedProductPrices } from "@/lib/procurementPricing";
import { clientPriceFromMarkup, normalizeMoneyInput, type MarkupBasis } from "@/lib/money";

// Both product prices change in one update. A failed sync never reopens an Added
// item or loses its cart result; the recorded pricing evidence can be retried.
export async function syncCartProductPrices(
  admin: any,
  projectId: string,
  item: ProcurementSnapshot,
  prices: ReturnType<typeof verifiedProductPrices>,
  shipping?: number | null,
): Promise<CartPricingSync> {
  const result: CartPricingSync = {
    state: "needs_review",
    retail: prices.retail,
    cost: prices.cost,
    unit: prices.unit,
    verified_pricing: prices.pricing,
    message: "Pricing needs review. Do not add this item again.",
  };
  try {
    if (!item.product_id) throw new Error("This Spec Book item has no linked product.");
    const material = await admin
      .from("material_items")
      .select("id,product_id")
      .eq("id", item.spec_book_item_id)
      .eq("project_id", projectId)
      .eq("product_id", item.product_id)
      .maybeSingle();
    if (material.error || !material.data)
      throw new Error("The Spec Book product link changed; review prices manually.");
    const current = await admin
      .from("products")
      .select(
        "id,retail_price,price,unit_cost,markup_percent,markup_basis,shipping,sku,product_url",
      )
      .eq("id", item.product_id)
      .maybeSingle();
    if (current.error || !current.data)
      throw new Error("Could not read the linked product's current prices.");
    const product = current.data;
    if ((product.sku || "") !== (item.sku || "") || product.product_url !== item.product_url)
      throw new Error(
        "The product SKU or URL changed since this run was prepared; review prices manually.",
      );
    result.previous_retail = product.retail_price;
    result.previous_cost = product.unit_cost;
    const clientPrice = clientPriceFromMarkup({
      retailPrice: prices.retail,
      ourPrice: prices.cost,
      markupPercent: product.markup_percent,
      markupBasis: (product.markup_basis ?? "retail_price") as MarkupBasis,
    });
    const nextClientPrice =
      clientPrice == null ? null : normalizeMoneyInput(clientPrice.toFixed(2));
    if (
      parseMoney(product.retail_price) !== prices.retail ||
      parseMoney(product.unit_cost) !== prices.cost ||
      (nextClientPrice != null && parseMoney(product.price) !== clientPrice) ||
      (shipping != null && parseMoney(product.shipping) !== shipping)
    ) {
      const patch = {
        retail_price: normalizeMoneyInput(prices.retail.toString()),
        unit_cost: normalizeMoneyInput(prices.cost.toString()),
        ...(nextClientPrice != null ? { price: nextClientPrice } : {}),
        ...(shipping != null ? { shipping: shipping.toFixed(2) } : {}),
      };
      let update = admin.from("products").update(patch).eq("id", item.product_id);
      // Do not overwrite a concurrent manual edit to either price or product identity.
      for (const field of [
        "retail_price",
        "unit_cost",
        "markup_percent",
        "markup_basis",
        ...(nextClientPrice != null ? ["price"] : []),
        "sku",
        "product_url",
        ...(shipping != null ? ["shipping"] : []),
      ])
        update = product[field] == null ? update.is(field, null) : update.eq(field, product[field]);
      const saved = await update.select("id").maybeSingle();
      if (saved.error || !saved.data)
        throw new Error(
          "Prices were not saved, or the product changed while saving. Review the prices in Studio.",
        );
    }
    return {
      ...result,
      state: "synced",
      message:
        nextClientPrice == null
          ? "Retail and our prices are up to date. Set markup in Procurement to calculate client price."
          : "Retail price, our price, and calculated client price are up to date.",
    };
  } catch (error) {
    return {
      ...result,
      message: `${error instanceof Error ? error.message : "Price update failed."} The cart item remains Added; do not add it again.`,
    };
  }
}
