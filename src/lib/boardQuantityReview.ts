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
  materialItemId?: string | null;
  label: string;
  productUrl?: string | null;
  color?: string | null;
  dimensions?: string | null;
  materialLinkCleared?: boolean;
};
const text = (value?: string | null) => (value || "").trim().replace(/\s+/g, " ").toLowerCase();
const url = (value?: string | null) => (value || "").trim().replace(/\/+$/, "").toLowerCase();
export function findBoardMaterialForSend(target: BoardMaterialTarget, items: MaterialItem[]) {
  const matches = (item: MaterialItem, ignoreUrl = false) =>
    item.room_id === target.roomId &&
    text(item.item_label) === text(target.label) &&
    (ignoreUrl || url(item.product_url) === url(target.productUrl)) &&
    text(item.color) === text(target.color) &&
    text(item.product?.dimensions) === text(target.dimensions);
  const linked = items.find((item) => item.id === target.materialItemId);
  return linked && (matches(linked) || (target.materialLinkCleared && matches(linked, true)))
    ? linked
    : items.find((item) => matches(item)) || null;
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
  itemLabel: string;
  roomName: string;
  spec: SpecQuantityPatch;
  board: SpecQuantityPatch;
};
export type BoardQuantityDecisions = Record<string, "keep" | "board">;
export function boardQuantityConflict(
  item: MaterialItem,
  board: SpecQuantity,
  roomName: string,
): BoardQuantityConflict | null {
  return boardQuantitiesDiffer(item, board)
    ? {
        key: boardQuantityReviewKey(item.id, item, board),
        materialId: item.id,
        itemLabel: item.item_label,
        roomName,
        spec: quantityForReview(item),
        board: quantityForReview(board),
      }
    : null;
}
export function boardMaterialUpdatePatch(patch: Partial<MaterialItem>, replaceQuantity: boolean) {
  if (replaceQuantity) return patch;
  const { quantity, quantity_tbd, quantity_unit, selection_quantity_unit, waste_percent, ...safe } =
    patch;
  return safe;
}
