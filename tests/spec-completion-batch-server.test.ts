import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ review: null as any, item: null as any, save: vi.fn(), sourceKey: "key" }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => {
  const value = table === "material_items" ? state.item : table === "design_boards" ? { board_state: {} } : [];
  const query: any = { select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: value, error: null }), then: (ok: any, bad: any) => Promise.resolve({ data: value, error: null }).then(ok, bad) };
  return query;
} } }));
vi.mock("@/lib/savedSpecCompletion.server", () => ({
  readSavedCompletionReview: async () => state.review,
  completionFindingKey: () => state.sourceKey,
  CompletionReviewConflict: class CompletionReviewConflict extends Error {},
}));
vi.mock("@/lib/specCompletionEdit.server", () => ({ saveCompletionDetailForStaff: (...args: unknown[]) => state.save(...args) }));
import { saveCompletionBatchForStaff } from "@/lib/specCompletionBatch.server";

const row = { issue_key: "key", expected_updated_at: null, expected_material_updated_at: "2026-01-01T00:00:00Z", expected_product_id: null, expected_product_updated_at: null };
beforeEach(() => {
  state.sourceKey = "key";
  state.item = { id: "item", room_id: "room", product_id: null, updated_at: row.expected_material_updated_at };
  state.review = { stale: false, report: { checked_at: "2026-01-01", plan_status: "checked", document: null }, issues: [{
    key: "key", status: "open", status_updated_at: null, last_seen_at: "2026-01-01", finding: { item_id: "item", room_id: "room",
      source: "plans", field: "color", suggested: "White", page: 2, evidence: "Schedule says white" },
  }] };
  state.save.mockReset();
});
it("saves only the proposed server-side value after source and timestamps are checked", async () => {
  const result = await saveCompletionBatchForStaff("project", "staff", [row]);
  expect(result.results).toEqual([{ issue_key: "key", status: "saved" }]);
  expect(state.save.mock.calls[0][2].value).toBe("White");
});
it("rejects stale reviews and changed source signatures before writing anything", async () => {
  state.review.stale = true;
  await expect(saveCompletionBatchForStaff("project", "staff", [row])).rejects.toThrow(/sources changed/);
  state.review.stale = false; state.sourceKey = "different";
  await expect(saveCompletionBatchForStaff("project", "staff", [row])).rejects.toThrow(/source changed/);
  expect(state.save).not.toHaveBeenCalled();
});
it("rejects unverified selected finish evidence even when the issue suggests a color", async () => {
  state.review.issues[0].finding = { ...state.review.issues[0].finding, source: "details", finish_check: "mismatch" };
  state.review.report.finish_review = { observations: [{ item_id: "item", status: "unverified", source_url: "https://vendor.test", color: "White" }] };
  await expect(saveCompletionBatchForStaff("project", "staff", [row])).rejects.toThrow(/no longer verified/);
  expect(state.save).not.toHaveBeenCalled();
});
it("reports an uncertain save and does not claim the change failed", async () => {
  state.save.mockRejectedValueOnce(new Error("failed after writing"));
  const result = await saveCompletionBatchForStaff("project", "staff", [row]);
  expect(result.results[0].status).toBe("check");
  expect(result.results[0].message).toMatch(/may have saved/);
});
