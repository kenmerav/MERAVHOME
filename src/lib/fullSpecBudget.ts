/** An OpenAI cost reservation ledger, not a provider invoice or billing cap. */
export const FULL_SPEC_LIMIT_CENTS = 1000;
export type FullSpecReservation = { key: string; kind: "completion" | "scrape" | "drawing" | "product"; openAiCents: number; firecrawlCredits: number; reservedCents: number; status: "pending" | "settled" };
export type FullSpecBudget = { version: 1; runId: string; ownerId: string; status: "active" | "closed"; limitCents: number; reservedCents: number; claims: FullSpecReservation[] };
export type FullSpecBudgetClaim = Pick<FullSpecReservation, "key" | "kind" | "openAiCents" | "firecrawlCredits">;
export class FullSpecBudgetError extends Error {
  constructor(message: string, readonly code?: "budget_exhausted") { super(message); }
}

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function createFullSpecBudget(runId: string, ownerId: string): FullSpecBudget {
  if (!uuid(runId) || !uuid(ownerId)) throw new FullSpecBudgetError("Could not confirm the check owner or run.");
  return { version: 1, runId, ownerId, status: "active", limitCents: FULL_SPEC_LIMIT_CENTS, reservedCents: 0, claims: [] };
}

// Claims are made before requests, even if the response is lost or rejected.
// A duplicate is never permission to repeat a paid call.
export function assertFullSpecBudget(budget: FullSpecBudget, ownerId: string, runId: string) {
  if (budget.version !== 1 || budget.status !== "active" || budget.ownerId !== ownerId || budget.runId !== runId || budget.limitCents !== FULL_SPEC_LIMIT_CENTS ||
    !Number.isSafeInteger(budget.reservedCents) || budget.reservedCents < 0 || budget.reservedCents > FULL_SPEC_LIMIT_CENTS || !Array.isArray(budget.claims))
    throw new FullSpecBudgetError("This check's budget is not available. Start a new check.");
  if (budget.claims.some(row => !row || !Number.isSafeInteger(row.reservedCents) || row.reservedCents < 0 ||
    !Number.isSafeInteger(row.openAiCents) || row.openAiCents < 0 || row.reservedCents !== row.openAiCents ||
    !Number.isSafeInteger(row.firecrawlCredits) || row.firecrawlCredits < 0 || (row.openAiCents === 0 && row.firecrawlCredits === 0) ||
    typeof row.key !== "string" || !["pending", "settled"].includes(row.status)) ||
    new Set(budget.claims.map(row => row.key)).size !== budget.claims.length ||
    budget.claims.reduce((sum, row) => sum + row.reservedCents, 0) !== budget.reservedCents)
    throw new FullSpecBudgetError("This check's budget could not be verified. No new provider calls were started.");
}

export function claimFullSpecBudget(budget: FullSpecBudget, ownerId: string, runId: string, claim: FullSpecBudgetClaim): { budget: FullSpecBudget; claimed: boolean } {
  assertFullSpecBudget(budget, ownerId, runId);
  if (!/^[a-z0-9:_-]{1,160}$/i.test(claim.key) || !["completion", "scrape", "drawing", "product"].includes(claim.kind) ||
    !Number.isSafeInteger(claim.openAiCents) || claim.openAiCents < 0 || !Number.isSafeInteger(claim.firecrawlCredits) || claim.firecrawlCredits < 0 ||
    claim.firecrawlCredits > 1000 || claim.openAiCents > (["drawing", "completion"].includes(claim.kind) ? 500 : claim.kind === "product" ? 25 : 0) ||
    (["drawing", "completion"].includes(claim.kind) && claim.firecrawlCredits !== 0) || (claim.kind === "scrape" && claim.firecrawlCredits < 1))
    throw new FullSpecBudgetError("Could not confirm the cost of this check.");
  // Firecrawl is tracked for idempotence and pending-request protection only;
  // its credit usage is explicitly outside the user's $10 OpenAI limit.
  const reservedCents = claim.openAiCents;
  if (reservedCents === 0 && claim.firecrawlCredits === 0) throw new FullSpecBudgetError("Could not confirm the cost of this check.");
  const existing = budget.claims.find(row => row.key === claim.key);
  if (existing) {
    if (existing.kind !== claim.kind || existing.openAiCents !== claim.openAiCents || existing.firecrawlCredits !== claim.firecrawlCredits || existing.reservedCents !== reservedCents)
      throw new FullSpecBudgetError("This check has already claimed a different cost. Refresh the review.");
    return { budget, claimed: false };
  }
  if (claim.kind === "drawing" && budget.claims.filter(row => row.kind === "drawing").reduce((sum, row) => sum + row.openAiCents, 0) + claim.openAiCents > 500)
    throw new FullSpecBudgetError("The drawing scan's $5 estimated limit has been reached. Remaining pages need review.");
  if (budget.claims.length >= 8192)
    throw new FullSpecBudgetError("This check has reached its reservation limit. Remaining items need review.");
  if (budget.reservedCents + reservedCents > budget.limitCents)
    throw new FullSpecBudgetError("The $10 estimated check budget has been reached. Remaining items need review.", "budget_exhausted");
  return { budget: { ...budget, reservedCents: budget.reservedCents + reservedCents, claims: [...budget.claims, { ...claim, reservedCents, status: "pending" }] }, claimed: true };
}
