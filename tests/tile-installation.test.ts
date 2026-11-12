import { expect, it } from "vitest";
import { needsTileInstallation, reviewTileInstallation, tileDetailConfirmed, tileInstallationNote, tilePlanProofs } from "@/lib/tileInstallation";
import type { MaterialItem } from "@/lib/db";
import { cleanCompletionPlanFindings } from "@/lib/specCompletion";
const rooms = [{ id: "bath", name: "Bathroom Two" }, { id: "kitchen", name: "Kitchen" }];
const tile = (patch: Partial<MaterialItem> = {}): MaterialItem => ({
  id: "tile", project_id: "project", room_id: "bath", item_label: "Shower wall tile", client_product_name: null,
  category: "Tile & Stone", is_required: false, not_needed: false, notes: null, product_id: "product",
  product: { id: "product", name: "Tierra Basics Nieve Punto", sku: "EZTIER0520", category: "Tile", notes: null } as any,
  ...patch,
} as MaterialItem);
const review = (items: MaterialItem[], extra: any = {}) => reviewTileInstallation(items, rooms, { planStatus: "no_document", ...extra });

it("targets tile, mosaics, backsplashes and stone flooring, excluding fixtures, slabs, wood, inactive and historical options", () => {
  for (const name of ["Shower wall tile", "Herringbone mosaic", "Travertine bathroom floor", "Porcelain backsplash", "Stone pavers"])
    expect(needsTileInstallation(tile({ item_label: name })), name).toBe(true);
  for (const name of ["Tile-in shower drain", "Slab countertop", "White oak herringbone floor", "Molded brick refractory panels", "Canceled wall tile"])
    expect(needsTileInstallation(tile({ item_label: name, product: { name, category: "Tile" } as any })), name).toBe(false);
  expect(needsTileInstallation(tile({ not_needed: true }))).toBe(false);
  expect(needsTileInstallation(tile({ notes: "SUPERSEDED by plaster shower walls. Do not install this tile." }))).toBe(false);
  expect(needsTileInstallation(tile({ notes: "Hood wall tile is selected. Exclude the canceled sink/window surround." }))).toBe(true);
  expect(needsTileInstallation(tile({
    item_label: "Nieve Punto",
    category: "Materials",
  }))).toBe(true);
  expect(needsTileInstallation(tile({
    item_label: "Reno-T",
    product: { name: "Reno-T", category: "Tile", subcategory: "Trim" } as MaterialItem["product"],
  }))).toBe(false);
});
it("recognizes real past-project wording and flags only the still-missing grout width", () => {
  const r = review([tile({ notes: "vertical, rows offset, offwhite grout" })]);
  expect(r.findings.map(f => f.field)).toEqual(["grout"]);
  expect(r.findings[0].message).toContain("joint width");
  expect(r.findings[0].message).not.toContain("grout color and");
  expect(tileDetailConfirmed("tile_layout", "tile lay like example shown. off white/matching grout")).toBe(true);
  expect(tileDetailConfirmed("tile_layout", "Running bond lengthwise into zero-entry shower.")).toBe(true);
});
it("accepts selected color plus joint width, preserves independent layout when grout is pending", () => {
  expect(review([tile({ notes: 'Grout: medium greige, 1/8-inch joints. Vertical straight set.' })]).findings).toEqual([]);
  const r = review([tile({ notes: "Vertical running bond. Grout color and joint width TBD." })]);
  expect(r.findings.map(f => f.field)).toEqual(["grout"]);
  expect(tileDetailConfirmed("grout", 'Off-white grout, ⅛ inch joints')).toBe(true);
  expect(tileDetailConfirmed("grout", 'Grout off white OR match subway tile, 1/8 inch')).toBe(false);
  expect(tileDetailConfirmed("grout", 'Select off-white grout in 1/8 inch joints')).toBe(false);
  expect(tileDetailConfirmed("tile_layout", "Choose herringbone or running bond")).toBe(false);
});
it("never substitutes tile size/finish for grout color or joint width", () => {
  const r = review([tile({ notes: 'White tile, 2 x 8 inches. Grout TBD.' })]);
  expect(r.findings).toHaveLength(2);
  expect(tileDetailConfirmed("grout", 'White tile, 2 x 8 inches with medium greige grout')).toBe(false);
  expect(tileDetailConfirmed("grout", 'White tile, grout 1/8 inch')).toBe(false);
});
it("honors an explicit groutless installation instead of demanding grout on every surface", () => {
  const r = review([tile({ notes: "Dry-stack installation; no grout required." })]);
  expect(r.findings.some(f => f.field === "grout")).toBe(false);
  expect(tileInstallationNote("grout", "No grout required", null)).toBe("Grout: No grout required");
});
it("accepts a fixed mosaic pattern while checking its installed direction", () => {
  const mosaic = tile({ product: { name: "Bianco Perlino 1.5x4 Herringbone Brushed Marble Mosaic Tile" } as any });
  expect(review([mosaic]).findings.find(f => f.field === "tile_layout")?.message).toBe("Confirm tile lay direction for this tiled area.");
  expect(review([{ ...mosaic, notes: "Tile lay direction: Along the vanity wall" }]).findings.map(f => f.field)).toEqual(["grout"]);
  expect(review([tile()]).findings.map(f => f.field)).toEqual(["grout", "tile_layout"]);
});
it("checks manually entered tile selections even before a catalog product is assigned", () => {
  const manual = tile({
    item_label: "Shower wall",
    category: "Materials",
    product_id: null,
    product: null,
    notes: "Installation surface: Tile\nGrout color: Off-white\nGrout joint width: 1/8 inch\nTile layout: Running bond",
  });
  expect(review([manual]).findings.map(f => f.message)).toEqual(["Confirm tile lay direction for this tiled area."]);
  expect(needsTileInstallation({ item_label: "Shower wall tile", is_required: true })).toBe(false);
  expect(needsTileInstallation({ item_label: "Shower wall tile", is_required: false })).toBe(true);
});
it("combines decisions for the same surface across notes and a matched plan without reading nearby geometry as the direction", () => {
  const material = tile({ notes: "Grout color: Off-white\nTile layout: Running bond" });
  const planProofs = { tile: [{ text: 'VERTICAL PLUMBING CHASE\nGROUT JOINT WIDTH: 1/8 inch', source: "plans", page: 1, sheet: "ID79" }] };
  const missing = review([material], { planProofs });
  expect(missing.findings.map(f => f.message)).toEqual(["Confirm tile lay direction for this tiled area."]);
  expect(missing.covered[0].evidence.map(p => p.source)).toEqual(["notes", "plans"]);
  planProofs.tile[0].text += "\nTILE LAY DIRECTION: Along the vanity wall";
  expect(review([material], { planProofs }).findings).toEqual([]);
});
it("checks only linked board notes, preserving room and product boundaries", () => {
  const board = { pages: [{ id: "page", elements: [
    { materialItemId: "tile", materialRoomId: "bath", notes: 'Vertical straight set. Grout: off-white, 1/8 inch joints.' },
    { materialItemId: "other", notes: "Horizontal running bond" },
  ] }] };
  expect(review([tile()], { board }).findings).toEqual([]);
  board.pages[0].elements[0].materialRoomId = "kitchen";
  expect(review([tile()], { board }).findings).toHaveLength(2);
});
it("does not use grout from another room or spread an unscoped shower selection over the floor", () => {
  const grout = tile({ id: "grout", item_label: "Grout", color: "Off-white", notes: '1/8 inch grout joints', product: null });
  expect(review([tile(), grout]).findings.map(f => f.field)).toEqual(["tile_layout"]);
  expect(review([tile(), { ...grout, room_id: "kitchen" }]).findings).toHaveLength(2);
  const floor = tile({ id: "floor", item_label: "Bathroom floor tile" });
  const scoped = { ...grout, item_label: "Shower grout", notes: 'Shower grout: off-white, 1/8 inch joints' };
  expect(review([tile(), floor, scoped]).findings.filter(f => f.item_id === "floor").map(f => f.field)).toContain("grout");
});
it("checks directly matched construction callouts before creating missing-detail findings", () => {
  const pages = [{ page: 1, text: 'BATH 2 - SHOWER WALL\nTIERRA BASICS NIEVE PUNTO\nSKU: EZTIER0520\nSIZE: 2 X 8\nINSTALL: VERTICAL STRAIGHT SET\nGROUT: OFF WHITE, 1/8 INCH JOINTS\nID79' }];
  const proofs = tilePlanProofs([tile()], rooms, pages);
  expect(proofs.tile?.[0].page).toBe(1);
  const r = review([tile()], { pages, document: { id: "doc", title: "Latest drawings", updated_at: "now" }, planStatus: "checked" });
  expect(r.findings).toEqual([]);
  expect(r.covered.every(f => f.evidence.some(p => p.source === "plans"))).toBe(true);
});
it("does not borrow another room's construction details, and marks unreadable/unmatched callouts as unverified", () => {
  const pages = [{ page: 1, text: 'KITCHEN ELEVATION\nTIERRA BASICS NIEVE PUNTO\nSKU: EZTIER0520\nGROUT: BLACK 1/8 INCH\nINSTALL: HORIZONTAL STACKED\nID1' }];
  const r = review([tile(), tile({ id: "k-tile", room_id: "kitchen" })], { pages, document: { id: "doc" }, planStatus: "unavailable" });
  expect(r.findings.filter(f => f.item_id === "tile")).toHaveLength(2);
  expect(r.unverified.some(f => f.item_id === "tile")).toBe(true);
});
it("honors explicit all-tile drawing notes within their stated room/surface scope", () => {
  const floor = tile({ id: "floor", item_label: "Bathroom floor tile" });
  const pages = [{ page: 1, text: 'BATH 2 - ELEVATION\nALL WALL TILE: VERTICAL STRAIGHT SET\nGROUT: OFF WHITE, 1/8 INCH JOINTS\nID79' }];
  const r = review([tile(), floor], { pages, planStatus: "checked", document: { id: "doc" } });
  expect(r.findings.filter(f => f.item_id === "tile")).toEqual([]);
  expect(r.findings.filter(f => f.item_id === "floor")).toHaveLength(2);
});
it("saves project-specific installation notes without changing other notes or catalog products", () => {
  const notes = 'Keep pencil trim.\nGrout: outdated\nTile layout: Vertical straight set';
  expect(tileInstallationNote("grout", 'Warm grey, 1/8 inch joints', notes)).toBe('Keep pencil trim.\nTile layout: Vertical straight set\nGrout: Warm grey, 1/8 inch joints');
  expect(() => tileInstallationNote("grout", "TBD", notes)).toThrow();
  expect(() => tileInstallationNote("tile_layout", "TBD", notes)).toThrow();
  expect(() => tileInstallationNote("tile_layout", "Running bond", notes)).toThrow();
  expect(() => tileInstallationNote("tile_layout", "Vertical", notes)).toThrow();
  expect(tileInstallationNote("tile_layout", "Per approved drawing ID79", "Keep trim.\nTile layout: TBD\nTile lay direction: TBD"))
    .toBe("Keep trim.\nTile layout: Per approved drawing ID79");
  expect(tileDetailConfirmed("grout", tileInstallationNote("grout", "MAPEI Avalanche, 1/8 inch joints", "Grout color: TBD\nGrout joint width: TBD"))).toBe(true);
  expect(tileDetailConfirmed("grout", "Grout: MAPEI, 1/16 inch joints")).toBe(false);
  expect(tileInstallationNote("grout", "Ivory, 1/8 inch joints", "Grout: Off-white, 1/8 inch joints. Vertical straight set."))
    .toBe("Vertical straight set.\nGrout: Ivory, 1/8 inch joints");
});
it("does not duplicate installation findings as generic missing catalog items in the AI plan review", () => {
  const row = { room_id: "bath", item_id: null, field: "missing_item", confidence: "high", page: 1, sheet: "ID79",
    evidence: "Grout and tile layout are shown in the tile callout.", confirmed_missing: true };
  expect(cleanCompletionPlanFindings([{ ...row, item_label: "Grout for shower tile" }, { ...row, item_label: "Tile layout" }], [tile()], rooms, 1)).toEqual([]);
});
