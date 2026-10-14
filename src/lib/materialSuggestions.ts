import type { MaterialItem } from "@/lib/db";
import { inferMaterialCategory, normalizeItemCategory, type ItemTemplate } from "@/lib/roomTemplates";

export function normalizeMaterialSuggestionLabel(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function materialCoversTemplateSuggestion(item: MaterialItem, suggestion: ItemTemplate, roomName = "") {
  const key = normalizeMaterialSuggestionLabel(suggestion.label);
  // Identity fields describe the selection; notes such as "still need a hook" do not.
  const text = normalizeMaterialSuggestionLabel([
    item.item_label, item.client_product_name, item.cad_label,
    item.product?.name, item.product?.subcategory,
    item.product_url, item.product?.product_url,
  ].filter(Boolean).join(" "));
  const category = normalizeItemCategory(item.category) ??
    normalizeItemCategory(item.product?.category) ?? inferMaterialCategory(text);
  const has = (pattern: RegExp) => pattern.test(text);
  if (normalizeMaterialSuggestionLabel(item.item_label) === key) return true;
  switch (key) {
    case "tile": return category === "Tile & Stone" || item.product?.category === "Tile";
    case "shower tile": return (category === "Tile & Stone" || item.product?.category === "Tile") &&
      has(/\b(shower|showerwall|wet wall|tub surround)\b/);
    case "countertop":
    case "countertops": return category === "Countertops" || has(/\b(counter ?tops?|slab)\b/);
    case "sink": return category === "Plumbing" && has(/\b(sinks?|basins?|lavatory)\b/) &&
      !has(/\b(drains?|strainers?|sink faucets?|basin taps?|lavatory faucets?)\b/);
    case "faucet": return has(/\b(faucets?|lavatory faucet|basin tap)\b/);
    case "toilet": return has(/\b(toilets?|water closet|wc)\b/) &&
      !has(/\b(toilet (?:seats?|paper|roll|brush)|water closet seats?)\b/);
    case "shower system": return has(/\b(shower system|shower faucets?|shower trim|shower valve|shower ?heads?|rain ?heads?|hand ?shower|shower tub combo|tub shower)\b/);
    case "shower drain": return has(/\b(shower drain|linear drain|tile in drain)\b/);
    case "sink drain": return has(/\b(sink drain|basin drain|lavatory drain|pop up drain)\b/);
    case "pendant":
    case "sconce":
    case "lighting": return category === "Lighting" || item.product?.category === "Lighting" ||
      has(/\b(pendants?|sconces?|lighting|chandeliers?|lanterns?|flush ?mount|semi flush|ceiling fans?|(?:ceiling|wall|vanity|hanging|recessed) lights?)\b/);
    case "accent mirrors": return category === "Accent Mirrors" || has(/\b(mirrors?|medicine cabinet)\b/);
    case "cabinet finish":
    case "cabinetry finish": return has(/\b(cabinet|cabinetry)\b/) && has(/\b(finish|paint|stain|colou?r)\b/);
    case "cabinet hardware": return has(/\b(cabinet hardware|cabinet knobs?|cabinet pulls?|knobs?|pulls?|latches?)\b/) &&
      (!has(/\bshower\b/) || has(/\bcabinet\b/));
    case "flooring": return category === "Flooring" ||
      (has(/\b(floor|flooring|floor tile|wood floor|carpet|rug)\b/) && !has(/\bshower floor\b/));
    case "paint": return category === "Paint" || has(/\b(paint|lime ?wash|wall finish)\b/);
    case "towel hook": return has(/\b(towel|robe|bath) hooks?\b/) ||
      (/bath|powder/i.test(roomName) && has(/\bhooks?\b/) && !has(/\b(curtain|shower curtain|door|cabinet)\b/));
    case "toilet paper holder": return has(/\b(toilet paper|toilet roll|tissue|paper|tp) (holder|holders)\b/);
    default: return normalizeMaterialSuggestionLabel(item.item_label).replace(/ies$/, "y").replace(/s$/, "") ===
      key.replace(/ies$/, "y").replace(/s$/, "");
  }
}

export type BathroomPlanEvidence = {
  room_id: string;
  shower: "present" | "absent" | "unknown";
  confidence: "high" | "medium" | "low";
  page: number | null;
  sheet: string;
  evidence: string;
};

export function confirmedNoShower(evidence?: BathroomPlanEvidence) {
  return evidence?.shower === "absent" && evidence.confidence === "high" &&
    Number.isInteger(evidence.page) && (evidence.page ?? 0) > 0 && !!evidence.evidence.trim();
}

export function suggestedTemplatesForRoom(templates: ItemTemplate[], evidence?: BathroomPlanEvidence) {
  return confirmedNoShower(evidence)
    ? templates.filter(item => !["Shower Tile", "Shower System", "Shower Drain"].includes(item.label))
    : templates;
}
