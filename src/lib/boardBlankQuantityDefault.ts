import { inferMaterialCategory, selectionItemCategory } from "./roomTemplates";
import { isCountertopMaterial } from "./countertopPricing";
import { specQuantityUnitFromSelection } from "./specQuantity";
import type { BoardQuantity } from "./boardMaterialQuantity";

type BoardItem = BoardQuantity & {
  label?: string | null;
  productName?: string | null;
  materialCategory?: string | null;
  link?: string | null;
};

/** Supply a starting count for a blank ordinary board item, never an explicit TBD. */
export function boardBlankQuantityDefault<T extends BoardItem>(item: T): T {
  if (item.designAccuracySourceId || item.materialQuantityTbd || item.materialQuantity != null)
    return item;
  if (!["count", "pair", "set"].includes(specQuantityUnitFromSelection(item.materialQuantityUnit)))
    return item;
  const label = `${item.label || ""} ${item.productName || ""}`.trim();
  if (!label) return item;
  const discreteRug = /\b(?:area\s+)?rugs?\b/i.test(label);
  const discreteFilingCabinet = /\b(?:filing|file)\s+cabinet\b/i.test(label);
  let category = selectionItemCategory(item.materialCategory, label, item.link);
  if (category === "Other") category = inferMaterialCategory(label, item.link);
  const measuredCategory = [
    "Flooring",
    "Tile & Stone",
    "Countertops",
    "Cabinetry",
    "Doors Base & Case",
    "Paint",
    "Wall Coverings",
  ].includes(category);
  if (
    (measuredCategory &&
      !(category === "Flooring" && discreteRug) &&
      !(category === "Cabinetry" && discreteFilingCabinet)) ||
    isCountertopMaterial({
      item_label: label,
      category: item.materialCategory,
      product_url: item.link,
    }) ||
    /\bslabs?\b/i.test(label)
  )
    return item;
  return { ...item, materialQuantity: 1, materialQuantityTbd: false };
}
