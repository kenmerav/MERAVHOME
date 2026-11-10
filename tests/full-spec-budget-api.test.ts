import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: true, ken: true, budget: null as any, startError: false, closed: false }));
vi.mock("@/lib/specCompletion.server", () => ({ authorizeCompletionProject: async (request: Request) => {
  if (!state.allowed) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json();
  return { projectId: "8de0b0ad-3a5b-4558-9d6b-977ddc10302a", userId: "71506f7e-484e-4a94-a023-68f690836f8c", body, user: {}, profile: {} };
} }));
vi.mock("@/lib/specCheckAccess", () => ({ canRunPaidSpecCheck: () => state.ken }));
vi.mock("@/lib/fullSpecBudget.server", () => ({
  productionFullSpecBudgetStore: () => ({ read: async () => ({ budget: state.budget }) }),
  startProductionFullSpecBudget: async (_project: string, ownerId: string) => {
    if (state.startError) { const { FullSpecBudgetError } = await import("@/lib/fullSpecBudget"); throw new FullSpecBudgetError("The check budget could not be saved."); }
    return { runId: "7be94bb5-44cf-4d61-aa01-ce8451f70bc6", ownerId, status: "active", limitCents: 1000, reservedCents: 0, claims: [] };
  },
}));
vi.mock("@/lib/fullSpecBudgetStore", () => ({ closeFullSpecBudget: async () => { state.closed = true; } }));
import { fullSpecBudgetRequest } from "@/lib/fullSpecBudgetApi.server";
const req = (body: object) => new Request("https://studio.test/api/full-spec-budget", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { state.allowed = true; state.ken = true; state.budget = null; state.startError = false; state.closed = false; });

it("blocks non-Ken and unauthorized project access", async () => {
  state.allowed = false; expect((await fullSpecBudgetRequest(req({ action: "start" }))).status).toBe(403);
  state.allowed = true; state.ken = false; expect((await fullSpecBudgetRequest(req({ action: "start" }))).status).toBe(403);
});
it("does not accept budget limits or provider rates from the client", async () => {
  expect((await fullSpecBudgetRequest(req({ action: "start", limit: 100000, rate: 0 }))).status).toBe(400);
});
it("starts a server-set ten dollar budget and fails closed on storage errors", async () => {
  expect(await (await fullSpecBudgetRequest(req({ action: "start" }))).json()).toMatchObject({ active: true, limitCents: 1000 });
  state.startError = true; expect((await fullSpecBudgetRequest(req({ action: "start" }))).status).toBe(409);
});
it("does not return another owner's active run", async () => {
  state.budget = { status: "active", ownerId: "someone-else", runId: "secret" };
  expect(await (await fullSpecBudgetRequest(req({ action: "status" }))).json()).toEqual({ active: false });
});
it("requires a valid run id to close a run", async () => {
  expect((await fullSpecBudgetRequest(req({ action: "close", run_id: "bad" }))).status).toBe(400);
  expect(state.closed).toBe(false);
});
