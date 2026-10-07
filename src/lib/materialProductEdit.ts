import { supabase } from "@/integrations/supabase/client";
import { db, type Product } from "@/lib/db";
import { CATALOG_NAME_PENDING_NOTE } from "@/lib/catalogProductName";
import { normalizeItemCategory, toProductCategory } from "@/lib/roomTemplates";

// Read the current link before every save; a stale view must not create a second
// selection or overwrite another user's newer material-to-product connection.
export async function saveMaterialProductDetails(materialId: string, patch: Partial<Product>) {
  const { data: material, error } = await supabase
    .from("material_items")
    .select(
      "id, project_id, room_id, product_id, item_label, category, product_url, color, image_url",
    )
    .eq("id", materialId)
    .single();
  if (error) throw error;
  if (!material) throw new Error("Could not find this material item.");

  let productId = material.product_id as string | null;
  if (!productId) {
    const normalized = normalizeItemCategory(material.category) ?? "Other";
    const category = toProductCategory(normalized);
    const product = await db.createProduct({
      name: material.item_label || "Untitled product",
      category,
      subcategory:
        category === "Decor" || category === "Hardware"
          ? normalized
          : normalized === "Tile & Stone"
            ? "Tile"
            : null,
      product_url: material.product_url,
      finish: material.color,
      image_url: material.image_url,
      notes: CATALOG_NAME_PENDING_NOTE,
      ...patch,
    });
    if (!product) throw new Error("Could not save the product details. Please try again.");
    const { data: linked, error: linkError } = await supabase
      .from("material_items")
      .update({ product_id: product.id })
      .eq("id", materialId)
      .is("product_id", null)
      .select("product_id")
      .maybeSingle();
    if (linkError) throw linkError;
    if (linked) {
      productId = linked.product_id;
    } else {
      const { data: current, error: currentError } = await supabase
        .from("material_items")
        .select("product_id")
        .eq("id", materialId)
        .single();
      if (currentError) throw currentError;
      productId = current?.product_id;
      if (!productId) throw new Error("This item changed while saving. Please try again.");
      if (!(await db.updateProduct(productId, patch)))
        throw new Error("Could not save the product details.");
    }
  } else {
    if (!(await db.updateProduct(productId, patch)))
      throw new Error("Could not save the product details.");
  }
  // Keep room selections available to existing spec/approval flows. Never touch
  // existing quantities, procurement IDs, invoice IDs, or board source fields.
  const roomProducts = await db.listRoomProducts(material.room_id);
  if (!roomProducts?.some((entry) => entry.product_id === productId)) {
    if (
      !(await db.addRoomProduct({
        room_id: material.room_id,
        product_id: productId!,
        is_key_selection: false,
      }))
    )
      throw new Error("Product details saved, but the room link could not be saved. Please retry.");
  }
  return productId!;
}
