import type { MaterialItem, Product } from "@/lib/db";

/** Use only AFTER reading the successfully saved product back from Supabase. */
export function withSavedMaterialProduct(
  items: MaterialItem[] | undefined,
  materialId: string,
  product: Product,
): MaterialItem[] | undefined {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (item.id !== materialId && item.product_id !== product.id) return item;
    return {
      ...item,
      product_id: product.id,
      product,
      room_product: item.room_product?.product_id === product.id
        ? { ...item.room_product, product }
        : item.room_product?.product_id && item.room_product.product_id !== product.id
          ? null
          : item.room_product,
    };
  });
}
