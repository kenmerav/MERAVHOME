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

it("refreshes shared quantity seven without reapplying the stale board quantity or altering layout, crop, notes, image and presentation settings", () => {
  const state = board([layer({ materialItemId: itemId, src: "https://board.example/cutout.png" })]);
  const result = run(state, [material()]);
  expect(result.inserts).toEqual([]);
  expect(result.state.pages[0].elements[0]).toMatchObject({ materialQuantity: 7, price: "$100", materialDimensions: "20 in", x: 410, y: 220, imageCropZoom: 2, src: "https://board.example/cutout.png", notes: "Designer note" });
  expect(result.state.comments).toEqual(state.comments); expect(result.state.customFutureSetting).toBe(123);
  expect(state.pages[0].elements[0].materialQuantity).toBe(1);
  expect(run(result.state, [material()]).changed).toBe(false);
});
it("imports all ready board selections and keeps source IDs, exact image, variant link and missing quantity for review", () => {
  const state = board([layer({ materialQuantity: null })]);
  const result = run(state);
  expect(result.inserts).toHaveLength(1);
  expect(result.inserts[0]).toMatchObject({ id: itemId, project_id: project, source_board_page_id: "shared", source_board_element_id: "sink-layer", image_url: product.image_url, product_url: product.product_url, quantity: null, quantity_tbd: true });
  expect(result.state.pages[0].elements[0].materialItemId).toBe(itemId);
  expect(run(result.state, result.inserts).inserts).toHaveLength(0);
});
it("does not revive excluded or removed entries or import hidden and declined alternatives", () => {
  const state = board([layer({ materialExcludeFromMaterials: true, materialItemId: itemId })]);
  const result = run(state, [material({ not_needed: true })]);
  expect(result.changed).toBe(false); expect(result.inserts).toEqual([]); expect(result.summary.added).toBe(0);
  const hidden: any = board(); hidden.pages[0].hidden = true;
  expect(run(hidden).inserts).toEqual([]);
  const declined: any = board(); declined.pages[0].roomApprovalStatus = "declined";
  expect(run(declined).inserts).toEqual([]);
  expect(run(board([layer({ materialItemId: itemId })]), [material({ not_needed: true })]).state.pages[0].elements[0].materialExcludeFromMaterials).toBe(true);
});
it("adds manual Materials selections on review pages without rearranging existing pages, and never adds them twice", () => {
  const original = board([]);
  const result = run(original, [material()]);
  expect(result.summary.added).toBe(1); expect(result.state.pages[0]).toEqual(original.pages[0]);
  expect(result.state.pages[1]).toMatchObject({ title: "Materials Throughout — Material updates", roomId: room });
  expect(result.state.pages[1].elements[0]).toMatchObject({ materialItemId: itemId, materialQuantity: 7 });
  expect(run(result.state, [material()]).summary.added).toBe(0);
});
it("flags differing exact product variants instead of overwriting Materials or replacing the board choice", () => {
  const state = board([layer({ materialItemId: itemId, link: "https://vendor.example/sink?uid=2" })]);
  const result = run(state, [material()]);
  expect(result.summary.issues[0].message).toContain("different product selections");
  expect(result.state.pages[0].elements[0].link).toContain("uid=2"); expect(result.inserts).toEqual([]);
});
it("flags ambiguous rooms, missing labels and unapproved missing links instead of silently claiming a complete board", () => {
  expect(run(board([layer({ materialRoomId: "wrong" })])).summary.issues[0].message).toContain("room");
  expect(run(board([layer({ label: "", productName: "" })])).summary.issues[0].message).toContain("label");
  expect(run(board([layer({ productId: null, link: "" })])).summary.issues[0].message).toContain("link");
  const approved = run(board([layer({ productId: null, link: "", materialInfoSkipApproved: true })]));
  expect(approved.inserts[0].product_url).toBeNull();
});
it("preserves an intentionally cleared material link and flags new board selections after scraping rather than adding unscripted products", () => {
  const cleared = run(board([layer({ materialItemId: itemId })]), [material({ product_url: null })]);
  expect(cleared.state.pages[0].elements[0]).toMatchObject({ link: "", materialLinkCleared: true });
  expect(run(board(), [], false).summary.issues[0].message).toContain("changed during the refresh");
  expect(run(board(), [], false).inserts).toEqual([]);
});
it("rejects malformed board snapshots and never imports selections from another project's Materials", () => {
  expect(() => run({ pages: [{ id: "p", elements: null }] })).toThrow("invalid pages");
  expect(() => run(board([layer(), layer()]))).toThrow("invalid item references");
  const other = material({ project_id: "another" });
  expect(run(board([layer({ materialItemId: itemId })]), [other]).inserts).toHaveLength(1);
});
it("keeps deleted board selections deleted and reports missing material images for manual follow-up", () => {
  const deleted = material({ source_board_id: project, source_board_element_id: "gone" });
  expect(run(board([]), [deleted]).summary.added).toBe(0);
  const noImage = material({ product: { ...product, image_url: null }, image_url: null });
  const result = run(board([]), [noImage]);
  expect(result.summary.added).toBe(0); expect(result.summary.issues[0].message).toContain("needs an image");
});
it("counts repeated new products on the same page, and treats repeated pages as references", () => {
  const repeated: any = board([layer(), layer({ id: "second" })]);
  repeated.pages.push({ ...repeated.pages[0], id: "other-page", elements: [layer({ id: "other-reference" })] });
  const result = run(repeated);
  expect(result.inserts).toHaveLength(1); expect(result.inserts[0].quantity).toBe(2);
  expect(result.state.pages.flatMap(p => p.elements).every(l => l.materialQuantity === 2)).toBe(true);
});
it("invalidates plan evidence for new board selections but permits harmless canvas rearrangement", () => {
  const original = board(); const moved = structuredClone(original);
  moved.pages[0].elements[0].x = 800;
  expect(specBoardSelectionEvidence(moved)).toEqual(specBoardSelectionEvidence(original));
  moved.pages[0].elements[0].link += "&variant=changed";
  expect(specBoardSelectionEvidence(moved)).not.toEqual(specBoardSelectionEvidence(original));
});
it("keeps confirmed board details when the catalog has no replacement value", () => {
  const item = material({ product: { ...product, price: null, finish: null, dimensions: null } });
  const result = run(board([layer({ materialItemId: itemId, price: "$120", materialFinish: "White", finish: "White", materialDimensions: "22 in" })]), [item]);
  expect(result.state.pages[0].elements[0]).toMatchObject({ price: "$120", materialFinish: "White", materialDimensions: "22 in" });
});
