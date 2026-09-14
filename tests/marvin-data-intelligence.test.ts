import { describe, expect, it } from "vitest";
import {
  buildDeterministicStudioFacts,
  formatVerificationBlock,
  isCorrectionMessage,
  marvinDataDictionaryPrompt,
  normalizeStudioReadRequest,
  requiresIndependentVerification,
} from "../src/lib/marvinDataIntelligence";

describe("MERAV data intelligence dictionary", () => {
  it("does not confuse a specified product with an order", () => {
    const dictionary = marvinDataDictionaryPrompt();
    expect(dictionary).toContain("Specified does not mean approved, purchased, ordered");
    expect(dictionary).toContain("An intention to order");
    expect(dictionary).toContain("is not an order");
  });

  it("does not turn incomplete retrieval into proof of absence", () => {
    expect(marvinDataDictionaryPrompt()).toContain("It is not proof the event never happened");
  });
});

describe("read-only Studio investigator boundaries", () => {
  it("enforces the project selected by the user", () => {
    expect(
      normalizeStudioReadRequest(
        {
          dataset: "tasks",
          project_id: "another-project",
          limit: 999,
          search: "cabinetry",
        },
        "selected-project",
      ),
    ).toEqual({
      dataset: "tasks",
      project_id: "selected-project",
      status: null,
      date_from: null,
      date_to: null,
      search: "cabinetry",
      limit: 50,
    });
  });

  it("rejects unknown datasets and invalid dates", () => {
    const request = normalizeStudioReadRequest({
      dataset: "raw_sql",
      date_from: "yesterday",
      date_to: "2026-09-10",
      limit: -1,
    });
    expect(request.dataset).toBe("projects");
    expect(request.date_from).toBeNull();
    expect(request.date_to).toBe("2026-09-10");
    expect(request.limit).toBe(1);
  });
});

describe("deterministic answer checks", () => {
  it("keeps Kaufman-style specifications separate from approved and ordered products", () => {
    const facts = buildDeterministicStudioFacts(
      {
        scope: "project",
        project: { id: "kaufman", name: "Kaufman", status: "Design" },
        operations: null,
        tasks: [],
        milestones: [],
        products: [
          { id: "cabinet", approved: true },
          { id: "tile", approved: false },
          { id: "lighting", approved: false },
        ],
        procurement: [{ room_product_id: "cabinet", ordered: false }],
        invoices: [],
        invoicePayments: [],
        documents: [],
      },
      "2026-09-10",
    );
    expect(facts.product_counts).toEqual({
      specified: 3,
      explicitly_approved: 1,
      explicitly_ordered: 0,
      explicitly_received: 0,
      explicitly_installed: 0,
    });
  });

  it("calculates overdue work only from unfinished dated records", () => {
    const facts = buildDeterministicStudioFacts(
      {
        scope: "project",
        project: { id: "alma", name: "Alma", status: "Design" },
        operations: { lifecycle_status: "active" },
        tasks: [
          { status: "open", due_date: "2026-09-09" },
          { status: "complete", due_date: "2026-09-01" },
          { status: "open", due_date: null },
        ],
        milestones: [
          { status: "in_progress", target_date: "2026-09-08" },
          { status: "complete", target_date: "2026-09-01" },
        ],
        products: [],
        procurement: [],
        invoices: [],
        invoicePayments: [],
        documents: [],
      },
      "2026-09-10",
    );
    expect(facts.task_counts.overdue).toBe(1);
    expect(facts.milestone_counts.overdue).toBe(1);
  });

  it("routes material assertions through second-pass verification", () => {
    expect(requiresIndependentVerification("Did Ken agree to order the cabinetry?")).toBe(true);
    expect(requiresIndependentVerification("How many square feet is the office?")).toBe(true);
    expect(requiresIndependentVerification("Draft a friendly hello")).toBe(false);
  });

  it("captures corrections for approval instead of silently learning them", () => {
    expect(isCorrectionMessage("That is not correct, we already had the presentation.")).toBe(true);
    expect(isCorrectionMessage("What is due this week?")).toBe(false);
  });

  it("makes unsupported answers visibly unsafe to rely on", () => {
    expect(
      formatVerificationBlock({
        verdict: "unsupported",
        confidence: "low",
        summary: "The order date is not present in the retrieved evidence.",
        unsupported_claims: ["The order was placed June 1"],
        conflicts: [],
      }),
    ).toContain("Verification: Not verified");
  });
});
