import { expect, it } from "vitest";
import { planSpecBoardSync, specBoardSelectionEvidence } from "@/lib/specBoardSync";
const project = "527d1356-919b-48b9-877e-1924c766282b";
const room = "0033186c-a2e6-417f-a50f-37f5390f5cf5";
const itemId = "89863790-1b55-4a90-a9fe-0ec3a11f0b0d";
const productId = "64f674d2-01d1-45bc-8fe5-8c6a24e66c9c";
const product: any = { id: productId, name: "Kohler Sink", finish: "White", price: "$100", dimensions: "20 in", category: "Plumbing", product_url: "https://vendor.example/sink?uid=1", image_url: "https://vendor.example/sink.jpg" };
const material = (patch: any = {}): any => ({ id: itemId, project_id: project, room_id: room, item_label: "bathroom sinks", category: "Plumbing", quantity: 7, quantity_unit: "count", quantity_tbd: false, not_needed: false, is_required: false, sort_order: 1, product_id: productId, product_url: product.product_url, product, ...patch });
const layer = (patch: any = {}) => ({ id: "sink-layer", type: "image", label: "bathroom sinks", materialRoomId: room, src: product.image_url, link: product.product_url, productId, materialQuantity: 1, x: 410, y: 220, width: 230, height: 120, imageCropZoom: 2, notes: "Designer note", ...patch });
const board = (layers: any[] = [layer()], patch: any = {}) => ({ pages: [{ id: "shared", title: "Materials Throughout", roomId: room, elements: layers }], comments: [{ text: "Keep comment" }], presentationSlideOrder: ["shared"], customFutureSetting: 123, ...patch });
const run = (state: any, items: any[] = [], importSelections = true) => planSpecBoardSync(project, state, items, [{ id: room, name: "Materials Throughout" }], [product], () => itemId, importSelections);

it("sends the board one way without adding Materials selections or replacing board details", () => {
  const state = board([layer({ materialItemId: itemId, src: "https://board.example/cutout.png" })]);
  const result = run(state, [material()]);
  expect(result.inserts).toEqual([]);
  expect(result.state.pages).toHaveLength(1);
  expect(result.state.pages[0].elements[0]).toEqual(state.pages[0].elements[0]);
  expect(result.state.comments).toEqual(state.comments); expect(result.state.customFutureSetting).toBe(123);
  expect(result.updates.some(u => "quantity" in u.patch)).toBe(false);
  expect(run(result.state, [material()]).changed).toBe(false);
});
it("imports included board selections with exact source references, image and variant URL", () => {
  const result = run(board([layer({ materialQuantity: null })]));
  expect(result.inserts).toHaveLength(1);
  expect(result.inserts[0]).toMatchObject({ id: itemId, project_id: project, source_board_page_id: "shared", source_board_element_id: "sink-layer", image_url: product.image_url, product_url: product.product_url, quantity: null, quantity_tbd: true });
  expect(result.state.pages[0].elements[0].materialItemId).toBe(itemId);
  expect(run(result.state, result.inserts).inserts).toHaveLength(0);
});
it("preserves deliberate removals and skips excluded, hidden and declined alternatives", () => {
  const result = run(board([layer({ materialExcludeFromMaterials: true, materialItemId: itemId })]), [material({ not_needed: true })]);
  expect(result.inserts).toEqual([]); expect(result.summary.added).toBe(0); expect(result.updates).toEqual([]);
  const hidden: any = board(); hidden.pages[0].hidden = true;
  expect(run(hidden).inserts).toEqual([]);
  const declined: any = board(); declined.pages[0].roomApprovalStatus = "declined";
  expect(run(declined).inserts).toEqual([]);
  expect(run(board([layer({ materialItemId: itemId })]), [material({ not_needed: true })]).updates).toEqual([]);
});
it("keeps manual Materials selections even if they have no image and never creates Material updates pages", () => {
  const original = board([]);
  const result = run(original, [material({ product: { ...product, image_url: null } })]);
  expect(result.summary.added).toBe(0); expect(result.state.pages).toHaveLength(1);
  expect(result.state.pages[0].elements).toEqual([]); expect(result.updates).toEqual([]);
});
it("sends a changed board variant to its material before the scrape and clears an old unrelated catalog link", () => {
  const state = board([layer({ materialItemId: itemId, link: "https://vendor.example/sink?uid=2" })]);
  const result = run(state, [material()]);
  expect(result.summary.issues).toEqual([]);
  expect(result.updates[0].patch).toMatchObject({ product_url: "https://vendor.example/sink?uid=2", product_id: null, scrape_status: "pending" });
  expect(result.state.pages[0].elements[0].link).toContain("uid=2");
});
it("flags an ordered product replacement instead of erasing its history", () => {
  const result = run(board([layer({ materialItemId: itemId, link: "https://vendor.example/sink?uid=2" })]), [material({ ordered: true })]);
  expect(result.summary.issues[0].message).toContain("ordered material");
  expect(result.updates).toEqual([]);
});
it("imports labeled items without a retailer link so their missing details can be checked in the actual Spec Book", () => {
  const result = run(board([layer({ productId: null, link: "" })]));
  expect(result.inserts[0].product_url).toBeNull();
  expect(result.summary.issues[0].message).toContain("no product link");
  expect(run(board([layer({ materialRoomId: "wrong" })])).summary.issues[0].message).toContain("room");
  expect(run(board([layer({ label: "", productName: "" })])).summary.issues[0].message).toContain("label");
});
it("uses the prior send snapshot to apply new board edits while preserving unchanged Materials corrections", () => {
  const state: any = board([layer({ materialItemId: itemId })]);
  const first = run(state, [material({ notes: "Manual note", image_url: product.image_url })]);
  const next: any = structuredClone(first.state);
  next.pages[0].elements[0].materialQuantity = 9;
  next.pages[0].elements[0].materialFinish = "Black";
  const result = run(next, [material({ notes: "Manual note", image_url: product.image_url })]);
  expect(result.updates[0].patch).toMatchObject({ quantity: 9, color: "Black" });
  expect(result.updates[0].patch.notes).toBeUndefined(); expect(result.updates[0].patch.quantity_unit).toBeUndefined();
  expect(result.state.pages[0].elements[0].materialQuantity).toBe(9);
});
it("keeps quantity seven when a shared board quantity has not changed since the last send", () => {
  const first = run(board([layer({ materialItemId: itemId })]), [material()]);
  expect(run(first.state, [material()]).updates.some(u => "quantity" in u.patch)).toBe(false);
});
it("preserves a catalog replacement when the previous board selection has not changed", () => {
  const first = run(board([layer({ materialItemId: itemId })]), [material()]);
  const replacement = material({ product_id: "replacement", product_url: "https://vendor.example/new-sink", color: "Black", notes: "Designer note", image_url: product.image_url, product: { ...product, id: "replacement", finish: "Black" } });
  const result = run(first.state, [replacement]);
  expect(result.updates).toEqual([]);
  expect(result.summary.issues).toEqual([]);
  const edited = structuredClone(first.state);
  edited.pages[0].elements[0].link = "https://vendor.example/sink?uid=3";
  expect(run(edited, [replacement]).updates[0].patch.product_url).toContain("uid=3");
});
it("includes a newly duplicated board fixture in its room count before scraping", () => {
  const first = run(board([layer({ materialItemId: itemId })]), [material({ quantity: 1 })]);
  first.state.pages[0].elements.push(layer({ id: "new-copy", materialItemId: itemId }));
  const result = run(first.state, [material({ quantity: 1 })]);
  expect(result.updates[0].patch.quantity).toBe(2);
});
it("does no reverse update after scraping and flags an unsent late selection", () => {
  const sent = run(board(), []);
  const result = run(sent.state, [{ ...sent.inserts[0], product: { ...product, price: "$500" } }], false);
  expect(result.changed).toBe(false); expect(result.updates).toEqual([]);
  expect(result.state.pages[0].elements[0].price).toBeUndefined();
  expect(run(board(), [], false).summary.issues[0].message).toContain("changed during the refresh");
});
it("rejects malformed boards and cannot overwrite another project's material", () => {
  expect(() => run({ pages: [{ id: "p", elements: null }] })).toThrow("invalid pages");
  expect(() => run(board([layer(), layer()]))).toThrow("invalid item references");
  expect(run(board([layer({ materialItemId: itemId })]), [material({ project_id: "another" })]).inserts).toHaveLength(1);
});
it("soft removes stale board selections and retains independent manual Materials", () => {
  const deleted = material({ source_board_id: project, source_board_page_id: "shared", source_board_element_id: "gone" });
  const result = run(board([]), [deleted]);
  expect(result.updates[0].patch).toEqual({ not_needed: true });
  expect(run(board([]), [material()]).updates).toEqual([]);
});
it("counts repeated new products on one page without multiplying references on other pages", () => {
  const repeated: any = board([layer(), layer({ id: "second" })]);
  repeated.pages.push({ ...repeated.pages[0], id: "other-page", elements: [layer({ id: "other-reference" })] });
  const result = run(repeated);
  expect(result.inserts).toHaveLength(1); expect(result.inserts[0].quantity).toBe(2);
  expect(result.state.pages.flatMap(p => p.elements).every(l => l.materialQuantity === 1)).toBe(true);
});
it("invalidates plan evidence for a changed board selection but allows harmless canvas rearrangement", () => {
  const original = board(); const moved = structuredClone(original);
  moved.pages[0].elements[0].x = 800;
  expect(specBoardSelectionEvidence(moved)).toEqual(specBoardSelectionEvidence(original));
  moved.pages[0].elements[0].link += "&variant=changed";
  expect(specBoardSelectionEvidence(moved)).not.toEqual(specBoardSelectionEvidence(original));
});
