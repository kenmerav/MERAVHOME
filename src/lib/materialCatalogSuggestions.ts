import type { Product, MaterialItem } from "@/lib/db";
import {
  materialCoversTemplateSuggestion,
  normalizeMaterialSuggestionLabel,
} from "@/lib/materialSuggestions";
import { materialHasUserSelection } from "@/lib/materialSelection";
import { normalizeItemCategory, inferMaterialCategory } from "@/lib/roomTemplates";

export type CatalogUse = { product_id: string; project_id: string; room_name: string };
export type SinkMount = "any" | "wall" | "undermount" | "vessel" | "drop_in";
export type CatalogCriteria = { search?: string; width?: number | null; mount?: SinkMount };
export type CatalogSuggestion = {
  fit?: import("@/lib/materialCatalogFit").CatalogFitAssessment;
  product: Product;
  project_count: number;
  used_here: boolean;
  size_match: boolean;
  reason: string;
};

export function sinkMount(text: string): SinkMount {
  if (/wall[ -]?(?:mount|hung)/i.test(text)) return "wall";
  if (/under[ -]?mount/i.test(text)) return "undermount";
  if (/vessel|above[ -]?counter/i.test(text)) return "vessel";
  if (/drop[ -]?in|self[ -]?rimming|top[ -]?mount/i.test(text)) return "drop_in";
  return "any";
}

function inchNumber(text: string) {
  const match = text.trim().match(/^(\d+(?:\.\d+)?)(?:\s*[- ]\s*(\d+)\/(\d+))?$/);
  if (!match) return null;
  return (
    Number(match[1]) + (match[2] && Number(match[3]) ? Number(match[2]) / Number(match[3]) : 0)
  );
}

// Only labelled overall widths count. Bowl/cutout widths and unlabeled dimensions
// cannot establish whether a sink matches the design requirement.
export function catalogWidth(dimensions: string | null | undefined) {
  if (!dimensions) return null;
  const text = dimensions.replace(/\\"/g, '"');
  const explicitOverall = text.match(
    /\boverall\s+width\s*[:=]?\s*(\d+(?:\.\d+)?(?:\s*[- ]\s*\d+\/\d+)?)\s*(inches|inch|in\b|mm\b|cm\b|["″])/i,
  );
  if (!explicitOverall && /\b(?:bowl|basin|cutout|cut out)\s+width\b/i.test(dimensions))
    return null;
  const match =
    explicitOverall ??
    text.match(
      /\b(?:overall\s+)?width\s*[:=]?\s*(\d+(?:\.\d+)?(?:\s*[- ]\s*\d+\/\d+)?)\s*(inches|inch|in\b|mm\b|cm\b|["″])/i,
    ) ??
    text.match(
      /(\d+(?:\.\d+)?(?:\s*[- ]\s*\d+\/\d+)?)\s*(inches|inch|in\b|mm\b|cm\b|["″])\s*(?:w\b|wide\b)/i,
    );
  if (!match) return null;
  const number = inchNumber(match[1]);
  if (number == null) return null;
  return /mm/i.test(match[2]) ? number / 25.4 : /cm/i.test(match[2]) ? number / 2.54 : number;
}

export function catalogProductMatches(
  product: Product,
  label: string,
  category: string,
  roomName: string,
) {
  const key = normalizeMaterialSuggestionLabel(label);
  const text = [product.name, product.subcategory, product.product_url].filter(Boolean).join(" ");
  if (key === "toilet") {
    const identity = normalizeMaterialSuggestionLabel(
      product.name.replace(/\bseat (?:not included|sold separately)\b/gi, ""),
    );
    return (
      /\b(toilets?|water closet|wc)\b/.test(identity) &&
      !/\b(toilet (?:seats?|paper|roll|brush|tanks?|bolts?)|bowl only|levers?|trip lever|flush plate|tank lid|tank cover|wax ring|tiles?|backsplash|wallpaper|paint|supply line|connector)\b/.test(
        identity,
      )
    );
  }
  if (/\bsinks?\b/.test(key)) {
    if (
      !/\b(sinks?|basins?|lavatory)\b/i.test(text) ||
      /\b(?:drains?|strainers?|faucets?|sink grids?|sink racks?|tiles?|wallpaper|cabinet)\b/i.test(
        product.name,
      )
    )
      return false;
    if (
      /bath|powder/i.test(roomName) &&
      /\b(kitchen|laundry|utility|farmhouse|apron)\b/i.test(text)
    )
      return false;
    if (
      /kitchen|pantry|laundry/i.test(roomName) &&
      /\b(bathroom|lavatory|vessel|wall.hung)\b/i.test(text)
    )
      return false;
    return true;
  }
  return materialCoversTemplateSuggestion(
    { item_label: "", category: product.category, product } as MaterialItem,
    { label, category: normalizeItemCategory(category) ?? inferMaterialCategory(label) },
    roomName,
  );
}

export function rankCatalogSuggestions(
  products: Product[],
  uses: CatalogUse[],
  projectId: string,
  roomName: string,
  label: string,
  category: string,
  criteria: CatalogCriteria = {},
  limit = 12,
) {
  const isSink = /\bsinks?\b/.test(normalizeMaterialSuggestionLabel(label));
  const mount = criteria.mount === "any" || !criteria.mount ? sinkMount(label) : criteria.mount;
  const search = criteria.search?.trim().toLowerCase() || "";
  return products
    .flatMap((product) => {
      if (!catalogProductMatches(product, label, category, roomName)) return [];
      const text = [product.name, product.vendor, product.finish, product.sku]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (search && !text.includes(search)) return [];
      if (
        isSink &&
        mount !== "any" &&
        sinkMount(product.name + " " + (product.description || "")) !== mount
      )
        return [];
      const width = catalogWidth(product.dimensions);
      if (
        isSink &&
        criteria.width != null &&
        (width == null || Math.abs(width - criteria.width) > 0.5)
      )
        return [];
      const history = uses.filter((use) => use.product_id === product.id);
      const projectCount = new Set(history.map((use) => use.project_id)).size;
      const usedHere = history.some((use) => use.project_id === projectId);
      const sizeMatch = isSink && criteria.width != null && width != null;
      const reason = [
        usedHere
          ? "Used in this project"
          : projectCount
            ? `Used on ${projectCount} previous ${projectCount === 1 ? "project" : "projects"}`
            : "Available in your catalog",
        sizeMatch
          ? `Overall width is within ½ inch of ${criteria.width} in; confirm the cutout and plumbing`
          : isSink
            ? "Size / fit needs confirmation"
            : "Confirm the selected finish and quantity",
      ].join(" · ");
      return [
        {
          product,
          project_count: projectCount,
          used_here: usedHere,
          size_match: sizeMatch,
          reason,
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.used_here) - Number(a.used_here) ||
        b.project_count - a.project_count ||
        a.product.name.localeCompare(b.product.name),
    )
    .slice(0, limit);
}

export function untouchedCatalogPlaceholder(item: Partial<MaterialItem>) {
  return item.is_required === true && !item.not_needed && !materialHasUserSelection(item);
}
