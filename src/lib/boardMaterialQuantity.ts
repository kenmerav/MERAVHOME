import { parseSpecQuantity, specQuantityUnitFromSelection } from "./specQuantity";

export type BoardQuantity = {
  materialQuantity?: number | null;
  materialQuantityTbd?: boolean;
  materialQuantityUnit?: string;
  materialWastePercent?: number;
};

export function boardQuantityEdit(item: BoardQuantity, text: string) {
  const parsed = parseSpecQuantity(text, specQuantityUnitFromSelection(item.materialQuantityUnit));
  return { materialQuantity: parsed.quantity, materialQuantityTbd: parsed.quantity_tbd };
}

export function boardMaterialQuantity(item: BoardQuantity, override?: number | null) {
  const value =
    override !== undefined
      ? override
      : item.materialQuantityTbd
        ? null
        : (item.materialQuantity ?? 1);
  return parseSpecQuantity(
    value === null ? "TBD" : String(value),
    specQuantityUnitFromSelection(item.materialQuantityUnit),
    item.materialWastePercent || 0,
  );
}

export function boardPageQuantity(items: BoardQuantity[]) {
  if (items.some((item) => item.materialQuantityTbd)) return null;
  if (items.length === 1) return items[0].materialQuantity ?? 1;
  return items.every((item) => item.materialQuantityUnit)
    ? items.reduce((sum, item) => sum + (item.materialQuantity ?? 1), 0)
    : items.length;
}
