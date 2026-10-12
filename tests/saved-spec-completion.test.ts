import { expect, it } from "vitest";
import { completionFindingKey, completionIssueRecords, completionSourceSignature } from "@/lib/savedSpecCompletion.server";
import { completionIssueCounts, isCompletionIssueStatus } from "@/lib/savedSpecCompletion";
import { checkSpecDetails, type SpecCompletionReport, type CompletionFinding } from "@/lib/specCompletion";
import type { MaterialItem } from "@/lib/db";
const rooms = [{ id: "bath", name: "Bathroom" }];
const item = { id: "mirror", room_id: "bath", item_label: "Mirror", quantity: null, quantity_tbd: true,
  quantity_unit: "count", is_required: false, product_id: "product", product: { sku: "mirror-a" } } as MaterialItem;
const document = { id: "plans", title: "Plans", updated_at: "v1" };
const quantity = { id: "plan:mirror:qty", item_id: "mirror", room_id: "bath", item_label: "Mirror", field: "quantity",
  source: "plans", current: "TBD", suggested: "2 count", page: 5, sheet: "ID2", evidence: "Two mirrors", message: "Review" } as CompletionFinding;
const report = { checked_at: "2026-10-12T12:00:00.000Z", item_count: 1, findings: [quantity], document,
  plan_status: "checked", plan_message: "Reviewed" } as SpecCompletionReport;

it("keeps a finding's identity when only evidence wording, page or label formatting changes", () => {
  expect(completionFindingKey({ ...quantity, evidence: "Two identical selected mirrors", page: 6, item_label: "Bath Mirror", suggested: " 2   COUNT " }, item, document))
    .toBe(completionFindingKey(quantity, item, document));
});
it("reopens changed quantity, proposed correction, document revision or product variant as a new finding", () => {
  const original = completionFindingKey(quantity, item, document);
  for (const [finding, material, doc] of [
    [{ ...quantity, current: "1" }, { ...item, quantity: 1, quantity_tbd: false }, document],
    [{ ...quantity, suggested: "3 count" }, item, document],
    [quantity, item, { ...document, updated_at: "v2" }],
    [quantity, { ...item, product_id: "new-variant" }, document],
    [quantity, { ...item, color: "Black" }, document],
  ] as const) expect(completionFindingKey(finding, material as MaterialItem, doc)).not.toBe(original);
});
it("does not reset a dismissed missing-color issue for an unrelated price edit or plan revision", () => {
  const color = checkSpecDetails([item], rooms).find(row => row.field === "color")!;
  expect(completionFindingKey(color, { ...item, product: { ...item.product, price: "$150" } } as MaterialItem, { ...document, updated_at: "v2" }))
    .toBe(completionFindingKey(color, item, document));
});
it("creates a new color issue when the linked board image changes", () => {
  const material = { ...item, source_board_id: "board", source_board_page_id: "page", source_board_element_id: "element" };
  const board = (url: string) => ({ pages: [{ id: "page", elements: [{ id: "element", type: "image", src: url, materialItemId: item.id, productId: item.product_id }] }] });
  const color = checkSpecDetails([material], rooms).find(row => row.field === "color")!;
  expect(completionFindingKey(color, material, document, board("https://cdn.example.com/white.jpg")))
    .not.toBe(completionFindingKey(color, material, document, board("https://cdn.example.com/black.jpg")));
});
it("detects changed selections and plans, ignoring only record order", () => {
  const second = { ...item, id: "second" };
  expect(completionSourceSignature([item, second], rooms, document)).toBe(completionSourceSignature([second, item], rooms, document));
  expect(completionSourceSignature([item], rooms, document)).not.toBe(completionSourceSignature([{ ...item, quantity: 2 }], rooms, document));
  expect(completionSourceSignature([item], rooms, document)).not.toBe(completionSourceSignature([item], rooms, { ...document, id: "new-plans" }));
});
it("stores each field separately with its original room and source document", () => {
  const records = completionIssueRecords({ ...report, findings: [...checkSpecDetails([item], rooms), quantity] }, [item], rooms);
  expect(Object.values(records).every(issue => issue.status === "open" && issue.room_name === "Bathroom")).toBe(true);
  expect(Object.values(records).find(issue => issue.finding.source === "plans")?.document).toEqual(document);
  expect(Object.keys(records).every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true);
});
it("saves the exact item image and product identity for later review", () => {
  const illustrated = { ...item, image_url: 'https://cdn.test/selected.jpg', product: { ...item.product, name: 'Selected brass mirror', image_url: 'https://cdn.test/catalog.jpg' } } as MaterialItem;
  expect(Object.values(completionIssueRecords(report, [illustrated], rooms))[0].item_preview)
    .toMatchObject({ name: 'Selected brass mirror', image_url: illustrated.image_url, product_id: item.product_id });
});
it("detects changed size choices without making older reviews stale for absent metadata", () => {
  const explicitNulls = { ...item, product: { ...item.product, size_options: null, selected_size: null } } as MaterialItem;
  expect(completionSourceSignature([item], rooms, document)).toBe(completionSourceSignature([explicitNulls], rooms, document));
  const sizes = { ...item, product: { ...item.product, size_options: ['24 in', '30 in'] } } as MaterialItem;
  expect(completionSourceSignature([item], rooms, document)).not.toBe(completionSourceSignature([sizes], rooms, document));
});
it("counts independent completion decisions and permits only the three supported statuses", () => {
  const issue = Object.values(completionIssueRecords(report, [item], rooms))[0];
  expect(completionIssueCounts([issue, { ...issue, status: "completed" }, { ...issue, status: "not_needed" }])).toEqual({ open: 1, completed: 1, not_needed: 1 });
  for (const value of ["open", "completed", "not_needed"]) expect(isCompletionIssueStatus(value)).toBe(true);
  for (const value of [null, "deleted", "approved", true]) expect(isCompletionIssueStatus(value)).toBe(false);
});
