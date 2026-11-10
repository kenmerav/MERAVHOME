import type { MaterialItem } from "./db";
import {
  formatSpecQuantity,
  specQuantityUnitLabel,
  specQuantityUnit,
  type SpecQuantity,
  type SpecQuantityPatch,
} from "./specQuantity";

export function boardQuantityDescription(value: SpecQuantity) {
  const quantity = formatSpecQuantity(value) || "Blank";
  return `${quantity}${specQuantityUnit(value) === "count" ? ` ${specQuantityUnitLabel("count")}` : ""}${value.waste_percent ? ` + ${value.waste_percent}% waste` : ""}`;
}

export type BoardMaterialTarget = {
  roomId: string;
  boardElementId?: string;
  materialItemId?: string | null;
  label: string;
  productUrl?: string | null;
  color?: string | null;
  dimensions?: string | null;
  materialLinkCleared?: boolean;
};
const text = (value?: string | null) => (value || "").trim().replace(/\s+/g, " ").toLowerCase();
const url = (value?: string | null) => (value || "").trim().replace(/\/+$/, "").toLowerCase();
const meaningfulProductName = (value?: string | null) =>
  value?.trim() && !/^(?:unlabeled|unnamed|untitled)(?: item| product)?$/i.test(value.trim())
    ? value.trim()
    : null;
export function findBoardMaterialForSend(target: BoardMaterialTarget, items: MaterialItem[]) {
  // The caller reads only this project's materials. Match the stable source before
  // mutable display details, just as the database duplicate guard does.
  const active = items.filter((item) => !item.not_needed);
  const matches = (item: MaterialItem, ignoreUrl = false) =>
    item.room_id === target.roomId &&
    text(item.item_label) === text(target.label) &&
    (ignoreUrl || url(item.product_url) === url(target.productUrl)) &&
    text(item.color) === text(target.color) &&
    text(item.product?.dimensions) === text(target.dimensions);
  const linked = active.find((item) => item.id === target.materialItemId);
  if (target.boardElementId) {
    const sourced = active.filter((item) => item.source_board_element_id === target.boardElementId);
    if (linked && sourced.includes(linked)) return linked;
    if (sourced.length === 1) return sourced[0];
    if (sourced.length > 1) {
      const matching = sourced.filter((item) => matches(item));
      if (matching.length === 1) return matching[0];
      throw new Error(`More than one saved material is linked to "${target.label}". Review the duplicates in Materials before sending this item.`);
    }
  }
  return linked && (matches(linked) || (target.materialLinkCleared && matches(linked, true)))
    ? linked
    : active.find((item) => matches(item)) || null;
}
export function quantityForReview(value: SpecQuantity): SpecQuantityPatch {
  return {
    quantity: value.quantity_tbd ? null : value.quantity,
    quantity_tbd: value.quantity_tbd === true,
    quantity_unit: specQuantityUnit(value),
    waste_percent: value.waste_percent || 0,
  };
}
export function boardQuantitiesDiffer(spec: SpecQuantity, board: SpecQuantity) {
  return JSON.stringify(quantityForReview(spec)) !== JSON.stringify(quantityForReview(board));
}
export function boardQuantityReviewKey(
  materialId: string,
  spec: SpecQuantity,
  board: SpecQuantity,
) {
  return JSON.stringify([materialId, quantityForReview(spec), quantityForReview(board)]);
}
export type BoardQuantityConflict = {
  key: string;
  materialId: string;
  roomId: string;
  itemLabel: string;
  roomName: string;
  spec: SpecQuantityPatch;
  board: SpecQuantityPatch;
  imageUrl?: string | null;
  productName?: string | null;
  productUrl?: string | null;
  boardPageId?: string;
  boardElementId?: string;
};
export type BoardQuantityDecision =
  "keep" | "board" | { kind: "custom"; quantity: SpecQuantityPatch };
export type BoardQuantityDecisions = Record<string, BoardQuantityDecision>;
export function boardQuantityConflict(
  item: MaterialItem,
  board: SpecQuantity,
  roomName: string,
  context?: Pick<
    BoardQuantityConflict,
    "imageUrl" | "productName" | "productUrl" | "boardPageId" | "boardElementId"
  >,
): BoardQuantityConflict | null {
  return boardQuantitiesDiffer(item, board)
    ? {
        key: boardQuantityReviewKey(item.id, item, board),
        materialId: item.id,
        roomId: item.room_id,
        itemLabel: item.item_label,
        roomName,
        spec: quantityForReview(item),
        board: quantityForReview(board),
        imageUrl: context?.imageUrl || item.image_url || item.product?.image_url || null,
        productName:
          meaningfulProductName(context?.productName) || meaningfulProductName(item.product?.name),
        productUrl: context?.productUrl || item.product_url || item.product?.product_url || null,
        boardPageId: context?.boardPageId,
        boardElementId: context?.boardElementId,
      }
    : null;
}
export function boardMaterialUpdatePatch(patch: Partial<MaterialItem>, replaceQuantity: boolean) {
  if (replaceQuantity) return patch;
  const { quantity, quantity_tbd, quantity_unit, selection_quantity_unit, waste_percent, ...safe } =
    patch;
  return safe;
}
