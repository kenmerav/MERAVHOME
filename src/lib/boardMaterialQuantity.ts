import { parseSpecQuantity, specQuantityUnitFromSelection } from "./specQuantity";

export type BoardQuantity = {
  id?: string;
  designAccuracySourceId?: string;
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
        : (item.materialQuantity ?? null);
  return parseSpecQuantity(
    value === null ? "TBD" : String(value),
    specQuantityUnitFromSelection(item.materialQuantityUnit),
    item.materialWastePercent || 0,
  );
}

export function boardPageQuantity(items: BoardQuantity[]) {
  if (
    !items.length ||
    items.some((item) => item.materialQuantityTbd || item.materialQuantity == null)
  )
    return null;
  const unique = new Map<string, BoardQuantity>();
  for (const [index, item] of items.entries()) {
    const id = item.designAccuracySourceId || item.id || `unassociated-${index}`;
    const previous = unique.get(id);
    if (
      previous &&
      (previous.materialQuantity !== item.materialQuantity ||
        previous.materialQuantityUnit !== item.materialQuantityUnit)
    )
      return null;
    unique.set(id, item);
  }
  const values = [...unique.values()];
  if (new Set(values.map((item) => item.materialQuantityUnit || "each")).size > 1) return null;
  return values.reduce((sum, item) => sum + item.materialQuantity!, 0);
}
