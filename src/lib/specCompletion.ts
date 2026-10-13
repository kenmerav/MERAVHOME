import type { MaterialItem } from "@/lib/db";
import { materialVisibleInProcurement } from "@/lib/materialSelection";
import { specQuantityUnit } from "@/lib/specQuantity";
import { productPriceUnit } from "@/lib/productPriceUnit";
import { materialCoversTemplateSuggestion, normalizeMaterialSuggestionLabel } from "@/lib/materialSuggestions";
import { inferMaterialCategory } from "@/lib/roomTemplates";

export type CompletionRoom = { id: string; name: string };
export type CompletionField = "quantity" | "color" | "finish" | "dimensions" | "price" | "price_unit" | "product" | "link" | "missing_item";
export type CompletionFinding = {
  id: string; room_id: string; item_id: string | null; item_label: string;
  field: CompletionField; source: "details" | "plans"; message: string;
  current: string; suggested: string; page: number | null; sheet: string; evidence: string;
  dimension_scope?: "proposed_layout" | "product_specification";
};
export type SpecCompletionReport = {
  checked_at: string; item_count: number; findings: CompletionFinding[];
  plan_status: "checked" | "no_document" | "unavailable";
  document: { id: string; title: string; updated_at: string } | null;
  plan_message: string;
  document_refresh?: { status: "checked" | "incomplete" | "unavailable"; checked_at: string; uploaded: number; message: string };
};

export function hasCompletionValue(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return !!text && !/^(?:[-—–]|tbd|tbc|n\/?a|none|unknown|not (?:specified|available|set)|pending|to be (?:determined|confirmed))\.?$/i.test(text);
}

export function completionItems(items: MaterialItem[]) {
  return items.filter(materialVisibleInProcurement);
}

export function needsCompletionColor(item: MaterialItem) {
  if (hasCompletionValue(item.color)) return false;
  const finish = item.product?.finish?.trim() || "";
  // A sheen alone ("Matte") does not supply a color; "Matte Black" can supply both.
  return !hasCompletionValue(finish) || /^(?:(?:matte|satin|polished|brushed|honed|glossy?|smooth|textured|unfinished|silgranit|roman clay)[\s/,-]*)+$/i.test(finish);
}

// A missing measurement is not an issue on its own. Require evidence of a
// size selector, and accept a confirmed option (including named sizes).
export function needsCompletionDimensions(item: MaterialItem) {
  if (hasCompletionValue(item.product?.dimensions) || hasCompletionValue(item.product?.selected_size)) return false;
  const options = new Set((item.product?.size_options ?? []).filter(hasCompletionValue).map(option => option.trim().toLowerCase()));
  return options.size > 1;
}

// Color and finish share a field on Materials; a useful value in either satisfies this check.
export function checkSpecDetails(items: MaterialItem[], rooms: CompletionRoom[]): CompletionFinding[] {
  const roomIds = new Set(rooms.map(room => room.id));
  return completionItems(items).filter(item => roomIds.has(item.room_id)).flatMap(item => {
    const result: CompletionFinding[] = [];
    const add = (field: CompletionField, message: string, current = "") => result.push({
      id: `${item.id}:${field}`, room_id: item.room_id, item_id: item.id,
      item_label: item.client_product_name || item.item_label, field, source: "details",
      message, current, suggested: "", page: null, sheet: "", evidence: "",
    });
    if (item.quantity_tbd || item.quantity == null || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
      (specQuantityUnit(item) === "count" && !Number.isInteger(item.quantity)))
      add("quantity", "Quantity needs confirmation.", item.quantity_tbd ? "TBD" : String(item.quantity ?? ""));
    if (!item.product_id || !item.product) add("product", "No catalog product is assigned. This item does not appear in the Spec Book yet.");
    if (needsCompletionColor(item)) add("color", "Color / finish needs confirmation.");
    if (needsCompletionDimensions(item)) add("dimensions", "This product has multiple sizes. Confirm the selected size.");
    const price = item.product?.price?.trim() || "";
    // Zero is a reviewed price; placeholders, invalid values and ranges still need confirmation.
    if (!/^\$?\s*\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(price)) add("price", "Price needs confirmation.", price);
    else if (!productPriceUnit(item.product?.price_unit)) add("price_unit", "Confirm whether the price is per unit or per square foot.");
    const link = item.product_url?.trim() || item.product?.product_url?.trim() || "";
    try { if (!["https:", "http:"].includes(new URL(link).protocol)) throw new Error(); }
    catch { add("link", "Product link is missing or incomplete.", link); }
    return result;
  });
}

export function completionQuantity(item: MaterialItem) {
  return item.quantity_tbd ? "TBD" : item.quantity == null ? "Not set" :
    `${item.quantity}${specQuantityUnit(item) === "square_feet" ? " sq ft" : ""}`;
}

// Treat AI output as untrusted: only exact room/material IDs and supported page references survive.
export function cleanCompletionPlanFindings(value: unknown, items: MaterialItem[], rooms: CompletionRoom[], pages: number, targetedDimensions = false): CompletionFinding[] {
  const rows = Array.isArray(value) ? value : [];
  const selected = completionItems(items);
  const results: CompletionFinding[] = [];
  const text = (value: unknown, max = 1200) => typeof value === "string" ? value.trim().slice(0, max) : "";
  for (const row of rows.slice(0, 1000)) {
    if (!row || row.confidence !== "high" || !Number.isInteger(row.page) || row.page < 1 || row.page > pages ||
      !text(row.evidence) || !rooms.some(room => room.id === row.room_id)) continue;
    const base = { room_id: row.room_id, source: "plans" as const, page: row.page,
      sheet: text(row.sheet, 100), evidence: text(row.evidence) };
    if (row.field === "missing_item") {
      const label = text(row.item_label, 180);
      if (!label || row.confirmed_missing !== true || row.item_id != null) continue;
      if (/\b(sink|basin|lavatory) drain\b/i.test(label)) continue;
      const room = rooms.find(room => room.id === row.room_id)!;
      const canonicalLabel = /\b(?:towel|robe) hooks?\b/i.test(label) ? "Towel Hook" :
        /\b(?:lights?|lighting|sconces?|pendants?|chandeliers?|ceiling fans?)\b/i.test(label) ? "Lighting" :
        /\b(?:toilet paper|toilet roll|tissue|tp) holders?\b/i.test(label) ? "Toilet Paper Holder" : label;
      const template = { label: canonicalLabel, category: inferMaterialCategory(label) };
      // Check selected aliases and explicit exclusions again rather than trusting the model alone.
      if (items.some(item => item.room_id === room.id && (item.not_needed || selected.includes(item)) &&
        (normalizeMaterialSuggestionLabel(item.item_label) === normalizeMaterialSuggestionLabel(label) ||
          materialCoversTemplateSuggestion(item, template, room.name)))) continue;
      results.push({ ...base, id: `plan:missing:${row.room_id}:${label.toLowerCase()}`, item_id: null,
        item_label: label, field: "missing_item", message: "The plans show an item to review for this room.", current: "No matching selection found", suggested: label });
      continue;
    }
    const item = selected.find(item => item.id === row.item_id && item.room_id === row.room_id);
    if (!item || row.exact_material_match !== true) continue;
    const label = item.client_product_name || item.item_label;
    if (row.field === "quantity") {
      const unit = row.quantity_unit;
      const qty = row.quantity;
      if (!["count", "square_feet"].includes(unit) || typeof qty !== "number" || !Number.isFinite(qty) ||
        qty <= 0 || qty > 1e9 || (unit === "count" && !Number.isInteger(qty)) ||
        row.count_scope !== "exact_material" || (unit === "square_feet" && row.explicit_area !== true)) continue;
      if (!item.quantity_tbd && item.quantity === qty && specQuantityUnit(item) === unit) continue;
      results.push({ ...base, id: `plan:${item.id}:quantity`, item_id: item.id, item_label: label,
        field: "quantity", message: "Quantity differs from the plans or needs confirmation.",
        current: completionQuantity(item), suggested: `${qty}${unit === "square_feet" ? " sq ft" : " count"}` });
    } else if (["color", "finish", "dimensions", "price"].includes(row.field) && row.explicit_specification === true) {
      const field = row.field as "color" | "finish" | "dimensions" | "price";
      const current = field === "color" ? item.color || item.product?.finish || "" : item.product?.[field] || "";
      let suggested = text(row.value, 500);
      if (!hasCompletionValue(suggested)) continue;
      if (field === "dimensions" && (!hasExplicitDimensions(suggested) ||
        !["proposed_layout", "product_specification"].includes(row.dimension_scope) || row.conflicting_dimensions !== false)) continue;
      if (field === "dimensions" && !targetedDimensions && !hasCompletionValue(current) && !needsCompletionDimensions(item)) continue;
      if (field === "price") {
        if (!/^\$?\s*\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(suggested) || !["unit", "sq_ft"].includes(row.price_unit) || row.currency !== "USD") continue;
        if (hasCompletionValue(current) && Number(current.replace(/[$,\s]/g, "")) === Number(suggested.replace(/[$,\s]/g, "")) && item.product?.price_unit === row.price_unit) continue;
        suggested = `${suggested} / ${row.price_unit === "sq_ft" ? "sq ft" : "unit"}`;
      } else if (current.trim().toLowerCase() === suggested.toLowerCase()) continue;
      results.push({ ...base, id: `plan:${item.id}:${field}`, item_id: item.id, item_label: label,
        field, message: `The plans specify ${field}; review against the selection.`, current, suggested,
        ...(field === "dimensions" ? { dimension_scope: row.dimension_scope } : {}) });
    }
  }
  // Conflicting or repeated AI rows cannot silently choose a result.
  return results.filter(result => results.filter(candidate => candidate.id === result.id).length === 1);
}

export function hasExplicitDimensions(value: string) {
  return hasCompletionValue(value) && /\d\s*(?:["″'′]|\b(?:in|inch(?:es)?|ft|feet|foot|mm|cm|m)\b)/i.test(value);
}
