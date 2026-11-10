import { expect, it } from "vitest";
import { approvableDrawingQuantity } from "@/lib/specQuantityApproval";
import type { DrawingMatchItem, DrawingMatchReport } from "@/lib/specDrawingMatches";

const item: DrawingMatchItem = { id: "item", ref: "S1", roomId: "room", room: "Bathroom", label: "Sconce", name: "Sconce", sku: "", vendor: "", finish: "", dimensions: "", cad: "", category: "Lighting", quantity: 1, quantityTbd: false, quantityUnit: "count", productId: "product", materialUpdatedAt: "2026-01-01" };
const report: DrawingMatchReport = { key: "key", status: "complete", document: null, totalPages: 2, reviewedPages: [1, 2], matches: [], uncertainties: [], completedChunks: 1, totalChunks: 1, quantityFindings: [{ itemId: "item", room: "Bathroom", label: "Sconce", quantity: 2, current: "1", status: "suggested", sources: [{ itemId: "item", room: "Bathroom", label: "Sconce", quantity: 2, page: 1, sheet: "L1", evidence: "Schedule lists two sconces", source: "schedule" }] }] };
it("accepts a complete current count supported by exact schedule evidence", () => expect(approvableDrawingQuantity(report, item)).toBe(2));
it("rejects partial scans, minimums, conflicts and stale snapshots", () => {
  expect(approvableDrawingQuantity({ ...report, status: "partial" }, item)).toBeNull();
  expect(approvableDrawingQuantity({ ...report, reviewedPages: [1, 1] }, item)).toBeNull();
  expect(approvableDrawingQuantity({ ...report, quantityFindings: [{ ...report.quantityFindings![0], status: "minimum" }] }, item)).toBeNull();
  expect(approvableDrawingQuantity({ ...report, quantityFindings: [{ ...report.quantityFindings![0], status: "conflict" }] }, item)).toBeNull();
  expect(approvableDrawingQuantity(report, { ...item, quantity: 3 })).toBeNull();
  expect(approvableDrawingQuantity(report, { ...item, materialUpdatedAt: undefined })).toBeNull();
});
it("rejects measured categories and non-count units but allows explicitly counted cabinet hardware", () => {
  expect(approvableDrawingQuantity(report, { ...item, category: "Tile & Stone", label: "Floor Tile" })).toBeNull();
  expect(approvableDrawingQuantity(report, { ...item, category: "Other", label: "Floor Tile" })).toBeNull();
  expect(approvableDrawingQuantity(report, { ...item, quantityUnit: "pair" })).toBeNull();
  expect(approvableDrawingQuantity(report, { ...item, category: "Cabinetry", label: "Cabinet pull" })).toBe(2);
});
it("rejects evidence for another room, a larger minimum, and inconsistent exact totals", () => {
  const row = report.quantityFindings![0];
  for (const source of [{ ...row.sources[0], room: "Kitchen" }, { ...row.sources[0], quantity: 3 }, { ...row.sources[0], quantity: 3, source: "layout_minimum" as const }])
    expect(approvableDrawingQuantity({ ...report, quantityFindings: [{ ...row, sources: [row.sources[0], source] }] }, item)).toBeNull();
});
