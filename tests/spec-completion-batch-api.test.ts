import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ access: null as any, batch: vi.fn(), authorize: vi.fn() }));
vi.mock("@/lib/specCompletion.server", () => ({ authorizeCompletionProject: (...args: unknown[]) => mock.authorize(...args) }));
vi.mock("@/lib/specCompletionBatch.server", () => ({ saveCompletionBatchForStaff: (...args: unknown[]) => mock.batch(...args) }));
vi.mock("@/lib/savedSpecCompletion.server", () => ({
  readSavedCompletionReview: vi.fn(), setCompletionIssueStatus: vi.fn(), attachCompletionSaveWorker: vi.fn(),
  CompletionStorageUnavailable: class CompletionStorageUnavailable extends Error {}, CompletionReviewConflict: class CompletionReviewConflict extends Error {},
}));
vi.mock("@/lib/specCompletionEdit.server", () => ({ saveCompletionDetailForStaff: vi.fn(), CompletionDetailInputError: class CompletionDetailInputError extends Error {} }));
vi.mock("@/lib/specCompletionBackground.server", () => ({ startCompletionSaveWorker: vi.fn() }));
import { savedSpecCompletionRequest } from "@/lib/savedSpecCompletionApi.server";
import { CompletionReviewConflict } from "@/lib/savedSpecCompletion.server";

const key = "a".repeat(64);
const entry = { issue_key: key, expected_updated_at: null, expected_material_updated_at: "2026-01-01T00:00:00Z",
  expected_product_id: null, expected_product_updated_at: null };
const request = () => new Request("https://local.test/api/spec-completion-review", { method: "POST" });
beforeEach(() => {
  mock.access = { projectId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002",
    body: { action: "batch_detail", project_id: "00000000-0000-4000-8000-000000000001", entries: [entry] } };
  mock.authorize.mockReset().mockImplementation(async () => mock.access);
  mock.batch.mockReset().mockResolvedValue({ results: [{ issue_key: key, status: "saved" }] });
});
it("respects project authorization before invoking the batch handler", async () => {
  mock.access = new Response("unauthorized", { status: 403 });
  expect((await savedSpecCompletionRequest(request())).status).toBe(403);
  expect(mock.batch).not.toHaveBeenCalled();
});
it("rejects client-supplied values and duplicate keys before any writes", async () => {
  mock.access.body.entries = [{ ...entry, value: "Black" }];
  expect((await savedSpecCompletionRequest(request())).status).toBe(400);
  mock.access.body.entries = [entry, entry];
  expect((await savedSpecCompletionRequest(request())).status).toBe(400);
  expect(mock.batch).not.toHaveBeenCalled();
});
it("dispatches valid entries and returns explicit batch results", async () => {
  const response = await savedSpecCompletionRequest(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ results: [{ issue_key: key, status: "saved" }] });
  expect(mock.batch).toHaveBeenCalledWith(mock.access.projectId, mock.access.userId, [entry]);
});
it("returns a conflict when the review or sources became stale", async () => {
  mock.batch.mockRejectedValueOnce(new CompletionReviewConflict("Sources changed"));
  const response = await savedSpecCompletionRequest(request());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Sources changed" });
});
