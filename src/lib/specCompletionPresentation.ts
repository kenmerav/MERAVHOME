import type { CompletionFinding } from "@/lib/specCompletion";
import type { SavedCompletionIssue } from "@/lib/savedSpecCompletion";
import type { MaterialItem } from "@/lib/db";

export function completionSolution(finding: CompletionFinding, item?: MaterialItem, suggestion?: SavedCompletionIssue["suggestion"]) {
  if (finding.finish_check) return finding.suggested
    ? `The product link identifies ${finding.suggested}. Confirm that selected variant and save its exact color / finish here. A genuine two-tone finish is allowed; do not save a list of alternatives.`
    : "Open the exact product link and confirm its selected color / finish. The page could not verify a selected variant, so this item needs review. Genuine two-tone finishes are allowed; a default swatch or list of available colors is not a confirmed selection.";
  if (finding.field === "grout") return "Confirm grout color and joint width for this exact tiled area. Check the linked construction callout or installation reference, then save both here. Existing selection notes are preserved.";
  if (finding.field === "tile_layout") return "Confirm the tile pattern and direction for this exact surface (for example, vertical straight set or horizontal running bond), or cite the approved installation reference. Save it here in the item's project notes.";
  if (suggestion?.kind === "color" && finding.field === "color" && suggestion.value.status === "suggested")
    return `The board image suggests ${suggestion.value.color}. Verify the exact manufacturer color, then enter it in Materials.`;
  if (suggestion?.kind === "dimensions" && finding.field === "dimensions" && suggestion.value.status === "suggested")
    return `Compare the product's size options with ${suggestion.value.dimensions}${suggestion.value.dimension_scope === "proposed_layout" ? " planned in the drawings" : " specified in the drawings"}, then confirm the matching variant in Materials.`;
  if (finding.source === "plans") {
    if (finding.field === "quantity") return `Confirm the count on the cited sheet, then change the quantity from ${finding.current || "unconfirmed"} to ${finding.suggested} in Materials.`;
    if (finding.field === "dimensions") return `Compare the selected product with ${finding.suggested}${finding.dimension_scope === "proposed_layout" ? " planned in the drawings" : " specified in the drawings"}. Confirm the matching size before updating Materials.`;
    if (finding.field === "missing_item") return `Add ${finding.suggested || finding.item_label} to this room in Materials, or choose Change not needed if it is outside your scope.`;
    return `Verify ${finding.suggested} against the cited specification and exact product, then update ${finding.field} in Materials.`;
  }
  switch (finding.field) {
    case "quantity": return "Confirm the count or scheduled area in the construction drawings, then enter the quantity in Materials.";
    case "color": case "finish": return "Check the selected color/finish on the product link and enter it in Materials. If it is unclear, request a suggestion from the linked Design Board image.";
    case "dimensions": {
      const choices = item?.product?.size_options?.slice(0, 6).join(" · ");
      return `Open the product link and confirm the intended size${choices ? ` (${choices})` : ""}. Use the construction drawings to confirm fit, then record the selected size or measurements in Materials.`;
    }
    case "price": return "Refresh the product from its link to retrieve the selected variant's price. If the retailer omits it, enter the current unit price or supplier quote in Materials.";
    case "price_unit": return "Check whether the listed price is per item or per square foot, then set the matching price basis in Materials.";
    case "product": return "Assign the exact catalog product to this material, or add it using its product link, so it appears in the Spec Book.";
    case "link": return "Copy the exact selected product's link from the Design Board or retailer into Materials.";
    default: return "Review this item in Materials and confirm the selection, or choose Change not needed.";
  }
}

export function completionProductLink(value: string | null | undefined) {
  try { const url = new URL(value || ""); return ["http:", "https:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function completionMaterialsLink(projectId: string, roomId: string, itemId?: string | null) {
  const base = `/projects/${encodeURIComponent(projectId)}/materials`;
  return itemId
    ? `${base}?itemId=${encodeURIComponent(itemId)}#materials-item-${encodeURIComponent(itemId)}`
    : `${base}?roomId=${encodeURIComponent(roomId)}#materials-room-${encodeURIComponent(roomId)}`;
}
