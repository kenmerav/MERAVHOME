import { ambiguousFinish, finishMatches } from "./selectedFinish";
import { selectionItemsForRoom } from "./selectionChecklist";

/** Design decisions, not scraped facts. This schema is opt-in; legacy records are proposals. */
export type AccuracyValue = string | number | null;
export type AccuracySource = {
  id: string;
  kind:
    "supplier" | "sample" | "layout" | "schedule" | "brief" | "document" | "default" | "designer";
  label: string;
  revision: string;
  reference: string;
  documentId?: string;
  sheet?: string;
  page?: number;
};
export type AccuracyConfirmation = {
  value: AccuracyValue;
  source: AccuracySource;
  actor: string;
  at: string;
  selectionVersion: number;
  selectionIdentity?: string;
};
export type AccuracyField = {
  value: AccuracyValue;
  proposal?: AccuracyValue;
  confirmation?: AccuracyConfirmation;
  inheritedFrom?: string;
  history: AccuracyConfirmation[];
};
export type Disposition =
  "select" | "not-needed" | "existing" | "other-party" | "included" | "unresolved";
export type AccuracyDecision = {
  disposition: Disposition;
  actor: string;
  at: string;
  owner?: string;
  parentId?: string;
  source?: AccuracySource;
  meravFields?: string[];
};
export type AccuracyItem = {
  id: string;
  category: string;
  version: number;
  selectionId?: string;
  materialId?: string;
  kind: "retail" | "custom" | "cabinet-finish" | "coordination";
  decision?: AccuracyDecision;
  decisionHistory: AccuracyDecision[];
  fields: Record<string, AccuracyField>;
  sizeRequired: boolean;
  companions: {
    id: string;
    label: string;
    disposition?: "included" | "separate" | "other-party";
    parentId?: string;
    source?: AccuracySource;
    actor?: string;
    at?: string;
  }[];
};
export type AccuracyRoom = { id: string; name: string; items: AccuracyItem[] };
export type AccuracyCheck = {
  id: string;
  roomId: string;
  itemId: string;
  field: string;
  expected: AccuracyValue;
  relation: "equals" | "maximum" | "minimum" | "explicit-presence";
  unit?: string;
  source: AccuracySource;
  mode: "manual" | "automated";
  at: string;
  actor: string;
  dependencies: { itemId: string; field: string; value: AccuracyValue }[];
};
export type AccuracyState = {
  schema: 1;
  revision: number;
  projectId: string;
  enabledBy: string;
  enabledAt: string;
  rooms: AccuracyRoom[];
  agreedRooms: { id: string; name: string }[];
  scopeConfirmation?: AccuracyConfirmation;
  sources: AccuracySource[];
  checks: AccuracyCheck[];
  defaults?: { id: string; key: string; value: AccuracyValue; source: AccuracySource }[];
  documentRevisions?: Record<string, string>;
  coverage: {
    sourceId: string;
    revision: string;
    expected: string[];
    processed: string[];
    failed: string[];
    cancelled: boolean;
  }[];
  snapshots: {
    id: string;
    at: string;
    actor: string;
    revision: number;
    kind: "draft" | "design-approved";
    rows: AccuracyOutput[];
    agreedRooms?: { id: string; name: string }[];
    sources?: AccuracySource[];
    checks?: AccuracyCheck[];
  }[];
};
export type AccuracyOutput = {
  sourceId: string;
  selectionVersion: number;
  roomId: string;
  category: string;
  disposition: Disposition;
  productName: string;
  manufacturer: string;
  sku: string;
  color: string;
  sheen: string;
  selectedSize: string;
  overallDimensions: string;
  customId: string;
  specification: string;
  documentation: string;
  finishCodeOrSample: string;
  location: string;
  mountingCenters: string;
  cutout: string;
  installation: string;
  imageUrl: string;
  url: string;
  quantity: number | null;
  quantityUnit: string;
  purchaseQuantity: number | null;
  purchaseUnit: string;
  purchaseReady: boolean;
  price: number | null;
  priceUnit: string;
  notes: string;
  designResolved: boolean;
};
export const ACCURACY_UNITS = [
  "each",
  "pair",
  "set",
  "sq ft",
  "linear ft",
  "box",
  "carton",
  "slab",
  "roll",
  "gallon",
];
export const valueOf = (item: AccuracyItem, key: string) => item.fields[key]?.value ?? null;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const unresolved = (value: AccuracyValue) =>
  value === null ||
  value === "" ||
  (typeof value === "string" &&
    /\b(tbd|tbc|unknown|undecided|needs review|choose|to be confirmed)\b/i.test(value));
const positive = (v: AccuracyValue): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const cabinet = (category: string) => /(?:cabinet|vanity) finish/i.test(category);
const coordination = (category: string) =>
  /(?:cabinet|vanity) (?:layout|construction)|appliance layout/i.test(category);
export function validAccuracySource(source?: AccuracySource): source is AccuracySource {
  return Boolean(
    source &&
    source.id &&
    source.label.trim().length >= 3 &&
    source.revision.trim() &&
    source.reference.trim().length >= 8 &&
    !/^(verified|approved|confirmed|reviewed|manual|designer count|unknown|not applicable)$/i.test(
      source.reference.trim(),
    ) &&
    (!source.documentId || (source.page && source.page > 0 && source.sheet)),
  );
}
export function sourceCurrent(state: AccuracyState, source?: AccuracySource) {
  if (!validAccuracySource(source)) return false;
  if (
    source.documentId &&
    state.documentRevisions &&
    state.documentRevisions[source.documentId] !== source.revision
  )
    return false;
  const governing = state.sources.find((s) => s.id === source.id);
  return validAccuracySource(source) && (!governing || same(governing, source));
}
export function fieldConfirmed(state: AccuracyState, item: AccuracyItem, key: string) {
  const field = item.fields[key],
    confirmation = field?.confirmation;
  if (field?.inheritedFrom) {
    const inherited = state.defaults?.find((d) => d.id === field.inheritedFrom);
    if (
      !inherited ||
      !same(inherited.value, field.value) ||
      !confirmation ||
      !same(inherited.source, confirmation.source)
    )
      return false;
  }
  return Boolean(
    confirmation &&
    !unresolved(field.value) &&
    same(field.value, confirmation.value) &&
    sourceCurrent(state, confirmation.source) &&
    (!confirmation.selectionIdentity ||
      confirmation.selectionIdentity === fieldIdentity(item, key)),
  );
}
function fieldIdentity(item: AccuracyItem, key: string) {
  // Counts depend on location/use. Product facts depend on the exact variant, not its family URL alone.
  const keys =
    key === "quantity" || key === "quantityBasis"
      ? [
          "location",
          "sku",
          "customId",
          "quantityUnit",
          key === "quantity" ? "quantityBasis" : "quantity",
        ]
      : [
          "manufacturer",
          "sku",
          "url",
          "customId",
          "selectedSize",
          ...(item.kind === "cabinet-finish" && key === "color" ? ["finishCodeOrSample"] : []),
        ];
  return JSON.stringify(keys.filter((k) => k !== key).map((k) => [k, valueOf(item, k)]));
}
function scopeValue(state: AccuracyState) {
  return JSON.stringify(state.agreedRooms);
}
export function createAccuracyState(
  projectId: string,
  rooms: { id: string; name: string }[],
  actor: string,
  at: string,
): AccuracyState {
  return {
    schema: 1,
    revision: 0,
    projectId,
    enabledBy: actor,
    enabledAt: at,
    agreedRooms: [],
    rooms: rooms.map((room) => ({
      ...room,
      items: selectionItemsForRoom(room.name).map((r) =>
        createAccuracyItem(`${room.id}:${r.key}`, r.label),
      ),
    })),
    sources: [],
    checks: [],
    coverage: [],
    snapshots: [],
  };
}
export function createAccuracyItem(id: string, category: string): AccuracyItem {
  return {
    id,
    category,
    version: 1,
    kind: cabinet(category) ? "cabinet-finish" : coordination(category) ? "coordination" : "retail",
    fields: {},
    sizeRequired: false,
    companions: [],
    decisionHistory: [],
  };
}
export function reconcileAccuracyRooms(
  state: AccuracyState,
  rooms: { id: string; name: string }[],
) {
  const next = structuredClone(state);
  for (const room of rooms) {
    let existing = next.rooms.find((r) => r.id === room.id);
    if (!existing) {
      existing = { ...room, items: [] };
      next.rooms.push(existing);
    }
    existing.name = room.name;
    for (const required of selectionItemsForRoom(room.name)) {
      const id = `${room.id}:${required.key}`;
      if (!existing.items.some((i) => i.id === id))
        existing.items.push(createAccuracyItem(id, required.label));
    }
  }
  return next;
}
export function conditionalFields(item: AccuracyItem) {
  if (item.kind === "cabinet-finish")
    return [
      "manufacturer",
      "color",
      "location",
      ...(valueOf(item, "finishCodeAvailable") === "yes" ||
      valueOf(item, "finishType") === "custom" ||
      /\bcustom\b/i.test(String(valueOf(item, "color")))
        ? ["finishCodeOrSample"]
        : []),
    ];
  if (item.kind === "coordination") return [];
  const fields: string[] = [];
  if (
    /tile|backsplash|flooring/i.test(item.category) &&
    !/wood|carpet|vinyl/i.test(String(valueOf(item, "material")))
  )
    fields.push("grout", "joint", "layout", "direction", "edge");
  if (/paint|wall finish|ceiling finish/i.test(item.category)) fields.push("colorCode", "sheen");
  if (/countertop/i.test(item.category)) fields.push("thickness", "edge", "overhang");
  return fields;
}
export function requiredAccuracyFields(item: AccuracyItem) {
  const decision = item.decision;
  if (
    !decision ||
    decision.disposition === "unresolved" ||
    decision.disposition === "not-needed" ||
    decision.disposition === "included"
  )
    return [];
  if (decision.disposition === "existing") return ["location", ...(decision.meravFields ?? [])];
  if (decision.disposition === "other-party") return decision.meravFields ?? [];
  if (item.kind === "coordination") return ["owner", "coordinationReference"];
  if (item.kind === "cabinet-finish") return conditionalFields(item);
  const identity =
    item.kind === "custom"
      ? ["customId", "specification", "documentation"]
      : ["productName", "manufacturer", "sku", "url", "imageUrl"];
  return [
    ...new Set([
      ...identity,
      "color",
      "location",
      "quantity",
      "quantityUnit",
      "quantityBasis",
      ...(item.sizeRequired ? ["selectedSize"] : []),
      ...conditionalFields(item),
    ]),
  ];
}
export function accuracyItemIssues(state: AccuracyState, item: AccuracyItem): string[] {
  const decision = item.decision;
  if (!decision || decision.disposition === "unresolved")
    return ["Resolve this required selection or explicitly mark it Not needed."];
  const issues: string[] = [];
  if (decision.disposition === "not-needed") {
    if (
      state.checks.some(
        (c) =>
          c.itemId === item.id &&
          c.relation === "explicit-presence" &&
          sourceCurrent(state, c.source),
      )
    )
      issues.push("Not needed contradicts explicit current design evidence.");
    return issues;
  }
  if (decision.disposition === "included") {
    const parent = state.rooms.flatMap((r) => r.items).find((i) => i.id === decision.parentId);
    if (
      !parent ||
      parent.id === item.id ||
      parent.decision?.disposition !== "select" ||
      !sourceCurrent(state, decision.source!)
    )
      issues.push("Included needs a selected parent and package evidence or a named confirmation.");
    return issues;
  }
  if (decision.disposition === "other-party" && !text(decision.owner))
    issues.push("Name the responsible party.");
  for (const key of requiredAccuracyFields(item)) {
    if (!fieldConfirmed(state, item, key)) issues.push(`Confirm ${key} with a current reference.`);
  }
  const color = valueOf(item, "color");
  if (
    fieldConfirmed(state, item, "supplierColor") &&
    !unresolved(color) &&
    !finishMatches(String(color), String(valueOf(item, "supplierColor")))
  )
    issues.push(
      "The selected color conflicts with the cited exact variant. Resolve the link or selected finish.",
    );
  if (
    requiredAccuracyFields(item).includes("url") &&
    !/^https?:\/\/[^\s]+$/i.test(String(valueOf(item, "url")))
  )
    issues.push("Use the exact product variant's valid web link.");
  if (
    requiredAccuracyFields(item).includes("imageUrl") &&
    !/^https?:\/\/[^\s]+$/i.test(String(valueOf(item, "imageUrl")))
  )
    issues.push("Add a representative product image link.");
  if (
    !unresolved(color) &&
    (ambiguousFinish(color) ||
      /^(matte|satin|polished|honed|wood|quartz|metal|one quart|[\d.]+\s*(quart|gallon|oz|pack))$/i.test(
        String(color),
      ))
  )
    issues.push("Choose one exact color or an actual two-tone finish.");
  if (
    item.sizeRequired &&
    /\bor\b|options|available|\?/i.test(String(valueOf(item, "selectedSize")))
  )
    issues.push("A list of sizes is not a selected size.");
  const quantity = valueOf(item, "quantity");
  if (
    requiredAccuracyFields(item).includes("quantityBasis") &&
    (String(valueOf(item, "quantityBasis") || "").trim().length < 8 ||
      /\b(suggested|unconfirmed|placeholder|default|tbd)\b/i.test(
        String(valueOf(item, "quantityBasis")),
      ))
  )
    issues.push(
      "Quantity needs a meaningful location, layout, schedule or designer count reference.",
    );
  if (requiredAccuracyFields(item).includes("quantity") && !positive(quantity))
    issues.push("Design quantity is unknown or invalid.");
  if (quantity !== null && !ACCURACY_UNITS.includes(String(valueOf(item, "quantityUnit"))))
    issues.push("Choose an explicit design quantity unit.");
  if (
    ["each", "pair", "set", "box", "carton", "slab", "roll"].includes(
      String(valueOf(item, "quantityUnit")),
    ) &&
    positive(quantity) &&
    !Number.isInteger(quantity)
  )
    issues.push("This unit requires a whole number.");
  const labelInches = String(valueOf(item, "productName")).match(
    /\b(\d+(?:\.\d+)?)[\s-]*(?:inch|in\b|[”"])/i,
  );
  const mounting = valueOf(item, "mountingCenters");
  if (
    /pull|handle/i.test(item.category) &&
    labelInches &&
    mounting &&
    String(mounting).match(/[\d.]+/)?.[0] !== labelInches[1] &&
    !fieldConfirmed(state, item, "dimensionClarification")
  )
    issues.push(
      "Clarify advertised length versus mounting centers; they are different dimensions.",
    );
  for (const companion of item.companions) {
    if (!companion.disposition) issues.push(`Account for ${companion.label}.`);
    else if (
      !companion.actor ||
      !sourceCurrent(state, companion.source!) ||
      (companion.disposition !== "other-party" &&
        !state.rooms.flatMap((r) => r.items).some((i) => i.id === companion.parentId))
    )
      issues.push(
        `${companion.label} needs a parent/selection and evidence or named confirmation.`,
      );
  }
  for (const check of state.checks.filter((c) => c.itemId === item.id)) {
    if (accuracyCheckStatus(state, check) === "conflict")
      issues.push(`Resolve drawing conflict: ${check.field}.`);
    if (accuracyCheckStatus(state, check) === "stale")
      issues.push(`Recheck changed source or related selection: ${check.field}.`);
  }
  return [...new Set(issues)];
}
export function accuracyCheckStatus(
  state: AccuracyState,
  check: AccuracyCheck,
): "matched" | "conflict" | "unknown" | "stale" {
  if (!sourceCurrent(state, check.source)) return "stale";
  const all = state.rooms.flatMap((r) => r.items),
    item = all.find((i) => i.id === check.itemId);
  if (!item) return "unknown";
  if (
    check.dependencies.some((d) => {
      const dependency = all.find((i) => i.id === d.itemId);
      return !dependency || !same(valueOf(dependency, d.field), d.value);
    })
  )
    return "stale";
  if (check.relation === "explicit-presence")
    return item.decision?.disposition === "not-needed" ? "conflict" : "matched";
  const value = valueOf(item, check.field);
  if (!fieldConfirmed(state, item, check.field) || unresolved(check.expected)) return "unknown";
  if (check.unit && valueOf(item, `${check.field}Unit`) !== check.unit) return "unknown";
  if (check.relation === "equals") return same(value, check.expected) ? "matched" : "conflict";
  if (typeof value !== "number" || typeof check.expected !== "number") return "unknown";
  return (check.relation === "maximum" ? value <= check.expected : value >= check.expected)
    ? "matched"
    : "conflict";
}
export function quantityPurchase(state: AccuracyState, item: AccuracyItem): number | null {
  const quantity = valueOf(item, "quantity"),
    waste = valueOf(item, "wastePercent");
  if (
    !positive(quantity) ||
    !["quantity", "quantityUnit", "quantityBasis", "wastePercent"].every((k) =>
      fieldConfirmed(state, item, k),
    ) ||
    typeof waste !== "number" ||
    waste < 0 ||
    waste > 100
  )
    return null;
  if (
    !fieldConfirmed(state, item, "fieldRequired") ||
    !["yes", "no"].includes(String(valueOf(item, "fieldRequired")))
  )
    return null;
  if (valueOf(item, "fieldRequired") === "yes" && !fieldConfirmed(state, item, "fieldTakeoff"))
    return null;
  const designUnit = valueOf(item, "quantityUnit"),
    purchaseUnit = valueOf(item, "purchaseUnit");
  if (!fieldConfirmed(state, item, "purchaseUnit")) return null;
  let units = quantity * (1 + waste / 100);
  if (designUnit !== purchaseUnit) {
    const coverage = valueOf(item, "packCoverage");
    if (
      !positive(coverage) ||
      !fieldConfirmed(state, item, "packCoverage") ||
      valueOf(item, "coverageUnit") !== designUnit ||
      !fieldConfirmed(state, item, "coverageUnit")
    )
      return null;
    units /= coverage;
  }
  const increment = valueOf(item, "sellingIncrement");
  if (!positive(increment) || !fieldConfirmed(state, item, "sellingIncrement")) return null;
  return Math.ceil((units - 1e-10) / increment) * increment;
}
export function purchaseReady(state: AccuracyState, item: AccuracyItem) {
  return (
    !accuracyItemIssues(state, item).length &&
    quantityPurchase(state, item) !== null &&
    fieldConfirmed(state, item, "price") &&
    fieldConfirmed(state, item, "priceUnit") &&
    valueOf(item, "priceUnit") === valueOf(item, "purchaseUnit")
  );
}
export function accuracyProgress(state: AccuracyState, roomId?: string) {
  const rooms = roomId
    ? state.rooms.filter((r) => r.id === roomId)
    : state.agreedRooms.length
      ? state.rooms.filter((r) => state.agreedRooms.some((agreed) => agreed.id === r.id))
      : state.rooms;
  const items = rooms.flatMap((r) => r.items);
  const unresolvedItems = items.filter((i) => accuracyItemIssues(state, i).length);
  const selected = items.filter((i) => i.decision?.disposition === "select");
  const coverageConfirmed = Boolean(
    state.scopeConfirmation &&
    state.scopeConfirmation.value === scopeValue(state) &&
    sourceCurrent(state, state.scopeConfirmation.source) &&
    state.agreedRooms.length,
  );
  const missingRooms = state.agreedRooms.filter(
    (r) => !state.rooms.some((existing) => existing.id === r.id),
  );
  const checks = state.checks.filter((c) => !roomId || c.roomId === roomId);
  const incompleteCoverage = state.coverage.filter(
    (c) =>
      c.cancelled ||
      c.failed.length ||
      !c.expected.length ||
      c.expected.some((e) => !c.processed.includes(e)) ||
      state.sources.find((s) => s.id === c.sourceId)?.revision !== c.revision,
  );
  const drawing =
    !checks.length || !state.coverage.length
      ? "pending"
      : incompleteCoverage.length || checks.some((c) => accuracyCheckStatus(state, c) !== "matched")
        ? "needs-review"
        : "checked-requirements-only";
  const allocations = allocationIssues(state);
  return {
    selectedReviewed: selected.filter((i) => !accuracyItemIssues(state, i).length).length,
    selectedTotal: selected.length,
    resolved: items.length - unresolvedItems.length,
    total: items.length,
    unresolvedItems: unresolvedItems.map((i) => ({
      id: i.id,
      category: i.category,
      issues: accuracyItemIssues(state, i),
    })),
    missingRooms,
    scopeConfirmed: coverageConfirmed,
    drawing,
    incompleteCoverage,
    external: items
      .filter(
        (i) =>
          i.decision?.disposition === "other-party" ||
          (valueOf(i, "fieldRequired") === "yes" && !fieldConfirmed(state, i, "fieldTakeoff")),
      )
      .map((i) => i.id),
    procurementReady: selected.length > 0 && selected.every((i) => purchaseReady(state, i)),
    allocationIssues: allocations,
    designComplete:
      coverageConfirmed &&
      !missingRooms.length &&
      items.length > 0 &&
      !unresolvedItems.length &&
      !allocations.length,
  };
}
export function allocationIssues(state: AccuracyState) {
  const issues: string[] = [],
    installed = new Map<string, string>();
  for (const item of state.rooms.flatMap((r) => r.items)) {
    if (item.decision?.disposition !== "select") continue;
    const id = text(valueOf(item, "installationId"));
    if (id && installed.has(id))
      issues.push(`Repeated installation ${id}: associate duplicate views with one selection.`);
    if (id) installed.set(id, item.id);
  }
  const items = state.rooms.flatMap((r) => r.items);
  for (const total of items.filter((i) => valueOf(i, "quantityRole") === "shared-total")) {
    const allocations = items.filter(
      (i) =>
        valueOf(i, "sharedProductId") === total.id && valueOf(i, "quantityRole") === "allocation",
    );
    if (
      allocations.some(
        (i) =>
          valueOf(i, "quantity") === null ||
          valueOf(i, "quantityUnit") !== valueOf(total, "quantityUnit"),
      )
    )
      issues.push(`Unresolved allocations for ${total.category}.`);
    const sum = allocations.reduce(
      (n, i) =>
        n + (typeof valueOf(i, "quantity") === "number" ? Number(valueOf(i, "quantity")) : 0),
      0,
    );
    if (valueOf(total, "quantity") !== sum)
      issues.push(`Allocations do not equal shared total for ${total.category}.`);
  }
  return issues;
}
export function accuracyOutputs(state: AccuracyState): AccuracyOutput[] {
  return state.rooms.flatMap((room) =>
    room.items
      .filter(
        (item) =>
          item.decision?.disposition === "select" &&
          valueOf(item, "quantityRole") !== "shared-total",
      )
      .map((item) => ({
        sourceId: item.id,
        selectionVersion: item.version,
        roomId: room.id,
        category: item.category,
        disposition: item.decision!.disposition,
        productName: text(valueOf(item, "productName")),
        manufacturer: text(valueOf(item, "manufacturer")),
        sku: text(valueOf(item, "sku")),
        color: text(valueOf(item, "color")),
        sheen: text(valueOf(item, "sheen")),
        selectedSize: text(valueOf(item, "selectedSize")),
        customId: text(valueOf(item, "customId")),
        specification: text(valueOf(item, "specification")),
        documentation: text(valueOf(item, "documentation")),
        finishCodeOrSample: text(valueOf(item, "finishCodeOrSample")),
        location: text(valueOf(item, "location")),
        overallDimensions: text(valueOf(item, "overallDimensions")),
        mountingCenters: text(valueOf(item, "mountingCenters")),
        cutout: text(valueOf(item, "cutout")),
        installation: text(valueOf(item, "installation")),
        imageUrl: text(valueOf(item, "imageUrl")),
        url: text(valueOf(item, "url")),
        quantity: positive(valueOf(item, "quantity")) ? Number(valueOf(item, "quantity")) : null,
        quantityUnit: text(valueOf(item, "quantityUnit")),
        purchaseQuantity: quantityPurchase(state, item),
        purchaseUnit: text(valueOf(item, "purchaseUnit")),
        purchaseReady: purchaseReady(state, item),
        price: typeof valueOf(item, "price") === "number" ? Number(valueOf(item, "price")) : null,
        priceUnit: text(valueOf(item, "priceUnit")),
        notes: text(valueOf(item, "notes")),
        designResolved: !accuracyItemIssues(state, item).length,
      })),
  );
}
export function snapshotChanged(
  state: AccuracyState,
  snapshot: AccuracyState["snapshots"][number],
) {
  return (
    !same(snapshot.rows, accuracyOutputs(state)) ||
    (snapshot.agreedRooms !== undefined && !same(snapshot.agreedRooms, state.agreedRooms)) ||
    (snapshot.sources !== undefined && !same(snapshot.sources, state.sources))
  );
}
export type AccuracyCommand =
  | { type: "default"; id: string; key: string; value: AccuracyValue; source: AccuracySource }
  | { type: "inherit"; roomId: string; itemId: string; defaultId: string }
  | { type: "bind"; roomId: string; itemId: string; selectionId?: string; materialId?: string }
  | {
      type: "field";
      roomId: string;
      itemId: string;
      key: string;
      value: AccuracyValue;
      proposal?: boolean;
    }
  | { type: "confirm"; roomId: string; itemId: string; keys: string[]; source: AccuracySource }
  | {
      type: "decision";
      roomId: string;
      itemId: string;
      disposition: Disposition;
      owner?: string;
      parentId?: string;
      source?: AccuracySource;
      meravFields?: string[];
    }
  | { type: "no-tub"; roomId: string }
  | {
      type: "item";
      roomId: string;
      id: string;
      category: string;
      kind: AccuracyItem["kind"];
      sizeRequired: boolean;
    }
  | { type: "scope"; rooms: { id: string; name: string }[]; source: AccuracySource }
  | { type: "source"; source: AccuracySource }
  | {
      type: "check";
      check: Omit<AccuracyCheck, "actor" | "at" | "dependencies">;
      dependencies?: { itemId: string; field: string }[];
    }
  | { type: "coverage"; coverage: AccuracyState["coverage"][number] }
  | {
      type: "companion";
      roomId: string;
      itemId: string;
      companion: AccuracyItem["companions"][number];
    }
  | { type: "snapshot"; id: string; kind: "draft" | "design-approved" };

/** The server supplies actor/time after authorization and CAS. Client approval flags are never accepted. */
export function applyAccuracyCommand(
  current: AccuracyState,
  command: AccuracyCommand,
  actor: string,
  at: string,
): AccuracyState {
  if (!actor || !at) throw new Error("An authenticated reviewer is required.");
  const state = structuredClone(current);
  const registerSource = (source?: AccuracySource) => {
    if (validAccuracySource(source) && !state.sources.some((s) => s.id === source.id))
      state.sources.push(source);
  };
  const find = (roomId: string, itemId: string) => {
    const item = state.rooms.find((r) => r.id === roomId)?.items.find((i) => i.id === itemId);
    if (!item) throw new Error("Selection does not belong to this project and room.");
    return item;
  };
  const decide = (item: AccuracyItem, decision: Omit<AccuracyDecision, "actor" | "at">) => {
    if (item.decision) item.decisionHistory.push(item.decision);
    item.decision = { ...decision, actor, at };
    item.version++;
  };
  switch (command.type) {
    case "default": {
      if (!validAccuracySource(command.source) || command.source.kind !== "default")
        throw new Error("Default needs a versioned project default reference.");
      state.defaults = [
        ...(state.defaults ?? []).filter((d) => d.id !== command.id),
        { id: command.id, key: command.key, value: command.value, source: command.source },
      ];
      state.sources = [...state.sources.filter((s) => s.id !== command.source.id), command.source];
      break;
    }
    case "inherit": {
      const item = find(command.roomId, command.itemId),
        inherited = state.defaults?.find((d) => d.id === command.defaultId);
      if (!inherited) throw new Error("Default not found.");
      const field = item.fields[inherited.key];
      if (field?.confirmation) field.history.push(field.confirmation);
      item.fields[inherited.key] = {
        value: inherited.value,
        inheritedFrom: inherited.id,
        history: field?.history ?? [],
      };
      item.version++;
      break;
    }
    case "bind": {
      const item = find(command.roomId, command.itemId);
      if (command.selectionId) item.selectionId = command.selectionId;
      if (command.materialId) {
        if (
          state.rooms
            .flatMap((r) => r.items)
            .some((i) => i.id !== item.id && i.materialId === command.materialId)
        )
          throw new Error("This material is already associated with another selection.");
        item.materialId = command.materialId;
      }
      break;
    }
    case "field": {
      if (
        !/^[a-zA-Z][a-zA-Z0-9]{0,79}$/.test(command.key) ||
        ["constructor", "prototype", "__proto__"].includes(command.key)
      )
        throw new Error("Invalid decision field.");
      const item = find(command.roomId, command.itemId);
      const field = item.fields[command.key] ?? { value: null, history: [] };
      if (command.proposal) field.proposal = command.value;
      else if (!same(field.value, command.value)) {
        if (field.confirmation) field.history.push(field.confirmation);
        field.value = command.value;
        field.confirmation = undefined;
        field.proposal = undefined;
        field.inheritedFrom = undefined;
        item.version++;
      }
      item.fields[command.key] = field;
      break;
    }
    case "confirm": {
      const item = find(command.roomId, command.itemId);
      if (!sourceCurrent(state, command.source))
        throw new Error("Use a meaningful, current reference and revision.");
      for (const key of command.keys) {
        const field = item.fields[key];
        if (!field || unresolved(field.value))
          throw new Error(`Resolve ${key} before confirming it.`);
        if (field.confirmation) field.history.push(field.confirmation);
        field.confirmation = {
          value: field.value,
          source: command.source,
          actor,
          at,
          selectionVersion: item.version,
          selectionIdentity: fieldIdentity(item, key),
        };
      }
      if (!state.sources.some((s) => s.id === command.source.id))
        state.sources.push(command.source);
      break;
    }
    case "decision": {
      const item = find(command.roomId, command.itemId);
      if (
        command.disposition === "included" &&
        (!command.parentId || !validAccuracySource(command.source))
      )
        throw new Error("Included needs a parent and evidence.");
      decide(item, {
        disposition: command.disposition,
        owner: command.owner,
        parentId: command.parentId,
        source: command.source,
        meravFields: command.meravFields,
      });
      registerSource(command.source);
      break;
    }
    case "no-tub":
      for (const item of state.rooms.find((r) => r.id === command.roomId)?.items ?? [])
        if (/^(?:freestanding )?tub$|^tub filler$/i.test(item.category))
          decide(item, { disposition: "not-needed" });
      break;
    case "item": {
      const room = state.rooms.find((r) => r.id === command.roomId);
      if (!room) throw new Error("Room not found.");
      const item = room.items.find((i) => i.id === command.id);
      if (item) {
        item.kind = command.kind;
        item.sizeRequired = command.sizeRequired;
        item.version++;
      } else {
        if (state.rooms.some((r) => r.items.some((i) => i.id === command.id)))
          throw new Error("Selection IDs must be unique across the project.");
        room.items.push({
          ...createAccuracyItem(command.id, command.category),
          kind: command.kind,
          sizeRequired: command.sizeRequired,
        });
      }
      break;
    }
    case "scope":
      if (
        !validAccuracySource(command.source) ||
        !command.rooms.length ||
        new Set(command.rooms.map((r) => r.id)).size !== command.rooms.length
      )
        throw new Error("Confirm the agreed room scope against a brief or design decision.");
      state.agreedRooms = command.rooms;
      state.scopeConfirmation = {
        value: scopeValue(state),
        source: command.source,
        actor,
        at,
        selectionVersion: state.revision + 1,
      };
      registerSource(command.source);
      break;
    case "source": {
      if (!validAccuracySource(command.source))
        throw new Error(
          "Source needs a reference and revision; drawings also need sheet and page.",
        );
      const index = state.sources.findIndex((s) => s.id === command.source.id);
      if (index < 0) state.sources.push(command.source);
      else state.sources[index] = command.source;
      break;
    }
    case "check": {
      const item = find(command.check.roomId, command.check.itemId);
      if (!sourceCurrent(state, command.check.source))
        throw new Error("Check needs a current source citation.");
      const dependencies = [...new Set([command.check.field, "sku", "location", "selectedSize"])]
        .map((field) => ({ itemId: item.id, field }))
        .concat(command.dependencies ?? [])
        .map((d) => {
          const dependency = state.rooms.flatMap((r) => r.items).find((i) => i.id === d.itemId);
          if (!dependency) throw new Error("Dependency selection not found.");
          return { ...d, value: valueOf(dependency, d.field) };
        });
      const check = { ...command.check, dependencies, at, actor };
      state.checks = [...state.checks.filter((c) => c.id !== check.id), check];
      registerSource(check.source);
      break;
    }
    case "coverage": {
      if (command.coverage.processed.some((p) => !command.coverage.expected.includes(p)))
        throw new Error("Processed scope is outside the declared job coverage.");
      state.coverage = [
        ...state.coverage.filter((c) => c.sourceId !== command.coverage.sourceId),
        command.coverage,
      ];
      break;
    }
    case "companion": {
      const item = find(command.roomId, command.itemId);
      item.companions = [
        ...item.companions.filter((c) => c.id !== command.companion.id),
        { ...command.companion, actor, at },
      ];
      registerSource(command.companion.source);
      item.version++;
      break;
    }
    case "snapshot":
      if (command.kind === "design-approved" && !accuracyProgress(state).designComplete)
        throw new Error("Unresolved scope, design decisions or conflicts prevent design approval.");
      if (state.snapshots.some((s) => s.id === command.id))
        throw new Error("Snapshot already exists.");
      state.snapshots.push({
        id: command.id,
        kind: command.kind,
        rows: accuracyOutputs(state),
        actor,
        at,
        revision: state.revision,
        agreedRooms: structuredClone(state.agreedRooms),
        sources: structuredClone(state.sources),
        checks: structuredClone(state.checks),
      });
      break;
    default:
      throw new Error("Unsupported design decision command.");
  }
  state.revision++;
  return state;
}
