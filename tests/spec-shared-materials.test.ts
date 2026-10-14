import { expect, it } from "vitest";
import type { MaterialItem } from "@/lib/db";
import { checkSpecDetails, cleanCompletionPlanFindings } from "@/lib/specCompletion";
import { sharedCompletionContext, sharedCompletionCoversMissing } from "@/lib/specSharedMaterials";

const rooms = [{ id: "shared", name: "Materials Throughout" },
  { id: "primary", name: "Primary Bathroom" }, { id: "bath2", name: "Bedroom 2 Bathroom" },
  { id: "bath1", name: "Bathroom One" }, { id: "bath3", name: "Bathroom Three" },
  { id: "powder", name: "Powder Bathroom" }, { id: "casita", name: "Casita Bathroom" },
  { id: "kitchen", name: "Kitchen" }];
const material = (patch: Partial<MaterialItem> = {}) => ({ id: "shared-sinks", room_id: "shared",
  item_label: "bathroom sinks", category: "Plumbing", product_id: "caxton", not_needed: false,
  is_required: false, quantity: 5, quantity_unit: "count", color: "White",
  product: { id: "caxton", name: "Kohler Caxton Bathroom Sink", price: "$200", price_unit: "unit",
    product_url: "https://retailer.test/caxton?uid=white" }, ...patch } as MaterialItem);
const missing = (label = "Sink", room_id = "bath2") => ({ room_id, item_id: null, item_label: label,
  field: "missing_item", confidence: "high", page: 2, evidence: "The complete proposed bathroom shows a sink.", confirmed_missing: true });

it("uses shared bathroom sinks and toilets to cover blank room templates, including the casita", () => {
  const selected = [material(), material({ id: "toilets", item_label: "toilets", product_id: "toilet",
    product: { id: "toilet", name: "Kohler Toilet" } as MaterialItem["product"] })];
  expect(cleanCompletionPlanFindings([missing(), missing("Bathroom Sink", "casita"), missing("Toilet")], selected, rooms, 29)).toEqual([]);
  expect(sharedCompletionCoversMissing(selected, rooms, "kitchen", "Kitchen Sink")).toBe(false);
  expect(sharedCompletionCoversMissing(selected, rooms, "bath2", "Toilet Paper Holder")).toBe(false);
});

it("does not use removed/untouched shared placeholders or a different room's selection as coverage", () => {
  for (const items of [[material({ not_needed: true })],
    [material({ is_required: true, product_id: null, product: null, quantity: null, color: null })],
    [material({ room_id: "primary" })]]) {
    expect(cleanCompletionPlanFindings([missing()], items, rooms, 29)).toHaveLength(1);
  }
  expect(sharedCompletionCoversMissing([material()], rooms, "shared", "Sink")).toBe(false);
});

it("recognizes whole-house flooring and paint without covering shower floors or cabinet paint", () => {
  const floor = material({ item_label: "Flooring", category: "Flooring", product_id: "wood",
    product: { name: "Provenza Delight Hardwood" } as MaterialItem["product"] });
  const paint = material({ id: "paint", item_label: "wall ceiling doors trim paint", category: "Paint",
    product: { name: "Greek Villa paint" } as MaterialItem["product"] });
  expect(sharedCompletionCoversMissing([floor, paint], rooms, "bath2", "Flooring")).toBe(true);
  expect(sharedCompletionCoversMissing([floor, paint], rooms, "bath2", "Paint")).toBe(true);
  expect(sharedCompletionCoversMissing([floor, paint], rooms, "bath2", "Shower floor tile")).toBe(false);
  expect(sharedCompletionCoversMissing([floor, paint], rooms, "bath2", "Floor tile")).toBe(false);
  expect(sharedCompletionCoversMissing([floor, paint], rooms, "bath2", "Cabinet paint")).toBe(false);
});

it("checks shared selection details once and includes shared appliances without confusing lighting types", () => {
  const shared = material(); shared.product = { ...shared.product!, price: null };
  expect(checkSpecDetails([shared], rooms).filter(row => row.field === "price")).toHaveLength(1);
  const lights = material({ item_label: "Recessed lights", category: "Lighting",
    product: { name: "Recessed ceiling lights" } as MaterialItem["product"] });
  expect(sharedCompletionCoversMissing([lights], rooms, "bath2", "Sconce")).toBe(false);
  const applianceRooms = [...rooms, { id: "appliances", name: "Appliances Throughout" }];
  const appliance = material({ room_id: "appliances", item_label: "Dishwasher" });
  expect(sharedCompletionCoversMissing([appliance], applianceRooms, "kitchen", "Dishwasher")).toBe(true);
});

const local = [material({ id: "powder-sink", room_id: "powder", item_label: "Sink", quantity: 1 }),
  material({ id: "bath2-sink", room_id: "bath2", item_label: "Sink", quantity: 1 })];
const allocation = { room_id: "shared", item_id: "shared-sinks", field: "quantity", confidence: "high",
  page: 2, evidence: "Complete proposed main-house and casita plans show seven sinks of this selected variant.",
  exact_material_match: true, count_scope: "exact_material", quantity: 7, quantity_unit: "count",
  allocation_scope_complete: true, quantity_allocations: [
    { room_id: "primary", quantity: 2 }, { room_id: "powder", quantity: 1 },
    { room_id: "bath2", quantity: 1 }, { room_id: "casita", quantity: 1 },
    { room_id: "bath1", quantity: 1 }, { room_id: "bath3", quantity: 1 },
  ] };

it("computes the shared remainder after separately selected copies, rather than double-counting seven plus two", () => {
  const items = [material({ quantity: 1 }), ...local];
  const result = cleanCompletionPlanFindings([allocation], items, rooms, 29);
  expect(result[0]).toMatchObject({ room_id: "shared", item_id: "shared-sinks", suggested: "5 count" });
  expect(result[0].message).toContain("room-specific selections");
  expect(cleanCompletionPlanFindings([allocation], [material(), ...local], rooms, 29)).toEqual([]);
  expect(cleanCompletionPlanFindings([allocation], [material({ quantity: 1 }), local[0],
    { ...local[1], item_label: "Unlabeled Item" }], rooms, 29)[0].suggested).toBe("5 count");
  expect(sharedCompletionContext(items, rooms)[0].room_selections).toEqual(local.map(item => ({
    item_id: item.id, room_id: item.room_id, quantity: 1, quantity_tbd: false, quantity_unit: "count", same_variant: true,
  })));
});

it("requires a complete non-duplicated shared allocation and resolved exact variants before changing shared quantities", () => {
  for (const patch of [
    { allocation_scope_complete: false }, { quantity_allocations: null },
    { quantity_allocations: allocation.quantity_allocations.slice(0, 2) },
    { quantity_allocations: [...allocation.quantity_allocations, allocation.quantity_allocations[0]] },
    { quantity_allocations: [{ room_id: "shared", quantity: 7 }] },
    { quantity_allocations: [{ room_id: "unknown", quantity: 7 }] },
    { quantity_allocations: [{ room_id: "powder", quantity: 0.5 }] },
  ]) expect(cleanCompletionPlanFindings([{ ...allocation, ...patch }], [material({ quantity: 1 }), ...local], rooms, 29)).toEqual([]);
  for (const patch of [{ quantity_tbd: true }, { quantity: null }, { quantity: 2 }, { color: "Black" },
    { product_id: "other", product: { name: "Other bathroom sink", product_url: "https://retailer.test/other" } as MaterialItem["product"] }]) {
    expect(cleanCompletionPlanFindings([allocation], [material({ quantity: 1 }), local[0], { ...local[1], ...patch }], rooms, 29)).toEqual([]);
  }
  expect(cleanCompletionPlanFindings([allocation], [material({ quantity: 1 }), material({ id: "second-shared" }), ...local], rooms, 29)).toEqual([]);
});

it("matches duplicate catalog records only when the exact URL variant and confirmed finish/size agree", () => {
  const copy = material({ ...local[0], product_id: "catalog-copy", product_url: "https://retailer.test/caxton?uid=white&utm_source=board" });
  expect(sharedCompletionContext([material(), copy], rooms)[0].room_selections[0].same_variant).toBe(true);
  copy.product_url = "https://retailer.test/caxton?uid=black";
  expect(sharedCompletionContext([material(), copy], rooms)[0].room_selections[0].same_variant).toBe(false);
  copy.product_id = "caxton";
  expect(sharedCompletionContext([material(), copy], rooms)[0].room_selections[0].same_variant).toBe(false);
});
