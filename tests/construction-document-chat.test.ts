import { describe, expect, it } from "vitest";
import { shouldCompareConstructionDocumentVersions } from "../src/lib/constructionDocumentChat";

describe("construction document chat", () => {
  it("includes the prior PDF for an explicit version comparison", () => {
    expect(
      shouldCompareConstructionDocumentVersions("What changed from the previous version?"),
    ).toBe(true);
  });

  it("includes the prior PDF when a follow-up relies on comparison context", () => {
    expect(
      shouldCompareConstructionDocumentVersions("Anything else?", [
        { content: "Compare the current plan with the prior revision." },
      ]),
    ).toBe(true);
  });

  it("does not include the prior PDF for a current-document fact question", () => {
    expect(shouldCompareConstructionDocumentVersions("How many square feet is the office?")).toBe(
      false,
    );
  });

  it("does not include the prior PDF for appliance questions", () => {
    expect(shouldCompareConstructionDocumentVersions("What appliances and sizes are shown?")).toBe(
      false,
    );
  });
});
