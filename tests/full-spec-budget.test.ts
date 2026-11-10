import { expect, it } from "vitest";
import { claimFullSpecBudget, createFullSpecBudget } from "@/lib/fullSpecBudget";
import { closeFullSpecBudget, reserveFullSpecBudget, settleFullSpecBudget, startFullSpecBudget, type FullSpecBudgetStore } from "@/lib/fullSpecBudgetStore";

const user = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const run = "33333333-3333-4333-8333-333333333333";
const makeStore = () => {
  let version = 0;
  let report: Record<string, any> = {};
  const store: FullSpecBudgetStore = {
    async read() { return { report: structuredClone(report), updatedAt: String(version), budget: report.full_spec_budget ? structuredClone(report.full_spec_budget) : null }; },
    async compareAndSet(snapshot, budget) {
      await Promise.resolve();
      if (snapshot.updatedAt !== String(version)) return false;
      report = { ...snapshot.report, full_spec_budget: structuredClone(budget) }; version++; return true;
    },
  };
  return { store, get: () => report.full_spec_budget };
};

it("requires a valid run and owner", () => {
  expect(() => createFullSpecBudget("bad", user)).toThrow();
  expect(() => createFullSpecBudget(run, "bad")).toThrow();
});
it("counts OpenAI only in the same $10 budget while tracking Firecrawl credits", () => {
  let budget = createFullSpecBudget(run, user);
  for (const claim of [
    { key: "initial:completion", kind: "completion" as const, openAiCents: 200, firecrawlCredits: 0 },
    { key: "initial:scrape:one", kind: "scrape" as const, openAiCents: 0, firecrawlCredits: 5 },
    { key: "drawing:all", kind: "drawing" as const, openAiCents: 500, firecrawlCredits: 0 },
    { key: "product:one", kind: "product" as const, openAiCents: 25, firecrawlCredits: 1 },
  ]) budget = claimFullSpecBudget(budget, user, run, claim).budget;
  expect(budget.reservedCents).toBe(725);
  expect(() => claimFullSpecBudget(budget, user, run, { key: "more", kind: "completion", openAiCents: 500, firecrawlCredits: 0 })).toThrow(/\$10/);
  expect(claimFullSpecBudget(budget, user, run, { key: "more-drawing", kind: "drawing", openAiCents: 1, firecrawlCredits: 0 }).budget.reservedCents).toBe(726);
});
it("allows a drawing chunk up to the shared $10 limit while rejecting any overrun", () => {
  const initial = createFullSpecBudget(run, user);
  const near = claimFullSpecBudget(initial, user, run, { key: "completion", kind: "completion", openAiCents: 100, firecrawlCredits: 0 }).budget;
  const drawing = claimFullSpecBudget(near, user, run, { key: "drawing:1", kind: "drawing", openAiCents: 900, firecrawlCredits: 0 }).budget;
  expect(drawing.reservedCents).toBe(1000);
  expect(() => claimFullSpecBudget(drawing, user, run, { key: "drawing:2", kind: "drawing", openAiCents: 1, firecrawlCredits: 0 })).toThrow(/\$10/);
  expect(() => claimFullSpecBudget(initial, user, run, { key: "too-large", kind: "drawing", openAiCents: 1001, firecrawlCredits: 0 })).toThrow();
});
it("counts an unknown or failed provider outcome as reserved and prevents duplicate calls", async () => {
  const { store, get } = makeStore(); await startFullSpecBudget(store, run, user);
  const claim = { key: "product:one", kind: "product" as const, openAiCents: 25, firecrawlCredits: 1 };
  expect(await reserveFullSpecBudget(store, user, run, claim)).toBe(true);
  expect(await reserveFullSpecBudget(store, user, run, claim)).toBe(false);
  expect(get().reservedCents).toBe(25);
  await expect(reserveFullSpecBudget(store, other, run, claim)).rejects.toThrow();
});
it("never overbooks under concurrent reservations and treats a duplicate claim as one call", async () => {
  const { store, get } = makeStore(); await startFullSpecBudget(store, run, user);
  const makeClaim = (key: string) => ({ key, kind: "product" as const, openAiCents: 25, firecrawlCredits: 1 });
  const results = await Promise.allSettled(Array.from({ length: 60 }, (_, index) => reserveFullSpecBudget(store, user, run, makeClaim(`product:${index}`))));
  expect(get().reservedCents).toBeLessThanOrEqual(1000);
  expect(get().reservedCents).toBe(get().claims.reduce((sum: number, row: { reservedCents: number }) => sum + row.reservedCents, 0));
  expect(results.some(row => row.status === "fulfilled" && row.value)).toBe(true);
  expect(results.some(row => row.status === "rejected")).toBe(true);
  const one = makeStore(); await startFullSpecBudget(one.store, run, user);
  const same = await Promise.all(Array.from({ length: 5 }, () => reserveFullSpecBudget(one.store, user, run, makeClaim("same"))));
  expect(same.filter(Boolean)).toHaveLength(1); expect(one.get().reservedCents).toBe(25);
});
it("rejects replacement while active and blocks further claims after close", async () => {
  const { store } = makeStore(); await startFullSpecBudget(store, run, user);
  await expect(startFullSpecBudget(store, "44444444-4444-4444-8444-444444444444", user)).rejects.toThrow(/already active/);
  await closeFullSpecBudget(store, user, run);
  await expect(reserveFullSpecBudget(store, user, run, { key: "after", kind: "product", openAiCents: 25, firecrawlCredits: 1 })).rejects.toThrow();
});
it("cannot close or reset while any request is pending, and settlement never refunds reserved funds", async () => {
  const { store, get } = makeStore(); await startFullSpecBudget(store, run, user);
  await reserveFullSpecBudget(store, user, run, { key: "product:one", kind: "product", openAiCents: 25, firecrawlCredits: 0 });
  await expect(closeFullSpecBudget(store, user, run)).rejects.toThrow(/running or unconfirmed/);
  await expect(settleFullSpecBudget(store, other, run, "product:one")).rejects.toThrow();
  await settleFullSpecBudget(store, user, run, "product:one");
  expect(get().reservedCents).toBe(25); expect(get().claims[0].status).toBe("settled");
  await closeFullSpecBudget(store, user, run);
});
it("cannot close concurrently with a new reservation and then start paid work under the old run", async () => {
  const { store, get } = makeStore(); await startFullSpecBudget(store, run, user);
  const [closing, claiming] = await Promise.allSettled([
    closeFullSpecBudget(store, user, run),
    reserveFullSpecBudget(store, user, run, { key: "race", kind: "product", openAiCents: 1, firecrawlCredits: 0 }),
  ]);
  expect(closing.status === "fulfilled" && claiming.status === "fulfilled" && claiming.value).toBe(false);
  if (claiming.status === "fulfilled" && claiming.value) expect(get().claims[0].status).toBe("pending");
  if (closing.status === "fulfilled") expect(get().status).toBe("closed");
});
it("keeps zero-dollar Firecrawl requests pending and idempotent without deducting OpenAI budget", async () => {
  const { store, get } = makeStore(); await startFullSpecBudget(store, run, user);
  const claim = { key: "scrape:one", kind: "scrape" as const, openAiCents: 0, firecrawlCredits: 5 };
  expect(await reserveFullSpecBudget(store, user, run, claim)).toBe(true);
  expect(await reserveFullSpecBudget(store, user, run, claim)).toBe(false);
  expect(get().reservedCents).toBe(0); expect(get().claims[0].firecrawlCredits).toBe(5);
  await expect(closeFullSpecBudget(store, user, run)).rejects.toThrow(/running or unconfirmed/);
  await settleFullSpecBudget(store, user, run, claim.key); await closeFullSpecBudget(store, user, run);
});
