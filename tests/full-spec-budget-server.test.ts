import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: null as null | { report: Record<string, unknown>; updated_at: string }, fail: false }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => {
  let op = "read", payload: any = null, expected = "";
  const query: any = {
    select: () => query,
    eq: (key: string, value: string) => { if (key === "updated_at") expected = value; return query; },
    upsert: (value: any) => { op = "insert"; payload = value; return query; },
    update: (value: any) => { op = "update"; payload = value; return query; },
    async maybeSingle() {
      await Promise.resolve();
      if (state.fail) return { data: null, error: { message: "unavailable" } };
      if (op === "read") return { data: state.row && structuredClone(state.row), error: null };
      if ((op === "insert" && state.row) || (op === "update" && state.row?.updated_at !== expected)) return { data: null, error: null };
      state.row = { report: structuredClone(payload.report), updated_at: payload.updated_at };
      return { data: { project_id: "22222222-2222-4222-8222-222222222222" }, error: null };
    },
  }; return query;
} } }));
import { productionFullSpecBudgetStore, startProductionFullSpecBudget } from "@/lib/fullSpecBudget.server";
import { closeFullSpecBudget, reserveFullSpecBudget, settleFullSpecBudget } from "@/lib/fullSpecBudgetStore";
import { publicSpecCompletionReport, type SpecCompletionReport } from "@/lib/specCompletion";
import { createFullSpecBudget } from "@/lib/fullSpecBudget";
import { preserveDrawingCaches } from "@/lib/savedSpecCompletion.server";
afterEach(() => { vi.unstubAllEnvs(); state.row = null; state.fail = false; });

it("keeps the private budget ledger out of a public completion response", () => {
  const budget = createFullSpecBudget("33333333-3333-4333-8333-333333333333", "11111111-1111-4111-8111-111111111111");
  const report = { checked_at: "now", item_count: 0, findings: [], plan_status: "no_document", document: null, plan_message: "", full_spec_budget: budget } as SpecCompletionReport;
  expect(publicSpecCompletionReport(report)).not.toHaveProperty("full_spec_budget");
  expect(preserveDrawingCaches({ ...report, full_spec_budget: undefined }, report).full_spec_budget).toEqual(budget);
});
it("creates a private pre-review row and atomically reserves concurrent requests without losing existing report data", async () => {
  const project = "22222222-2222-4222-8222-222222222222", owner = "11111111-1111-4111-8111-111111111111";
  state.row = { report: { other_cache: "keep" }, updated_at: "2026-01-01T00:00:00.000Z" };
  const budget = await startProductionFullSpecBudget(project, owner);
  const store = productionFullSpecBudgetStore(project);
  const claims = await Promise.all(Array.from({ length: 5 }, (_, n) => reserveFullSpecBudget(store, owner, budget.runId, { key: `scrape:${n}`, kind: "scrape", openAiCents: 0, firecrawlCredits: 5 })));
  expect(claims).toEqual([true, true, true, true, true]);
  expect(state.row?.report.other_cache).toBe("keep");
  expect((state.row?.report.full_spec_budget as any).reservedCents).toBe(0);
});
it("can start a budget before the project has any saved completion review", async () => {
  const budget = await startProductionFullSpecBudget("22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111");
  expect(state.row?.report.full_spec_budget).toEqual(budget);
  expect(state.row?.report).not.toHaveProperty("checked_at");
});
it("does not create a budget or authorize paid work when storage is unavailable", async () => {
  state.fail = true;
  await expect(startProductionFullSpecBudget("22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111")).rejects.toThrow(/No provider call/);
});

it("shares one durable ledger across a full check, near-limit concurrent work, duplicate claims, and stop", async () => {
  const project = "22222222-2222-4222-8222-222222222222", owner = "11111111-1111-4111-8111-111111111111";
  const budget = await startProductionFullSpecBudget(project, owner);
  const store = productionFullSpecBudgetStore(project);
  const stages = [
    { key: "completion:initial", kind: "completion" as const, openAiCents: 200, firecrawlCredits: 0 },
    { key: "scrape:initial", kind: "scrape" as const, openAiCents: 0, firecrawlCredits: 5 },
    { key: "drawing:all", kind: "drawing" as const, openAiCents: 500, firecrawlCredits: 0 },
    { key: "product:scrape", kind: "product" as const, openAiCents: 0, firecrawlCredits: 1 },
    { key: "product:image", kind: "product" as const, openAiCents: 25, firecrawlCredits: 0 },
    { key: "color:one", kind: "completion" as const, openAiCents: 70, firecrawlCredits: 0 },
    { key: "dimensions:one", kind: "completion" as const, openAiCents: 150, firecrawlCredits: 0 },
  ];
  for (const claim of stages) expect(await reserveFullSpecBudget(store, owner, budget.runId, claim)).toBe(true);
  expect((await store.read()).budget?.reservedCents).toBe(945);
  expect(await reserveFullSpecBudget(store, owner, budget.runId, stages[4])).toBe(false);
  const concurrent = await Promise.allSettled([0, 1, 2].map(index => reserveFullSpecBudget(store, owner, budget.runId,
    { key: `product:extra:${index}`, kind: "product", openAiCents: 25, firecrawlCredits: 1 })));
  expect(concurrent.filter(result => result.status === "fulfilled" && result.value)).toHaveLength(2);
  const current = (await store.read()).budget!;
  expect(current.reservedCents).toBe(995);
  expect(current.reservedCents).toBeLessThanOrEqual(1000);
  await expect(closeFullSpecBudget(store, owner, budget.runId)).rejects.toThrow(/running or unconfirmed/);
  for (const claim of current.claims) await settleFullSpecBudget(store, owner, budget.runId, claim.key);
  await closeFullSpecBudget(store, owner, budget.runId);
  await expect(reserveFullSpecBudget(store, owner, budget.runId,
    { key: "product:after-stop", kind: "product", openAiCents: 1, firecrawlCredits: 0 })).rejects.toThrow();
  expect((await store.read()).budget?.reservedCents).toBe(995);
});
