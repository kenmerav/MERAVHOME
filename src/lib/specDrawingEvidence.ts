import type { CompletionRoom } from "./specCompletion";

export const DRAWING_EVIDENCE_VERSION = "spec-drawing-evidence-v1";
export type DrawingFact = {
  id: string; room_id: string; label: string;
  field: "presence" | "quantity" | "color" | "finish" | "dimensions" | "price";
  product: string; sku: string; variant: string;
  page: number; sheet: string; evidence: string;
  quantity: number | null; quantity_unit: "count" | "square_feet" | null;
  value: string; complete_room_scope: boolean; exact_variant: boolean;
  explicit_specification: boolean; explicit_area: boolean;
  dimension_scope: "proposed_layout" | "product_specification" | null;
  conflicting_dimensions: boolean; price_unit: "unit" | "sq_ft" | null;
};
export type DrawingEvidence = {
  complete_project_scope: boolean;
  rooms: { room_id: string; match: "matched" | "unclear" | "not_shown" | "shared_default" }[];
  facts: DrawingFact[];
  uncertainties: { page: number; evidence: string }[];
};
export type DrawingEvidenceJob = {
  key: string; request_id: string; response_id: string | null;
  status: "checking" | "checked" | "unavailable";
  started_at: string; pages: number | null;
  rooms: CompletionRoom[]; evidence?: DrawingEvidence;
};

export function drawingCoverageMessage(evidence: DrawingEvidence) {
  const unmatched = evidence.rooms.filter(room => ["unclear", "not_shown"].includes(room.match)).length;
  return [evidence.facts.length ? "" : "The extraction contains no confidently supported drawing facts; plan details remain unverified.",
    unmatched ? `${unmatched} room${unmatched === 1 ? "" : "s"} could not be clearly matched to the drawings.` : "",
    evidence.uncertainties.length ? `${evidence.uncertainties.length} drawing uncertaint${evidence.uncertainties.length === 1 ? "y remains" : "ies remain"} for manual review.` : ""].filter(Boolean).join(" ");
}

export function responseJson(value: any) {
  if (value?.status !== "completed") throw Error("Incomplete drawing extraction");
  const output = value.output_text ?? value.output?.flatMap((item: any) => item.content ?? [])
    .filter((part: any) => part.type === "output_text").map((part: any) => part.text).join("");
  return JSON.parse(String(output || "").replace(/^```json\s*|\s*```$/g, "").trim());
}
const string = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value.trim() : "";
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

// Reject partial output rather than treating an omitted room/page as reviewed.
export function cleanDrawingEvidence(value: any, rooms: CompletionRoom[], pages: number): DrawingEvidence {
  if (!value || value.complete !== true || !Number.isSafeInteger(pages) || pages < 1 ||
      !Array.isArray(value.reviewed_pages) || value.reviewed_pages.length !== pages ||
      new Set(value.reviewed_pages).size !== pages || value.reviewed_pages.some((p: any) => !Number.isInteger(p) || p < 1 || p > pages) ||
      !Array.isArray(value.rooms) || value.rooms.length !== rooms.length ||
      rooms.some(room => value.rooms.filter((r: any) => r?.room_id === room.id).length !== 1) ||
      value.rooms.some((r: any) => !["matched", "unclear", "not_shown", "shared_default"].includes(r?.match)) ||
      !Array.isArray(value.facts) || value.facts.length > 2000 ||
      !Array.isArray(value.uncertainties) || value.uncertainties.length > 500 || JSON.stringify(value).length > 1_500_000)
    throw Error("Incomplete drawing evidence");
  const ids = new Set<string>();
  const facts: DrawingFact[] = value.facts.map((row: any) => {
    const id = string(row?.id, 100), label = string(row?.label, 200), sheet = string(row?.sheet, 100), evidence = string(row?.evidence, 1000);
    if (!id || ids.has(id) || !label || !sheet || !evidence || row.confidence !== "high" || row.proposed !== true ||
        !value.rooms.some((r: any) => r.room_id === row.room_id && r.match === "matched") ||
        !Number.isInteger(row.page) || row.page < 1 || row.page > pages ||
        !["presence", "quantity", "color", "finish", "dimensions", "price"].includes(row.field))
      throw Error("Invalid drawing fact");
    ids.add(id);
    if (row.field === "quantity" && (row.complete_room_scope !== true || row.exact_variant !== true ||
        !["count", "square_feet"].includes(row.quantity_unit) || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 1e9 ||
        (row.quantity_unit === "count" && !Number.isInteger(row.quantity)) || (row.quantity_unit === "square_feet" && row.explicit_area !== true)))
      throw Error("Unsupported drawing quantity");
    if (["color", "finish", "dimensions", "price"].includes(row.field) && (row.explicit_specification !== true || !string(row.value, 500)))
      throw Error("Unsupported drawing specification");
    if (row.field === "dimensions" && (!["proposed_layout", "product_specification"].includes(row.dimension_scope) || row.conflicting_dimensions !== false))
      throw Error("Ambiguous drawing dimensions");
    if (row.field === "price" && (row.currency !== "USD" || !["unit", "sq_ft"].includes(row.price_unit)))
      throw Error("Unsupported drawing price");
    return { id, room_id: row.room_id, label, field: row.field, product: string(row.product, 300), sku: string(row.sku, 200),
      variant: string(row.variant, 300), page: row.page, sheet, evidence,
      quantity: row.field === "quantity" ? row.quantity : null, quantity_unit: row.field === "quantity" ? row.quantity_unit : null,
      value: string(row.value, 500), complete_room_scope: row.complete_room_scope === true, exact_variant: row.exact_variant === true,
      explicit_specification: row.explicit_specification === true, explicit_area: row.explicit_area === true,
      dimension_scope: row.field === "dimensions" ? row.dimension_scope : null, conflicting_dimensions: row.conflicting_dimensions !== false,
      price_unit: row.field === "price" ? row.price_unit : null };
  });
  const uncertainties = value.uncertainties.map((row: any) => {
    if (!Number.isInteger(row?.page) || row.page < 1 || row.page > pages || !string(row.evidence, 1000)) throw Error("Invalid drawing uncertainty");
    return { page: row.page, evidence: string(row.evidence, 1000) };
  });
  return { complete_project_scope: value.complete_project_scope === true && value.rooms.every((r: any) => ["matched", "shared_default"].includes(r.match)),
    rooms: value.rooms.map((r: any) => ({ room_id: r.room_id, match: r.match })), facts, uncertainties };
}

// The comparison can match a current selection to evidence, but cannot invent
// a count, dimension, specification or citation absent from the saved drawing.
export function groundedCompletionRows(rows: unknown[], evidence: DrawingEvidence): unknown[] {
  if (!Array.isArray(rows) || rows.length > 5000) throw Error("Invalid comparison");
  return rows.flatMap((raw: any) => {
    if (!Array.isArray(raw?.evidence_ids) || !raw.evidence_ids.length || raw.evidence_ids.length > 100 ||
        new Set(raw.evidence_ids).size !== raw.evidence_ids.length) return [];
    const facts = raw.evidence_ids.map((id: string) => evidence.facts.find(f => f.id === id));
    if (facts.some((f: DrawingFact | undefined) => !f)) return [];
    const sources = facts as DrawingFact[];
    const field = raw.field === "missing_item" ? "presence" : raw.field;
    if (sources.some(f => f.field !== field)) return [];
    if (field === "quantity") {
      if (sources.some(f => !f.complete_room_scope || !f.exact_variant || f.quantity_unit !== raw.quantity_unit)) return [];
      if (raw.allocation_scope_complete === true) {
        const variant = (f: DrawingFact) => normalized([f.product, f.sku, f.variant].filter(Boolean).join(" | "));
        if (!evidence.complete_project_scope || !Array.isArray(raw.quantity_allocations) || !raw.quantity_allocations.length ||
            !variant(sources[0]) || sources.some(f => variant(f) !== variant(sources[0])) ||
            evidence.facts.filter(f => f.field === "quantity" && variant(f) === variant(sources[0])).length !== sources.length ||
            new Set(raw.quantity_allocations.map((a: any) => a?.room_id)).size !== raw.quantity_allocations.length ||
            sources.length !== raw.quantity_allocations.length ||
            raw.quantity_allocations.some((a: any) => sources.filter(f => f.room_id === a?.room_id && f.quantity === a.quantity).length !== 1) ||
            raw.quantity !== sources.reduce((sum, f) => sum + (f.quantity ?? 0), 0)) return [];
      } else if (sources.length !== 1 || sources[0].room_id !== raw.room_id || sources[0].quantity !== raw.quantity) return [];
    } else {
      if (sources.length !== 1 || sources[0].room_id !== raw.room_id) return [];
      const fact = sources[0];
      if (field !== "presence" && (normalized(String(raw.value ?? "")) !== normalized(fact.value) || !fact.explicit_specification)) return [];
      if (field === "dimensions" && (raw.dimension_scope !== fact.dimension_scope || fact.conflicting_dimensions)) return [];
      if (field === "price" && (raw.price_unit !== fact.price_unit || raw.currency !== "USD")) return [];
    }
    const fact = sources[0];
    return [{ ...raw, ...(field === "presence" ? { item_label: fact.label } : {}),
      page: fact.page, sheet: fact.sheet, evidence: sources.map(f => f.evidence).join("; ").slice(0, 1000),
      explicit_area: sources.every(f => f.explicit_area),
      explicit_specification: sources.every(f => f.explicit_specification),
      conflicting_dimensions: sources.some(f => f.conflicting_dimensions) }];
  });
}
