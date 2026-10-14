import { expect, it } from "vitest";
import { checkSpecDetails, cleanCompletionPlanFindings, hasCompletionValue, needsCompletionDimensions, needsCompletionPrice, needsCompletionPriceUnit } from "@/lib/specCompletion";
import type { MaterialItem } from "@/lib/db";

const rooms = [{ id: "bath", name: "Guest Bathroom" }];
const item = (patch: Partial<MaterialItem> = {}) => ({ id: "sink", room_id: "bath", item_label: "Sink", category: "Plumbing",
  quantity: 1, quantity_unit: "count", is_required: false, product_id: "product", color: "White", not_needed: false,
  product: { id: "product", name: "Selected Sink", dimensions: "20 x 15 x 8 in", price: "$200.00", price_unit: "unit", product_url: "https://retailer.test/sink" },
  ...patch } as MaterialItem);
const quantity = { room_id: "bath", item_id: "sink", field: "quantity", confidence: "high", page: 2, sheet: "ID1",
  evidence: "Complete proposed vanity elevation shows two identical selected sinks.", exact_material_match: true,
  quantity: 2, quantity_unit: "count", count_scope: "exact_material" };

it("flags gaps including placeholders and TBD without treating a default quantity as plan-verified", () => {
  const gaps = checkSpecDetails([item({ quantity_tbd: true, color: "TBD", product_url: "bad", product: null, product_id: null })], rooms);
  expect(gaps.map(row => row.field)).toEqual(["quantity", "product", "color", "price", "link"]);
  expect(checkSpecDetails([item()], rooms)).toEqual([]);
  expect(cleanCompletionPlanFindings([quantity], [item()], rooms, 14)[0].suggested).toBe("2 count");
});
it("handles selected placeholders hidden from the Spec Book but ignores untouched required and removed items", () => {
  const items = [item({ product: null, product_id: null, is_required: true, quantity: null, color: null }),
    item({ id: "removed", not_needed: true }), item({ id: "selected", product: null, product_id: null, quantity_tbd: true })];
  expect(checkSpecDetails(items, rooms).every(row => row.item_id === "selected")).toBe(true);
});
it("accepts a useful finish and zero price and identifies obvious price units without a confirmation", () => {
  const finish = item(); finish.color = null; finish.product!.finish = "Matte Black"; finish.product!.price = "$0.00";
  expect(checkSpecDetails([finish], rooms)).toEqual([]);
  finish.product!.price_unit = null;
  expect(checkSpecDetails([finish], rooms)).toEqual([]);
  finish.item_label = "Floor tile"; finish.category = "Tile & Stone"; finish.product!.name = "Marble mosaic";
  finish.product!.product_url = "https://retailer.test/marble-mosaic";
  expect(checkSpecDetails([finish], rooms).map(row => row.field)).toEqual(["price_unit"]);
});
it.each(["TBD", "Not specified", "n/a", "—", "unknown", "pending", ""])("recognizes unresolved value %s", value => {
  expect(hasCompletionValue(value)).toBe(false);
});
it("flags invalid quantities, ambiguous price ranges and invalid links", () => {
  const bad = item({ quantity: 1.5, product_url: "javascript:alert(1)" }); bad.product!.price = "$100 - $200";
  expect(checkSpecDetails([bad], rooms).map(row => row.field)).toEqual(["quantity", "price", "link"]);
});
it.each([
  ["Countertops", "Quartz countertop"], ["Paint", "Wall paint"], ["Cabinetry", "Cabinetry finish"],
  ["Hardware", "Kitchen cabinet"], ["Tile & Stone", "Honed granite backsplash + counter"],
  ["Doors Base & Case", "Whole house paint and trim"], ["Treatment", "Roman clay"],
])("accepts missing pricing for %s / %s", (category, label) => {
  const material = item({ category, item_label: label });
  material.product = { ...material.product, name: label, category: "Decor", price: null, price_unit: null } as MaterialItem["product"];
  for (const price of [null, "", "TBD", "Contact for quote"]) {
    material.product!.price = price;
    expect(needsCompletionPrice(material)).toBe(false);
    expect(needsCompletionPriceUnit(material)).toBe(false);
    expect(checkSpecDetails([material], rooms).some(row => ["price", "price_unit"].includes(row.field))).toBe(false);
  }
});
it("still requires prices for cabinet hardware and ordinary purchased items while countertop ranges are optional", () => {
  for (const [category, label] of [["Cabinetry", "Cabinet knob"], ["Plumbing", "Faucet"], ["Lighting", "Painted metal lamp"]]) {
    const material = item({ category, item_label: label });
    material.product = { ...material.product, name: label, price: null } as MaterialItem["product"];
    expect(needsCompletionPrice(material)).toBe(true);
  }
  const quote = item({ category: "Countertops", item_label: "Countertop" });
  quote.product!.name = "Quartz countertop";
  quote.product!.product_url = "https://vendor.test/quartz-countertops/white/";
  quote.product!.price = "$100–$200";
  expect(needsCompletionPrice(quote)).toBe(false);
});
it.each([null, "", "TBD", "Contact for quote", "$50-$60", "$100–$200", "$0.00", "$60.00"])("never requires countertop pricing or price basis for %s", price => {
  const counter = item({ item_label: "Counter top", category: "Other", product: { name: "Quartz slab", price, price_unit: null, product_url: "https://vendor.test/products/slab/quartz/" } as any });
  expect(needsCompletionPrice(counter)).toBe(false); expect(needsCompletionPriceUnit(counter)).toBe(false);
  expect(checkSpecDetails([counter], rooms).some(row => ["price", "price_unit"].includes(row.field))).toBe(false);
});
it("continues requiring prices for countertop fixtures while ignoring AI countertop price suggestions", () => {
  const faucet = item({ item_label: "Countertop Faucet", category: "Countertops" }); faucet.product!.name = "Faucet"; faucet.product!.price = null;
  expect(needsCompletionPrice(faucet)).toBe(true);
  const counter = item({ item_label: "Countertop", category: "Countertops" }); counter.product!.name = "Quartz countertop";
  counter.product!.product_url = "https://vendor.test/quartz-countertops/white/";
  expect(cleanCompletionPlanFindings([{ ...quantity, field: "price", explicit_specification: true, value: "$250", price_unit: "sq_ft", currency: "USD" }], [counter], rooms, 14)).toEqual([]);
});
it("recognizes a countertop slab used as a shower surround from its linked product type", () => {
  const surround = item({ item_label: "Lower Surround of Shower", category: "Plumbing", product_url: "https://www.msisurfaces.com/quartz-countertops/calacatta-aravine-quartz/" });
  surround.product = { ...surround.product, name: "Calacatta Aravine", price: null } as MaterialItem["product"];
  expect(needsCompletionPrice(surround)).toBe(false);
});
it.each([{ ...quantity, room_id: "other" }, { ...quantity, item_id: "other" }, { ...quantity, page: 15 },
  { ...quantity, page: 0 }, { ...quantity, evidence: "" }, { ...quantity, confidence: "medium" },
  { ...quantity, exact_material_match: false }, { ...quantity, count_scope: "whole_room" },
  { ...quantity, quantity: 1.5 }, { ...quantity, quantity: 0 }])("rejects unsupported plan quantity %j", row => {
  expect(cleanCompletionPlanFindings([row], [item()], rooms, 14)).toEqual([]);
});
it("requires explicit areas, respects quantity units and omits matching quantities", () => {
  const area = { ...quantity, quantity: 120.5, quantity_unit: "square_feet" };
  expect(cleanCompletionPlanFindings([area], [item()], rooms, 14)).toEqual([]);
  expect(cleanCompletionPlanFindings([{ ...area, explicit_area: true }], [item()], rooms, 14)[0].suggested).toBe("120.5 sq ft");
  expect(cleanCompletionPlanFindings([{ ...quantity, quantity: 1 }], [item()], rooms, 14)).toEqual([]);
  expect(cleanCompletionPlanFindings([quantity, { ...quantity, quantity: 3 }], [item()], rooms, 14)).toEqual([]);
});
it("requires explicit specifications and USD price basis; never invents absent details", () => {
  const color = { ...quantity, field: "color", value: "Black" };
  expect(cleanCompletionPlanFindings([color], [item()], rooms, 14)).toEqual([]);
  expect(cleanCompletionPlanFindings([{ ...color, explicit_specification: true }], [item()], rooms, 14)[0].suggested).toBe("Black");
  const price = { ...color, field: "price", explicit_specification: true, value: "$250" };
  expect(cleanCompletionPlanFindings([price], [item()], rooms, 14)).toEqual([]);
  expect(cleanCompletionPlanFindings([{ ...price, price_unit: "unit", currency: "USD" }], [item()], rooms, 14)[0].suggested).toBe("$250 / unit");
});
it("does not suggest duplicate hooks/lighting, excluded items or sink drains", () => {
  const missing = (label: string) => ({ ...quantity, field: "missing_item", item_id: null, item_label: label, confirmed_missing: true });
  const items = [item({ item_label: "Hooks" }), item({ id: "light", category: "Lighting", item_label: "Vanity light" }),
    item({ id: "excluded", item_label: "Shower Drain", not_needed: true })];
  expect(cleanCompletionPlanFindings([missing("Towel Hook"), missing("Robe Hook"), missing("Ceiling Light"), missing("Pendant"), missing("Shower Drain"), missing("Sink Drain")], items, rooms, 14)).toEqual([]);
  expect(cleanCompletionPlanFindings([missing("Mirror")], items, rooms, 14)[0].item_id).toBeNull();
});
it("accepts explicitly dimensioned objects with units and labels the planned size separately from product specifications", () => {
  const mirror = item({ item_label: "Mirror", product: { ...item().product!, dimensions: null, size_options: ['24 x 36 in', '30 x 36 in'] } });
  const dimensions = { ...quantity, field: "dimensions", explicit_specification: true,
    dimension_scope: "proposed_layout", conflicting_dimensions: false, value: 'Width: 30 in; Height: 36 in',
    evidence: 'The identified mirror in the guest-bath elevation has explicit 30-inch width and 36-inch height callouts.' };
  const rows = cleanCompletionPlanFindings([dimensions], [mirror], rooms, 14);
  expect(rows[0]).toMatchObject({ field: "dimensions", dimension_scope: "proposed_layout", suggested: dimensions.value, page: 2 });
  expect(cleanCompletionPlanFindings([{ ...dimensions, value: 'Width: 30 in (height unspecified)' }], [mirror], rooms, 14)[0].suggested).toContain("height unspecified");
  for (const patch of [{ explicit_specification: false }, { conflicting_dimensions: true }, { dimension_scope: null },
    { value: '30 x 36' }, { value: 'standard size' }, { exact_material_match: false }, { page: 15 }])
    expect(cleanCompletionPlanFindings([{ ...dimensions, ...patch }], [mirror], rooms, 14)).toEqual([]);
});
it("only asks for an unresolved size choice, not dimensions on every product", () => {
  const missing = item({ product: { ...item().product!, dimensions: null } });
  expect(needsCompletionDimensions(missing)).toBe(false);
  expect(checkSpecDetails([missing], rooms).some(row => row.field === "dimensions")).toBe(false);
  missing.product!.size_options = ["Small", "Large"];
  expect(needsCompletionDimensions(missing)).toBe(true);
  missing.product!.selected_size = "Large";
  expect(needsCompletionDimensions(missing)).toBe(false);
  missing.product!.selected_size = "TBD";
  missing.product!.size_options = ['24 in', ' 24 IN ', 'TBD'];
  expect(needsCompletionDimensions(missing)).toBe(false);
});
it("does not add blanket plan dimension gaps but permits an explicitly requested dimension search", () => {
  const mirror = item({ item_label: "Mirror", product: { ...item().product!, dimensions: null } });
  const dimension = { ...quantity, field: "dimensions", explicit_specification: true, dimension_scope: "proposed_layout",
    conflicting_dimensions: false, value: 'Width: 30 in' };
  expect(cleanCompletionPlanFindings([dimension], [mirror], rooms, 14)).toEqual([]);
  expect(cleanCompletionPlanFindings([dimension], [mirror], rooms, 14, true)[0].suggested).toBe('Width: 30 in');
});
