import type { MaterialItem, Product } from "@/lib/db";
import { catalogWidth, sinkMount } from "@/lib/materialCatalogSuggestions";
import type { BathroomPlanEvidence } from "./materialSuggestions";

export type FitField =
  | "width"
  | "depth"
  | "height"
  | "mount"
  | "drain_type"
  | "rough_in"
  | "outlet"
  | "finish";
export type FitRequirement = {
  label: string;
  field: FitField;
  value: number | string;
  page: number;
  sheet: string;
  evidence: string;
};
export type CatalogPlanFit = {
  key: string;
  room_id: string;
  room_name: string;
  status: "checking" | "checked" | "unavailable";
  document: { id: string; title: string; updated_at: string };
  started_at: string;
  request_id: string;
  response_id: string | null;
  pages: number | null;
  requirements: FitRequirement[];
  message: string;
  // Shared document extraction, stored only in the private server review cache.
  extraction_rooms?: { id: string; name: string; targets: string[] }[];
  room_requirements?: Record<string, FitRequirement[]>;
  bathroom_layouts?: BathroomPlanEvidence[];
};
export type PublicCatalogPlanFit =
  | Pick<CatalogPlanFit, "status" | "document" | "requirements" | "message">
  | {
      status: "no_document";
      document: null;
      requirements: FitRequirement[];
      message: string;
    };
export type CoordinationSource = {
  item_id: string;
  label: string;
  finish: string;
  primary: boolean;
};
export type CatalogFitAssessment = {
  status: "matches_recorded_requirements" | "needs_review" | "conflict";
  notes: string[];
  finish_match: boolean;
  sources: CoordinationSource[];
};

const norm = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function finishIdentity(value: string) {
  return norm(value)
    .replace(/\bsilgranit\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function cleanFitRequirements(
  value: unknown,
  labels: string[],
  pages: number,
): FitRequirement[] {
  if (!Array.isArray(value)) return [];
  const rows: FitRequirement[] = [];
  for (const source of value.slice(0, 120)) {
    if (!source || typeof source !== "object") continue;
    const r = source as Record<string, unknown>;
    if (
      !labels.includes(String(r.label)) ||
      r.confidence !== "high" ||
      r.explicit_specification !== true ||
      r.exact_object !== true ||
      r.inferred !== false ||
      !Number.isInteger(r.page) ||
      Number(r.page) < 1 ||
      Number(r.page) > pages ||
      typeof r.evidence !== "string" ||
      !r.evidence.trim() ||
      r.evidence.length > 1200 ||
      typeof r.sheet !== "string"
    )
      continue;
    const field = r.field as FitField;
    let val: number | string;
    if (["width", "depth", "height", "rough_in", "outlet"].includes(field)) {
      if (
        typeof r.value !== "number" ||
        !Number.isFinite(r.value) ||
        r.value <= 0 ||
        r.value > 5000 ||
        !["in", "mm", "cm"].includes(String(r.unit))
      )
        continue;
      val = r.unit === "mm" ? r.value / 25.4 : r.unit === "cm" ? r.value / 2.54 : r.value;
    } else if (
      field === "mount" &&
      ["wall", "undermount", "vessel", "drop_in"].includes(String(r.value))
    )
      val = String(r.value);
    else if (field === "drain_type" && ["linear", "point"].includes(String(r.value)))
      val = String(r.value);
    else if (
      field === "finish" &&
      typeof r.value === "string" &&
      r.value.trim() &&
      r.value.length <= 100
    )
      val = r.value.trim();
    else continue;
    rows.push({
      label: String(r.label),
      field,
      value: val,
      page: Number(r.page),
      sheet: r.sheet.slice(0, 100),
      evidence: r.evidence.trim(),
    });
  }
  // Conflicting callouts cannot silently choose one schedule or elevation.
  return rows
    .filter(
      (row) =>
        !rows.some(
          (other) =>
            other.label === row.label &&
            other.field === row.field &&
            (typeof row.value === "number" && typeof other.value === "number"
              ? Math.abs(row.value - other.value) > 0.01
              : norm(String(row.value)) !== norm(String(other.value))),
        ),
    )
    .filter(
      (row, index, all) =>
        all.findIndex((other) => other.label === row.label && other.field === row.field) === index,
    );
}

function dimensionValue(text: string | null, field: FitField) {
  if (field === "width") return catalogWidth(text);
  if (!text) return null;
  const labels: Partial<Record<FitField, string>> = {
    depth: "(?:overall )?depth",
    height: "(?:overall )?height",
    rough_in: "rough[ -]?in",
    outlet: "(?:outlet|connection|pipe)(?: size| diameter)?",
  };
  if (!labels[field]) return null;
  const match = text
    .replace(/\\"/g, '"')
    .match(
      new RegExp(
        `\\b${labels[field]}\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?(?:[- ]\\d+\\/\\d+)?)\\s*(inches|inch|in\\b|mm\\b|cm\\b|["″])`,
        "i",
      ),
    );
  if (!match) return null;
  const parts = match[1].match(/^(\d+(?:\.\d+)?)(?:[- ](\d+)\/(\d+))?$/);
  if (!parts || (parts[2] && !Number(parts[3]))) return null;
  const val = Number(parts[1]) + (parts[2] ? Number(parts[2]) / Number(parts[3]) : 0);
  return /mm/i.test(match[2]) ? val / 25.4 : /cm/i.test(match[2]) ? val / 2.54 : val;
}

export function roomCoordinationSources(
  label: string,
  items: MaterialItem[],
): CoordinationSource[] {
  // Basin and toilet colors do not establish the finish of metal plumbing.
  if (!/shower drain|faucet|shower system|towel hook|toilet paper holder/i.test(label)) return [];
  const sources = items.flatMap((item) => {
    if (item.not_needed || !item.product_id) return [];
    const identity = `${item.item_label} ${item.product?.name || ""}`;
    if (
      !/faucet|shower.*(?:system|head|trim|valve)|(?:system|head|trim).*shower|tub filler/i.test(
        identity,
      )
    )
      return [];
    const finish = item.color?.trim() || item.product?.finish?.trim() || "";
    if (!finish || /^(?:n\/?a|tbd|none|unknown|polished|brushed|matte|satin)$/i.test(finish))
      return [];
    return [
      {
        item_id: item.id,
        label: item.client_product_name || item.item_label,
        finish,
        primary: /shower drain/i.test(label) && /shower/i.test(identity),
      },
    ];
  });
  return sources.sort((a, b) => Number(b.primary) - Number(a.primary));
}

export function isNominalFitRequirement(r: FitRequirement) {
  return (
    /^(?:Sink|Shower Drain)$/i.test(r.label) &&
    ["width", "depth", "height"].includes(r.field) &&
    /fixture schedule/i.test(r.evidence) &&
    !/\b(?:overall|width|depth|height|length|dimensions?)\b/i.test(r.evidence)
  );
}

export function assessCatalogFit(
  product: Product,
  label: string,
  items: MaterialItem[],
  plan: PublicCatalogPlanFit,
): CatalogFitAssessment {
  const notes: string[] = [];
  let conflict = false,
    unknown = plan.status !== "checked";
  const requirements = plan.requirements.filter((r) => r.label === label);
  const physical = requirements.filter((r) => r.field !== "finish");
  let nominalSizeNoted = false;
  if (!physical.length) {
    unknown = true;
    notes.push("The plans do not provide enough explicit requirements to confirm physical fit.");
  }
  for (const r of requirements) {
    // Fixture names often use a nominal size: the scheduled Delta "4-inch"
    // drain has a larger overall body. A name alone cannot prove the axis or
    // installation envelope, including in previously cached AI results.
    if (isNominalFitRequirement(r)) {
      unknown = true;
      if (!nominalSizeNoted) {
        notes.push(
          `The fixture schedule names a ${r.value} in product size. Confirm its actual overall measurements and installation clearance; the advertised size alone does not establish physical fit.`,
        );
        nominalSizeNoted = true;
      }
      continue;
    }
    let actual: number | string | null;
    if (r.field === "mount") {
      const mount = sinkMount(product.name + " " + (product.description || ""));
      actual = mount === "any" ? null : mount;
    } else if (r.field === "drain_type")
      actual = /linear/i.test(product.name)
        ? "linear"
        : /round|square|point drain|center drain/i.test(product.name)
          ? "point"
          : null;
    else if (r.field === "finish") actual = product.finish ? finishIdentity(product.finish) : null;
    else actual = dimensionValue(product.dimensions, r.field);
    const wanted = r.field === "finish" ? finishIdentity(String(r.value)) : r.value;
    const matches =
      actual != null &&
      (typeof actual === "number" && typeof wanted === "number"
        ? Math.abs(actual - wanted) <= 0.01
        : actual === wanted);
    if (actual == null) {
      unknown = true;
      notes.push(
        `Catalog ${r.field.replaceAll("_", " ")} is not recorded; plans specify ${r.value}${typeof r.value === "number" ? " in" : ""}.`,
      );
    } else if (!matches) {
      if (r.field === "finish") unknown = true;
      else conflict = true;
      notes.push(
        `Differs from plans: ${r.field.replaceAll("_", " ")} ${r.value}${typeof r.value === "number" ? " in" : ""}; catalog records ${actual}${typeof actual === "number" ? " in" : ""}.`,
      );
    } else
      notes.push(
        `Matches recorded ${r.field.replaceAll("_", " ")} requirement on ${r.sheet || `page ${r.page}`}.`,
      );
  }
  const sources = roomCoordinationSources(label, items);
  const preferred = sources.some((s) => s.primary) ? sources.filter((s) => s.primary) : sources;
  const finishes = new Set(preferred.map((s) => finishIdentity(s.finish)));
  const candidateFinish = product.finish ? finishIdentity(product.finish) : "";
  const finishMatch = finishes.size === 1 && finishes.has(candidateFinish);
  if (sources.length) {
    if (new Set(sources.map((s) => finishIdentity(s.finish))).size > 1)
      notes.push("Room plumbing has mixed finishes; review the intended coordination.");
    if (finishMatch) notes.push("Finish matches the room’s selected plumbing.");
    else
      notes.push(
        "Finish differs from, or cannot be confirmed against, the room’s selected plumbing.",
      );
  }
  if (/shower drain/i.test(label)) {
    unknown = true;
    notes.push(
      "Confirm the drain body, waterproofing system, outlet connection and installation with the plumber. A shower-system finish does not prove drain compatibility.",
    );
  }
  return {
    status: conflict ? "conflict" : unknown ? "needs_review" : "matches_recorded_requirements",
    notes,
    finish_match: finishMatch,
    sources,
  };
}
