import { assertFullSpecBudget, claimFullSpecBudget, createFullSpecBudget, FullSpecBudgetError, type FullSpecBudget, type FullSpecBudgetClaim } from "./fullSpecBudget";

export type FullSpecBudgetSnapshot = { report: Record<string, unknown>; updatedAt: string | null; budget: FullSpecBudget | null };
export type FullSpecBudgetStore = {
  read: () => Promise<FullSpecBudgetSnapshot>;
  compareAndSet: (snapshot: FullSpecBudgetSnapshot, budget: FullSpecBudget) => Promise<boolean>;
};

// CAS is required because drawing and image requests can reserve concurrently.
// The caller must not perform a paid call unless reserve returned true.
export async function startFullSpecBudget(store: FullSpecBudgetStore, runId: string, ownerId: string) {
  const budget = createFullSpecBudget(runId, ownerId);
  for (let retry = 0; retry < 12; retry++) {
    const snapshot = await store.read();
    if (snapshot.budget?.status === "active") throw new FullSpecBudgetError("A full check is already active. Open its saved progress.");
    if (await store.compareAndSet(snapshot, budget)) return budget;
  }
  throw new FullSpecBudgetError("The budget changed while starting the check. No provider calls were started.");
}

export async function reserveFullSpecBudget(store: FullSpecBudgetStore, ownerId: string, runId: string, claim: FullSpecBudgetClaim) {
  for (let retry = 0; retry < 12; retry++) {
    const snapshot = await store.read();
    if (!snapshot.budget) throw new FullSpecBudgetError("The check budget is not available. No provider calls were started.");
    const next = claimFullSpecBudget(snapshot.budget, ownerId, runId, claim);
    if (!next.claimed) return false;
    if (await store.compareAndSet(snapshot, next.budget)) return true;
  }
  throw new FullSpecBudgetError("The check budget changed. No provider call was started for this item.");
}

export async function closeFullSpecBudget(store: FullSpecBudgetStore, ownerId: string, runId: string) {
  for (let retry = 0; retry < 12; retry++) {
    const snapshot = await store.read();
    const budget = snapshot.budget;
    if (!budget || budget.ownerId !== ownerId || budget.runId !== runId) throw new FullSpecBudgetError("The check budget is not available.");
    if (budget.status === "closed") return;
    if (budget.status !== "active") throw new FullSpecBudgetError("The check budget could not be verified.");
    assertFullSpecBudget(budget, ownerId, runId);
    if (budget.claims.some(claim => claim.status !== "settled")) throw new FullSpecBudgetError("This check has provider requests still running or unconfirmed. Wait for the results before starting another check.");
    if (await store.compareAndSet(snapshot, { ...budget, status: "closed" })) return;
  }
  throw new FullSpecBudgetError("The check budget changed. Refresh the review.");
}

// A terminal, definite provider response may settle a claim. A timeout, lost
// response, queued job, or ambiguous result remains pending indefinitely.
// Settling never reduces the reserved amount.
export async function settleFullSpecBudget(store: FullSpecBudgetStore, ownerId: string, runId: string, key: string) {
  for (let retry = 0; retry < 12; retry++) {
    const snapshot = await store.read();
    if (!snapshot.budget) throw new FullSpecBudgetError("The check budget is not available.");
    const budget = snapshot.budget;
    assertFullSpecBudget(budget, ownerId, runId);
    const claim = budget.claims.find(row => row.key === key);
    if (!claim) throw new FullSpecBudgetError("The provider request has no matching budget claim.");
    if (claim.status === "settled") return;
    const next = { ...budget, claims: budget.claims.map(row => row.key === key ? { ...row, status: "settled" as const } : row) };
    if (await store.compareAndSet(snapshot, next)) return;
  }
  throw new FullSpecBudgetError("The check budget changed. Refresh the review.");
}
