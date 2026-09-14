import { parseMoney, type ProcurementSnapshot } from "@/lib/procurementCart";
import { type CartPricingSync, type verifiedProductPrices } from "@/lib/procurementPricing";

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
      .select("id,price,unit_cost,shipping,sku,product_url")
      .eq("id", item.product_id)
      .maybeSingle();
    if (current.error || !current.data)
      throw new Error("Could not read the linked product's current prices.");
    const product = current.data;
    if ((product.sku || "") !== (item.sku || "") || product.product_url !== item.product_url)
      throw new Error(
        "The product SKU or URL changed since this run was prepared; review prices manually.",
      );
    result.previous_retail = product.price;
    result.previous_cost = product.unit_cost;
    if (
      parseMoney(product.price) !== prices.retail ||
      parseMoney(product.unit_cost) !== prices.cost ||
      (shipping != null && parseMoney(product.shipping) !== shipping)
    ) {
      let update = admin
        .from("products")
        .update({
          price: `$${prices.retail}`,
          unit_cost: `$${prices.cost}`,
          ...(shipping != null ? { shipping: shipping.toFixed(2) } : {}),
        })
        .eq("id", item.product_id);
      // Do not overwrite a concurrent manual edit to either price or product identity.
      for (const field of [
        "price",
        "unit_cost",
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
      message: "Client retail price and Studio cart cost are up to date.",
    };
  } catch (error) {
    return {
      ...result,
      message: `${error instanceof Error ? error.message : "Price update failed."} The cart item remains Added; do not add it again.`,
    };
  }
}
