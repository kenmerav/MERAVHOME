import { selectionItemCategory } from "./roomTemplates";

/** These selections need a takeoff rather than an assumed single item. */
export function materialQuantityStartsTbd(category: string | null | undefined) {
  return ["Tile & Stone", "Doors Base & Case", "Cabinetry"].includes(
    selectionItemCategory(category, category),
  );
}

/** Creation only: a supplied number (including 0 or 1) always takes precedence. */
export function newMaterialQuantityDefaults(
  category: string | null | undefined,
  quantity: number | null | undefined,
) {
  return quantity == null && materialQuantityStartsTbd(category)
    ? { quantity: null, quantity_tbd: true }
    : {};
}
