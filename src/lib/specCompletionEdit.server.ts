import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { completionDetailValue } from "@/lib/specCompletionDetail";
import { normalizeItemCategory, toProductCategory } from "@/lib/roomTemplates";
import { CATALOG_NAME_PENDING_NOTE } from "@/lib/catalogProductName";
import { readSavedCompletionReview, setCompletionIssueStatus, CompletionReviewConflict } from "@/lib/savedSpecCompletion.server";

const admin = supabaseAdmin as any;
export class CompletionDetailInputError extends Error {}

// Called only after the completion endpoint authorizes active staff and project
// access. Item IDs and writable fields come from the saved issue, not the caller.
export async function saveCompletionDetailForStaff(projectId: string, userId: string, body: any) {
  const { data: saved, error: reviewError } = await admin.from("spec_completion_reviews").select("report,issues")
    .eq("project_id", projectId).maybeSingle();
  if (reviewError) throw reviewError;
  const issue = saved?.issues?.[body.issue_key];
  if (!issue || issue.status !== "open" || issue.status_updated_at !== body.expected_updated_at ||
    !issue.finding.item_id || !["color", "finish", "price", "price_unit"].includes(issue.finding.field))
    throw new CompletionReviewConflict("This issue changed or cannot be edited here. Reopen the saved review.");
  if (saved.report?.plan_status === "checking") throw new CompletionReviewConflict("Wait for the plan check to finish before changing selections.");
  let patch: ReturnType<typeof completionDetailValue>;
  try { patch = completionDetailValue(issue.finding.field, { value: body.value, priceUnit: body.price_unit }); }
  catch (error) { throw new CompletionDetailInputError((error as Error).message); }
  const { data: item, error: itemError } = await admin.from("material_items").select("*,product:products(*)")
    .eq("id", issue.finding.item_id).eq("project_id", projectId).maybeSingle();
  if (itemError) throw itemError;
  if (!item || item.not_needed || item.room_id !== issue.finding.room_id || item.updated_at !== body.expected_material_updated_at ||
    item.product_id !== body.expected_product_id ||
    (item.product?.updated_at ?? null) !== body.expected_product_updated_at ||
    (issue.item_preview?.product_id && issue.item_preview.product_id !== item.product_id))
    throw new CompletionReviewConflict("This selection changed. Refresh the review before saving.");
  const { data: room, error: roomError } = await admin.from("rooms").select("id").eq("id", item.room_id).eq("project_id", projectId).maybeSingle();
  if (roomError) throw roomError;
  if (!room) throw new CompletionReviewConflict("This room is no longer in the project.");
  if (!("color" in patch) && item.product?.markup_percent != null)
    throw new CompletionDetailInputError("This price uses markup. Edit its pricing settings in Materials to preserve the calculation.");
  let written = false;
  try {
    if ("color" in patch) {
      let query = admin.from("material_items").update({ color: patch.color }).eq("id", item.id).eq("project_id", projectId)
        .eq("room_id", item.room_id).eq("updated_at", item.updated_at);
      query = item.product_id ? query.eq("product_id", item.product_id) : query.is("product_id", null);
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new CompletionReviewConflict("This material changed. Refresh the review before saving.");
      written = true;
    } else {
      let productId = item.product_id;
      if (productId) {
        const { data, error } = await admin.from("products").update(patch).eq("id", productId)
          .eq("updated_at", item.product.updated_at).select("id").maybeSingle();
        if (error) throw error;
        if (!data) throw new CompletionReviewConflict("The product details changed. Refresh the review before saving.");
        written = true;
      } else {
        const normalized = normalizeItemCategory(item.category) ?? "Other";
        const category = toProductCategory(normalized);
        const { data: product, error } = await admin.from("products").insert({ name: item.item_label || "Untitled product", category,
          subcategory: category === "Decor" || category === "Hardware" ? normalized : normalized === "Tile & Stone" ? "Tile" : null,
          product_url: item.product_url, image_url: item.image_url, finish: item.color, notes: CATALOG_NAME_PENDING_NOTE, ...patch }).select("id").single();
        if (error || !product) throw error || new Error("Could not create product");
        const { data: linked, error: linkError } = await admin.from("material_items").update({ product_id: product.id })
          .eq("id", item.id).eq("project_id", projectId).eq("room_id", item.room_id).eq("updated_at", item.updated_at)
          .is("product_id", null).select("id").maybeSingle();
        if (linkError) throw linkError;
        if (!linked) throw new CompletionReviewConflict("Product details were saved to the catalog, but this selection changed before linking. Reopen the review.");
        productId = product.id; written = true;
      }
      const { data: links, error: linksError } = await admin.from("room_products").select("id")
        .eq("room_id", item.room_id).eq("product_id", productId).limit(1);
      if (linksError) throw linksError;
      if (!links?.length) {
        const { error } = await admin.from("room_products").insert({ room_id: item.room_id, product_id: productId, is_key_selection: false });
        if (error) throw error;
      }
    }
    await setCompletionIssueStatus(projectId, userId, body.issue_key, "completed", body.expected_updated_at);
    const { data: updated, error } = await admin.from("material_items").select("*,product:products(*)")
      .eq("id", item.id).eq("project_id", projectId).single();
    if (error || !updated) throw error || new Error("Could not refresh detail");
    return { item: updated, review: await readSavedCompletionReview(projectId) };
  } catch (error) {
    if (written) throw new CompletionReviewConflict("The detail was saved, but the review could not be confirmed. Reopen the saved review to check its status.");
    throw error;
  }
}
