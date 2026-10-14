import { supabase } from "@/integrations/supabase/client";
import { refreshMaterialProductInfo } from "@/lib/materialProductRefresh";
import { hasCompletionValue, needsCompletionColor, needsCompletionPrice } from "@/lib/specCompletion";
import type { MaterialItem, Product } from "@/lib/db";
import { materialVisibleInProcurement } from "@/lib/materialSelection";
import { toProductCategory } from "@/lib/roomTemplates";

type CatalogProductInfo = Pick<Product, "name" | "category" | "product_url" | "price" | "finish" | "dimensions" | "image_url"> & Partial<Pick<Product, "selected_size">>;
export function missingCatalogProductInfo(product: CatalogProductInfo, material: Partial<MaterialItem> = {}) {
  const item = { item_label: product.name, category: product.category, ...material, product } as MaterialItem;
  const color = hasCompletionValue(material.color) ? material.color : product.finish;
  return [
    !hasCompletionValue(product.image_url) ? "image" : null,
    needsCompletionPrice(item) ? "price" : null,
    !hasCompletionValue(product.dimensions) && !hasCompletionValue(product.selected_size) ? "dimensions" : null,
    needsCompletionColor({ ...item, color: null, product: { ...product, finish: color } as Product }) ? "color" : null,
  ].filter((field): field is string => !!field);
}

export function missingMaterialProductInfo(items: MaterialItem[]) {
  return items.filter(materialVisibleInProcurement).flatMap(item => {
    const product = item.product || { name: item.item_label, category: toProductCategory(item.category), product_url: item.product_url,
      image_url: null, price: null, dimensions: null, finish: null };
    const missing = missingCatalogProductInfo(product, item);
    if (!missing.length) return [];
    let hasLink = false;
    try { const url = new URL(item.product_url || ""); hasLink = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
    catch { /* Keep missing items without a source in the review. */ }
    return [{ item, missing, hasLink }];
  });
}

// Run after the catalog choice has been saved. A retailer failure must never
// undo that selection or create another Materials row.
export async function refreshCatalogSelectionIfNeeded({ projectId, itemId, product, material, onProgress }: {
  projectId: string; itemId: string; product: CatalogProductInfo; material?: Partial<MaterialItem>;
  onProgress?: (message: string) => void;
}): Promise<string | null> {
  const missing = missingCatalogProductInfo(product, material);
  if (!missing.length) return null;
  try {
    const url = new URL(product.product_url || "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { return "Catalog selection saved. Add a product link to fill its missing details automatically."; }
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new Error();
    const summary = await refreshMaterialProductInfo(projectId, [itemId], { authorization: `Bearer ${data.session.access_token}`, force: true,
      onProgress: message => onProgress?.(message.startsWith("Saving") ? "Saving product details…" : "Getting missing image, price, dimensions and color…") });
    if (summary.failed || !summary.saved) return "Catalog selection saved. The retailer could not be read; fill the remaining details manually or retry Scrape Product Info.";
    return summary.priceMissing && missing.includes("price") ? "Catalog selection and available details saved. A reliable price was not available from the retailer." : null;
  } catch { return "Catalog selection saved. Product details could not be confirmed; retry Scrape Product Info."; }
}
