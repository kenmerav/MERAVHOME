import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ retrieve: vi.fn(), settle: vi.fn(), read: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/fullSpecBudget.server", () => ({ productionFullSpecBudgetStore: () => ({ read: mock.read }) }));
vi.mock("@/lib/fullSpecBudgetStore", () => ({ settleFullSpecBudget: mock.settle }));
vi.mock("@/lib/specReviewAI.server", async () => {
  const actual = await vi.importActual<any>("@/lib/specReviewAI.server");
  return { ...actual, retrieveSpecReview: mock.retrieve };
});
import { finishPendingReview } from "@/lib/savedSpecCompletion.server";
const project = "11111111-1111-4111-8111-111111111111", run = "44444444-4444-4444-8444-444444444444", owner = "55555555-5555-4555-8555-555555555555";
const saved = () => ({ report: { plan_status: "unavailable", findings: [], plan_job: { request_id: "request", response_id: "resp_123", full_check_run_id: run, budget_owner_id: owner } } });
beforeEach(() => { vi.clearAllMocks(); mock.read.mockResolvedValue({ budget: { runId: run, ownerId: owner, status: "active", claims: [{ key: "completion:request", status: "pending" }] } }); mock.settle.mockResolvedValue(undefined); });
it("recovers a terminal background request on reopening the review and settles without regenerating", async () => {
  mock.retrieve.mockResolvedValue(Response.json({ status: "completed" })); const prior = saved();
  expect(await finishPendingReview(project, prior, [], [], null)).toBe(prior);
  expect(mock.retrieve).toHaveBeenCalledWith("resp_123"); expect(mock.settle).toHaveBeenCalledWith(expect.anything(), owner, run, "completion:request");
});
it.each([Response.json({ status: "queued" }), Response.json({ error: "expired" }, { status: 404 }), Response.json({ error: "temporary" }, { status: 500 })])("keeps a queued, expired, or failed retrieval pending", async response => {
  mock.retrieve.mockResolvedValue(response); await finishPendingReview(project, saved(), [], [], null);
  expect(mock.settle).not.toHaveBeenCalled();
});
it("does not call the provider for a closed, different or already settled run", async () => {
  mock.read.mockResolvedValue({ budget: { runId: run, ownerId: owner, status: "active", claims: [{ key: "completion:request", status: "settled" }] } });
  await finishPendingReview(project, saved(), [], [], null); expect(mock.retrieve).not.toHaveBeenCalled();
});
