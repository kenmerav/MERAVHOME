import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { drawingMatchSignature } from "@/lib/specDrawingMatches";

const state = vi.hoisted(() => ({ items: [] as any[], document: {} as any, report: {} as any, fail: "" }));
vi.mock("@/lib/specDrawingMatchStore.server", () => ({
  currentDrawingMatchSource: async (project: string) => ({ document: state.document, items: structuredClone(state.items), key: createHash("sha256").update(drawingMatchSignature(project, state.document, state.items)).digest("hex") }),
  quantityDrawingKey: (key: string) => key,
  productionDrawingMatchStore: () => ({ read: async () => ({ projectId: "project", key: state.report.key, purpose: "quantities" }) }),
}));
vi.mock("@/lib/specDrawingMatchEngine.server", () => ({ loadDrawingMatchReport: async () => state.report }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => {
  let id = "", payload: any;
  const q: any = { select: () => q, eq: (key: string, value: string) => { if (key === "id") id = value; return q; }, update: (p: any) => { payload = p; return q; },
    maybeSingle: async () => { const item = state.items.find(row => row.id === id); if (!item) return { data: null, error: null };
      if (payload && state.fail === id) return { data: null, error: null };
      if (payload) { item.quantity = payload.quantity; item.quantityTbd = payload.quantity_tbd; item.materialUpdatedAt += "x"; }
      return { data: { id, room_id: item.roomId, product_id: item.productId, updated_at: payload ? item.materialUpdatedAt : item.materialUpdatedAt, not_needed: false }, error: null }; } };
  return q;
} } }));
import { applyDrawingQuantities } from "@/lib/specQuantityApproval.server";
const key = () => createHash("sha256").update(drawingMatchSignature("project", state.document, state.items)).digest("hex");
beforeEach(() => {
  state.fail = ""; state.document = { id: "doc", title: "Drawings", updated_at: "now", file_url: "private", file_size: 1 };
  state.items = ["one", "two"].map((id, i) => ({ id, ref: `S${i + 1}`, roomId: "room", room: "Bath", label: "Sconce", name: "Sconce", sku: "", vendor: "", finish: "", dimensions: "", cad: "", category: "Lighting", quantity: 1, quantityTbd: false, quantityUnit: "count", productId: `product-${id}`, materialUpdatedAt: "now", productUpdatedAt: "now" }));
  state.report = { key: key(), status: "complete", totalPages: 1, reviewedPages: [1], totalChunks: 1, completedChunks: 1, quantityFindings: state.items.map(item => ({ itemId: item.id, status: "suggested", quantity: 2, current: "1", sources: [{ itemId: item.id, room: "Bath", quantity: 2, page: 1, evidence: "Schedule specifies two", source: "schedule" }] })) };
});
it("applies multiple independently approved counts against the original snapshot", async () => {
  const result = await applyDrawingQuantities("project", state.report.key, 0, ["one", "two"]);
  expect(result.appliedCount).toBe(2); expect(state.items.map(item => item.quantity)).toEqual([2, 2]);
});
it("reports partial results and stops after a write fails", async () => {
  state.fail = "two";
  const result = await applyDrawingQuantities("project", state.report.key, 0, ["one", "two"]);
  expect(result.results.map(row => row.status)).toEqual(["applied", "check"]);
  expect(state.items.map(item => item.quantity)).toEqual([2, 1]);
});
it("rejects a changed product or quantity before any write", async () => {
  state.items[0].productId = "different";
  await expect(applyDrawingQuantities("project", state.report.key, 0, ["one"])).rejects.toThrow(/changed/);
  expect(state.items[0].quantity).toBe(1);
});
