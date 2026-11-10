import { expect, it } from "vitest";
import { batchCompletionProposal, executeCompletionBatch, type CompletionBatchEntry } from "@/lib/specCompletionBatch";
import type { SavedCompletionIssue } from "@/lib/savedSpecCompletion";

const issue = (patch: Record<string, unknown> = {}) => ({ status: "open", finding: {
  item_id: "item", field: "color", source: "plans", page: 2, evidence: "The schedule says polished nickel.", suggested: "Polished Nickel", ...patch,
} } as SavedCompletionIssue);

it("offers a source-backed finish as a reviewable proposal", () => {
  expect(batchCompletionProposal(issue())).toEqual({ field: "color", value: "Polished Nickel" });
  expect(batchCompletionProposal(issue({ source: "details", page: null, finish_check: "mismatch" }))).toEqual({ field: "color", value: "Polished Nickel" });
});
it("excludes uncertain finishes, missing evidence, prices, quantities, and shared product dimensions", () => {
  for (const patch of [
    { suggested: "bronze or black" }, { evidence: "" }, { page: null },
    { source: "details", finish_check: "unverified" }, { field: "quantity" }, { field: "price" }, { field: "dimensions" },
  ]) expect(batchCompletionProposal(issue(patch))).toBeNull();
  expect(batchCompletionProposal({ ...issue(), status: "completed" })).toBeNull();
});
it("preserves real two-tone finishes", () => {
  expect(batchCompletionProposal(issue({ suggested: "Matte Black / Brass" }))?.value).toBe("Matte Black / Brass");
});
it("reports exactly what saved and stops after an uncertain write", async () => {
  const entries = ["a", "b", "c"].map(issue_key => ({ issue_key } as CompletionBatchEntry));
  const attempted: string[] = [];
  const result = await executeCompletionBatch(entries, async row => {
    attempted.push(row.issue_key);
    if (row.issue_key === "b") throw new Error("review update failed after material write");
  });
  expect(attempted).toEqual(["a", "b"]);
  expect(result.map(row => row.status)).toEqual(["saved", "check", "not_attempted"]);
  expect(result[1].message).toMatch(/may have saved/);
});
