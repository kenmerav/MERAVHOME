import { expect, it } from "vitest";
import { inferMaterialCategory, normalizeItemCategory, productDisplayCategory, productMatchesItemCategory, toProductCategory } from "@/lib/roomTemplates";

it.each(["Cabinet Knob", "Drawer Pull", "Drawer Slide", "Cabinet Door Hinge", "Cabinet Latch", "Cupboard Latch", "Appliance Pull", "Bin Pull", "Knob", "Cabinet Hardware"])("groups %s with cabinetry", name => {
  expect(inferMaterialCategory(name)).toBe("Cabinetry");
  const product = { category: "Hardware", name };
  expect(productDisplayCategory(product)).toBe("Cabinetry");
  expect(productMatchesItemCategory(product, "Cabinetry")).toBe(true);
  expect(productMatchesItemCategory(product, "Hardware")).toBe(false);
});
it.each(["Cabinet Pulls", "Cabinet Knobs", "Cabinet Hinges", "Cabinet Latches", "Appliance Pulls", "Cabinetry", "Cabinetry & Hardware"])("recognizes catalog %s even with a model-only name", subcategory => {
  expect(productDisplayCategory({ category: "Hardware", name: "TK825PN", subcategory })).toBe("Cabinetry");
});
it.each([
  ["Privacy Door Knob", "Doors Base & Case"],
  ["Passage Door Lever", "Doors Base & Case"],
  ["Door Latch", "Doors Base & Case"],
  ["Shower Door Pull", "Hardware"],
  ["Toilet Paper Holder", "Hardware"],
  ["Towel Ring", "Hardware"],
  ["Pull-Down Kitchen Faucet", "Plumbing"],
  ['Delta 4" Tile-In Round Shower Drain', "Plumbing"],
  ["Over sink/window light", "Lighting"],
  ["Medicine Cabinet", "Accent Mirrors"],
  ["Cabinetry color for island", "Cabinetry"],
  ["Trim and Door Paint", "Paint"],
])("keeps %s in %s", (name, expected) => expect(inferMaterialCategory(name)).toBe(expected));
it("recognizes a slab shower surround without classifying marble tiles as countertops", () => {
  expect(inferMaterialCategory("Shower wall surround", "https://vendor.test/quartz-countertops/white/")).toBe("Countertops");
  expect(inferMaterialCategory("Marble mosaic wall tile")).toBe("Tile & Stone");
});
it.each([
  ["Cabinetry & Hardware", "Cabinetry", "Hardware"],
  ["Doors, Base, Case", "Doors Base & Case", "Hardware"],
  ["TIle & Stone", "Tile & Stone", "Tile"],
])("normalizes the legacy category %s before saving catalog items", (old, category, strict) => {
  expect(normalizeItemCategory(old)).toBe(category);
  expect(toProductCategory(old)).toBe(strict);
});
it("keeps a model-only door catalog entry in the reviewed door group",()=>{
  expect(productDisplayCategory({category:"Hardware",subcategory:"Doors Base & Case",name:'Monroe Interior 1-3/8" Hollow Core'})).toBe("Doors Base & Case");
});
