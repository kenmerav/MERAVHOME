import { beforeEach, expect, it, vi } from "vitest";
import { FullSpecBudgetError } from "@/lib/fullSpecBudget";

const projectId = "527d1356-919b-48b9-877e-1924c766282b";
const runId = "44444444-4444-4444-8444-444444444444";
const mock = vi.hoisted(() => ({ email: "ken@meravinteriors.com", budget: vi.fn(), sync: vi.fn(), fetch: vi.fn(), save: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: { id: "4204f2d1-e10c-4d98-a01b-350cf7d8cafe", email: mock.email } }, error: null }) },
  from: (table: string) => {
    const value = table === "user_profiles" ? { email: "ken@meravinteriors.com", is_active: true, role: "Admin" } :
      table === "projects" ? { id: projectId } : table === "design_boards" ? { board_state: null } : [];
    const q: any = { select: () => q, eq: () => q, is: () => q, order: () => q, range: () => q, limit: () => q,
      maybeSingle: async () => ({ data: value, error: null }), then: (resolve: any) => Promise.resolve({ data: value, error: null }).then(resolve) };
    return q;
  },
} }));
vi.mock("@/lib/fullSpecBudget.server", () => ({ assertProductionFullSpecBudget: mock.budget, productionFullSpecBudgetStore: () => ({}) }));
vi.mock("@/lib/fullSpecBudgetStore", () => ({ reserveFullSpecBudget: vi.fn(), settleFullSpecBudget: vi.fn() }));
vi.mock("@/lib/specBoardSync.server", () => ({ syncSpecBoardForStaff: mock.sync }));
vi.mock("@/lib/constructionUploads.server", () => ({ refreshConstructionUploads: vi.fn(async () => ({ uploaded: 0, failed: 0, deferred: 0 })) }));
vi.mock("@/lib/tileInstallation.server", () => ({ checkTileInstallation: vi.fn(async () => ({ findings: [] })) }));
vi.mock("@/lib/savedSpecCompletion.server", () => ({ assertCompletionStorage: vi.fn(), readSavedCompletionReview: vi.fn(async () => null), saveCompletionReview: mock.save, CompletionReviewConflict: class extends Error {} }));
import { checkSpecCompletion } from "@/lib/specCompletion.server";
const request = (run: unknown = runId) => new Request("https://studio.example/api/check-spec-completion", { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify({ project_id: projectId, action: "prepare", full_check_run_id: run }) });
beforeEach(() => { vi.clearAllMocks(); mock.email = "ken@meravinteriors.com"; mock.budget.mockResolvedValue({}); mock.sync.mockResolvedValue({ updated_at: null, summary: {} }); vi.stubGlobal("fetch", mock.fetch); });
it("rejects a missing run and a different authenticated account before syncing or calling a provider", async () => {
  expect((await checkSpecCompletion(request(""))).status).toBe(400);
  mock.email = "other@meravinteriors.com";
  expect((await checkSpecCompletion(request())).status).toBe(403);
  expect(mock.sync).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it("rejects an unavailable budget before board sync or provider work", async () => {
  mock.budget.mockRejectedValue(new FullSpecBudgetError("Budget unavailable"));
  expect((await checkSpecCompletion(request())).status).toBe(409);
  expect(mock.sync).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it("prepares a Ken-owned current run without calling a paid provider", async () => {
  expect((await checkSpecCompletion(request())).status).toBe(200);
  expect(mock.budget).toHaveBeenCalledWith(projectId, "4204f2d1-e10c-4d98-a01b-350cf7d8cafe", runId);
  expect(mock.fetch).not.toHaveBeenCalled();
});
it("saves an explicit partial-refresh warning for the team after the budget stops the product refresh", async () => {
  const partial = new Request("https://studio.example/api/check-spec-completion", { method: "POST", headers: { Authorization: "Bearer test" },
    body: JSON.stringify({ project_id: projectId, full_check_run_id: runId, product_refresh_budget_stopped: true, product_refresh_not_refreshed: 7 }) });
  const response = await checkSpecCompletion(partial);
  expect(response.status).toBe(200);
  expect((await response.json())).toMatchObject({ product_refresh_budget_stopped: true, product_refresh_not_refreshed: 7 });
  expect(mock.save.mock.calls[0][2]).toMatchObject({ product_refresh_budget_stopped: true, product_refresh_not_refreshed: 7 });
  expect(mock.fetch).not.toHaveBeenCalled();
});
