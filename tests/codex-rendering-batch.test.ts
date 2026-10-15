import { describe, it, expect } from "vitest";
import {
  CODEX_BATCH_INSTRUCTIONS,
  CODEX_BATCH_CHECKS,
  codexBatchReportSchema,
} from "../src/lib/codexRenderingBatch";
describe("subscription batch review contract", () => {
  const report = {
    itemId: "11111111-1111-4111-8111-111111111111",
    fingerprint: "a".repeat(64),
    provider: "codex-subscription",
    status: "review",
    attempts: 1,
    summary: "The layout needs review against the plan.",
    checks: CODEX_BATCH_CHECKS.map((category) => ({
      category,
      outcome: "unknown",
      evidence: "PDF 2 shows adjacency; exact dimensions unknown.",
    })),
    sourcePages: [
      {
        documentId: "22222222-2222-4222-8222-222222222222",
        page: 2,
        reason: "Floor plan adjacency",
      },
    ],
    uncertainties: ["Scaled depth"],
  };
  it("requires all distinct checks and disallows an API provider or unlimited corrections", () => {
    expect(codexBatchReportSchema.safeParse(report).success).toBe(true);
    expect(
      codexBatchReportSchema.safeParse({ ...report, checks: Array(7).fill(report.checks[0]) })
        .success,
    ).toBe(false);
    expect(codexBatchReportSchema.safeParse({ ...report, provider: "api" }).success).toBe(false);
    expect(codexBatchReportSchema.safeParse({ ...report, attempts: 3 }).success).toBe(false);
    expect(codexBatchReportSchema.safeParse({ ...report, attempts: 0 }).success).toBe(false);
    expect(
      codexBatchReportSchema.safeParse({ ...report, status: "blocked", attempts: 0 }).success,
    ).toBe(true);
  });
  it("requires adjacent context before generating, checks output, resumes and never falls back to API", () => {
    expect(CODEX_BATCH_INSTRUCTIONS).toContain("FULL original sheet");
    expect(CODEX_BATCH_INSTRUCTIONS).toContain("adjacent-room elevations");
    expect(CODEX_BATCH_INSTRUCTIONS).toContain(
      "against the source images, not just your own prompt",
    );
    expect(CODEX_BATCH_INSTRUCTIONS).toContain("run-state.json");
    expect(CODEX_BATCH_INSTRUCTIONS).toContain("No API fallback");
  });
});
