import { expect, it } from "vitest";
import { cleanDrawingEvidence, groundedCompletionRows, type DrawingEvidence } from "@/lib/specDrawingEvidence";
const rooms = [{ id: "bath", name: "Bath" }, { id: "casita", name: "Casita Bath" }];
const quantity = { id: "q1", room_id: "bath", label: "Sink", field: "quantity", page: 2, sheet: "ID2", evidence: "Two S1 sinks in complete proposed vanity layout",
  confidence: "high", proposed: true, quantity: 2, quantity_unit: "count", complete_room_scope: true, exact_variant: true, variant: "S1" };
const source = () => ({ complete: true, reviewed_pages: [1, 2, 3], complete_project_scope: true,
  rooms: rooms.map(room => ({ room_id: room.id, match: "matched" })), facts: [quantity], uncertainties: [] });
const row = { room_id: "bath", item_id: "selected-sink", field: "quantity", quantity: 2, quantity_unit: "count", evidence_ids: ["q1"] };
it("rejects truncated, missing, duplicated, or foreign page/room coverage", () => {
  for (const change of [{ complete: false }, { reviewed_pages: [1, 2] }, { reviewed_pages: [1, 2, 2] }, { reviewed_pages: [1, 2, 4] },
    { rooms: [{ room_id: "bath", match: "matched" }] }, { rooms: [{ room_id: "bath", match: "matched" }, { room_id: "bath", match: "matched" }] },
    { rooms: [{ room_id: "bath", match: "matched" }, { room_id: "foreign", match: "matched" }] }])
    expect(() => cleanDrawingEvidence({ ...source(), ...change }, rooms, 3)).toThrow();
});
it("does not cache low-confidence, inferred, unmapped, or incomplete counts", () => {
  for (const change of [{ confidence: "low" }, { proposed: false }, { room_id: "foreign" }, { page: 4 },
    { complete_room_scope: false }, { exact_variant: false }, { quantity: 2.5 }, { quantity_unit: "square_feet" }])
    expect(() => cleanDrawingEvidence({ ...source(), facts: [{ ...quantity, ...change }] }, rooms, 3)).toThrow();
  expect(() => cleanDrawingEvidence({ ...source(), facts: [quantity, quantity] }, rooms, 3)).toThrow();
});
it("accepts an explicitly scheduled area and preserves original citations", () => {
  const parsed = cleanDrawingEvidence({ ...source(), facts: [{ ...quantity, quantity: 12.5, quantity_unit: "square_feet", explicit_area: true }] }, rooms, 3);
  expect(parsed.facts[0]).toMatchObject({ quantity: 12.5, quantity_unit: "square_feet", page: 2, sheet: "ID2" });
});
it("rejects invented counts, references, or cross-room assignments and supplies citations from the saved fact", () => {
  const evidence = cleanDrawingEvidence(source(), rooms, 3);
  expect(groundedCompletionRows([{ ...row, page: 99, sheet: "invented", evidence: "invented" }], evidence)).toMatchObject([{ page: 2, sheet: "ID2", evidence: quantity.evidence }]);
  for (const change of [{ quantity: 3 }, { room_id: "casita" }, { evidence_ids: [] }, { evidence_ids: ["foreign"] }, { evidence_ids: ["q1", "q1"] }, { quantity_unit: "square_feet" }])
    expect(groundedCompletionRows([{ ...row, ...change }], evidence)).toEqual([]);
});
it("requires matching complete per-room variants and exact allocations for shared quantities", () => {
  const evidence = cleanDrawingEvidence({ ...source(), facts: [quantity, { ...quantity, id: "q2", room_id: "casita", quantity: 1 }] }, rooms, 3);
  const shared = { ...row, room_id: "throughout", evidence_ids: ["q1", "q2"], quantity: 3, allocation_scope_complete: true,
    quantity_allocations: [{ room_id: "bath", quantity: 2 }, { room_id: "casita", quantity: 1 }] };
  expect(groundedCompletionRows([shared], evidence)).toHaveLength(1);
  for (const change of [{ quantity: 4 }, { quantity_allocations: [{ room_id: "bath", quantity: 3 }] },
    { quantity_allocations: [{ room_id: "bath", quantity: 2 }, { room_id: "bath", quantity: 1 }] }])
    expect(groundedCompletionRows([{ ...shared, ...change }], evidence)).toEqual([]);
  expect(groundedCompletionRows([shared], { ...evidence, complete_project_scope: false })).toEqual([]);
  expect(groundedCompletionRows([shared], { ...evidence, facts: evidence.facts.map(f => f.id === "q2" ? { ...f, variant: "S2" } : f) })).toEqual([]);
});
it("binds missing-item labels and explicit dimensions to exact saved evidence", () => {
  const evidence = cleanDrawingEvidence({ ...source(), facts: [
    { ...quantity, id: "p1", field: "presence", label: "Towel Hook" },
    { ...quantity, id: "d1", field: "dimensions", label: "Mirror", value: "Width: 30 in", explicit_specification: true,
      dimension_scope: "proposed_layout", conflicting_dimensions: false },
  ] }, rooms, 3);
  expect(groundedCompletionRows([{ room_id: "bath", field: "missing_item", item_label: "invented", evidence_ids: ["p1"] }], evidence)).toMatchObject([{ item_label: "Towel Hook" }]);
  const dimension = { room_id: "bath", field: "dimensions", value: "Width: 30 in", dimension_scope: "proposed_layout", evidence_ids: ["d1"] };
  expect(groundedCompletionRows([dimension], evidence)).toHaveLength(1);
  expect(groundedCompletionRows([{ ...dimension, value: "Width: 30 in, Height: 40 in" }], evidence)).toEqual([]);
  expect(groundedCompletionRows([{ ...dimension, dimension_scope: "product_specification" }], evidence)).toEqual([]);
});
it("keeps uncertainty visible without inventing missing products from absent facts", () => {
  const evidence: DrawingEvidence = cleanDrawingEvidence({ ...source(), facts: [], uncertainties: [{ page: 3, evidence: "Casita detail illegible" }] }, rooms, 3);
  expect(evidence.uncertainties).toEqual([{ page: 3, evidence: "Casita detail illegible" }]);
  expect(groundedCompletionRows([{ room_id: "casita", field: "missing_item", evidence_ids: ["unknown"] }], evidence)).toEqual([]);
});
