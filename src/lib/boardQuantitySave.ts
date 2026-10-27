import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { MaterialItem } from "./db";
import {
  specQuantityDatabasePatch,
  validateSpecQuantityPatch,
  type SpecQuantity,
} from "./specQuantity";
import {
  boardMaterialUpdatePatch,
  boardQuantitiesDiffer,
  boardQuantityReviewKey,
  quantityForReview,
  type BoardQuantityDecisions,
} from "./boardQuantityReview";

export async function readBoardSendMaterials(client: SupabaseClient<Database>, projectId: string) {
  const items: MaterialItem[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client
      .from("material_items")
      .select("*,product:products(*)")
      .eq("project_id", projectId)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    items.push(...((data || []) as unknown as MaterialItem[]));
    if (!data || data.length < 1000) return items;
  }
}

/** Read again after review; never replay an approval for a different saved or proposed quantity. */
export async function saveReviewedBoardMaterial(
  client: SupabaseClient<Database>,
  projectId: string,
  materialId: string,
  patch: Partial<MaterialItem>,
  proposed: SpecQuantity,
  decisions: BoardQuantityDecisions,
): Promise<MaterialItem> {
  const { data: current, error: readError } = await client
    .from("material_items")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", materialId)
    .single();
  if (readError) throw readError;
  if (!current?.updated_at)
    throw new Error("This material changed. Send the board again to review its current quantity.");
  // The domain type includes selection_quantity_unit, not yet included in the generated DB types.
  const material = current as unknown as MaterialItem;
  const key = boardQuantityReviewKey(materialId, material, proposed);
  const differs = boardQuantitiesDiffer(material, proposed);
  const priorReviewForItem = Object.keys(decisions).some((candidate) => {
    try {
      const identity = JSON.parse(candidate);
      return Array.isArray(identity) && identity[0] === materialId;
    } catch {
      return false;
    }
  });
  if ((differs || priorReviewForItem) && !decisions[key])
    throw new Error(
      "A Spec Book quantity changed since review. Send the board again to review the latest values.",
    );
  // Even when values match, omit quantity columns unless the user explicitly chose replacement.
  const decision = decisions[key];
  let replacement;
  if (decision === "board") replacement = validateSpecQuantityPatch(quantityForReview(proposed));
  else if (decision && typeof decision === "object" && decision.kind === "custom") {
    replacement = validateSpecQuantityPatch(decision.quantity);
    const saved = quantityForReview(material);
    if (
      replacement.quantity_unit !== saved.quantity_unit ||
      (replacement.waste_percent || 0) !== (saved.waste_percent || 0) ||
      (replacement.quantity === null && !replacement.quantity_tbd)
    )
      throw new Error(
        "The chosen quantity is invalid or its measurement changed. Review the item and send again.",
      );
  } else if (decision !== undefined && decision !== "keep") {
    throw new Error("The quantity choice is invalid. Review the item and send again.");
  }
  const safePatch = {
    ...boardMaterialUpdatePatch(patch, false),
    ...(replacement ? specQuantityDatabasePatch(replacement) : {}),
  };
  const update = async (values: Partial<MaterialItem>) =>
    client
      .from("material_items")
      .update(values as Database["public"]["Tables"]["material_items"]["Update"])
      .eq("project_id", projectId)
      .eq("id", materialId)
      .eq("updated_at", current.updated_at)
      .select("*")
      .maybeSingle();
  let result = await update(safePatch);
  if (
    result.error?.code === "42703" &&
    result.error.message?.includes("image_url") &&
    "image_url" in safePatch
  ) {
    const { image_url, ...legacy } = safePatch;
    result = await update(legacy);
  }
  if (result.error) throw result.error;
  if (!result.data)
    throw new Error(
      "This material changed while sending. Send the board again to review its latest quantity.",
    );
  return result.data as unknown as MaterialItem;
}
