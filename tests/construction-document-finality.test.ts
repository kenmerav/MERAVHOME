import { describe, expect, it } from "vitest";
import {
  constructionDocumentFamilyKey,
  estimateConstructionDocumentFinality,
  groupConstructionDocumentVersions,
  isConstructionDocumentVersionLater,
} from "../src/lib/constructionDocumentFinality";

describe("construction document finality estimates", () => {
  it.each(["Cortez FINAL Construction Set.pdf", "Cambridge_IFC.pdf", "Rinehart permit-set.pdf"])(
    "treats explicit final filename wording as high-confidence: %s",
    (fileName) => {
      expect(estimateConstructionDocumentFinality({ fileName })).toMatchObject({
        estimate: "likely_final",
        confidence: "high",
      });
    },
  );

  it.each(["Cortez NOT FINAL.pdf", "Cambridge 90% progress set.pdf", "Rinehart_for-review.pdf"])(
    "lets draft filename wording override final-like text: %s",
    (fileName) => {
      expect(estimateConstructionDocumentFinality({ fileName })).toMatchObject({
        estimate: "likely_not_final",
        confidence: "high",
      });
    },
  );

  it("uses email wording when the filename is neutral", () => {
    expect(
      estimateConstructionDocumentFinality({
        fileName: "Cortez CD 09-22-26.pdf",
        emailSubject: "Issued for construction",
        emailBody: "Attached is the final set.",
      }),
    ).toMatchObject({ estimate: "likely_final", confidence: "medium" });
  });

  it("stays unclear rather than guessing when evidence is ambiguous", () => {
    expect(
      estimateConstructionDocumentFinality({
        fileName: "Cortez CD 09-22-26.pdf",
        emailBody: "Here are the latest drawings.",
      }),
    ).toMatchObject({ estimate: "unclear", confidence: "low" });
  });

  it("uses explicit PDF title-block wording and records its page", () => {
    expect(
      estimateConstructionDocumentFinality({
        fileName: "Cortez 260922.pdf",
        pdfPages: [
          { page: 1, text: "COVER SHEET" },
          { page: 2, text: "ISSUED FOR CONSTRUCTION\nDate: 09/22/2026" },
        ],
      }),
    ).toMatchObject({
      estimate: "likely_final",
      confidence: "high",
      documentDate: "2026-09-22",
      evidence: [{ source: "pdf", page: 2 }],
    });
  });

  it("treats conflicting final and not-for-construction evidence as unclear", () => {
    expect(
      estimateConstructionDocumentFinality({
        emailBody: "Attached is the final set.",
        pdfPages: [{ page: 1, text: "PRELIMINARY - NOT FOR CONSTRUCTION" }],
      }),
    ).toMatchObject({ estimate: "unclear", confidence: "medium" });
  });

  it("uses older thread wording only as low-confidence context", () => {
    expect(
      estimateConstructionDocumentFinality({
        fileName: "Cortez drawings.pdf",
        emailBody: "Here are the updated drawings.",
        emailThread: "Earlier message: this is the preliminary review set.",
      }),
    ).toMatchObject({ estimate: "likely_not_final", confidence: "low" });
  });

  it("extracts compact filename dates and groups dated revisions into one family", () => {
    expect(
      estimateConstructionDocumentFinality({ fileName: "CAMBRIDGE_MI_260909.pdf" }).documentDate,
    ).toBe("2026-09-09");
    expect(constructionDocumentFamilyKey("CAMBRIDGE_MI_260826.pdf")).toBe(
      constructionDocumentFamilyKey("CAMBRIDGE_MI_260909.pdf"),
    );
  });

  it("only supersedes a version with an actually later document date", () => {
    expect(
      isConstructionDocumentVersionLater(
        { fileName: "CAMBRIDGE_MI_260909.pdf", documentDate: "2026-09-09" },
        { fileName: "CAMBRIDGE_MI_260826.pdf", documentDate: "2026-08-26" },
      ),
    ).toBe(true);
    expect(
      isConstructionDocumentVersionLater(
        { fileName: "CAMBRIDGE_MI_260826.pdf", documentDate: "2026-08-26" },
        { fileName: "CAMBRIDGE_MI_260909.pdf", documentDate: "2026-09-09" },
      ),
    ).toBe(false);
  });

  it("compares revision numbers naturally when dates are unavailable", () => {
    expect(
      isConstructionDocumentVersionLater(
        { fileName: "Cambridge Rev 10.pdf", revision: "10" },
        { fileName: "Cambridge Rev 2.pdf", revision: "2" },
      ),
    ).toBe(true);
  });

  it("does not mistake review wording for a revision number", () => {
    expect(
      estimateConstructionDocumentFinality({
        fileName: "Cambridge.pdf",
        emailBody: "Attached for review before we proceed.",
      }).revision,
    ).toBeNull();
  });

  it("shows the newest dated version and keeps older versions in history", () => {
    const groups = groupConstructionDocumentVersions([
      {
        id: "old",
        file_name: "CAMBRIDGE_MI_260826.pdf",
        created_at: "2026-09-09T23:20:00Z",
        finality_document_date: "2026-08-26",
        superseded_by_document_id: "latest",
      },
      {
        id: "latest",
        file_name: "CAMBRIDGE_MI_260909.pdf",
        created_at: "2026-09-09T23:10:00Z",
        finality_document_date: "2026-09-09",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].current.id).toBe("latest");
    expect(groups[0].previous.map((document) => document.id)).toEqual(["old"]);
  });

  it("uses upload time when a family does not have a comparable date sequence", () => {
    const groups = groupConstructionDocumentVersions([
      {
        id: "older-upload",
        file_name: "Merged Scans.pdf",
        created_at: "2026-09-09T23:16:00Z",
        finality_document_date: "2026-08-26",
      },
      {
        id: "newer-upload",
        file_name: "Merged Scans.pdf",
        created_at: "2026-09-09T23:17:00Z",
      },
    ]);

    expect(groups[0].current.id).toBe("newer-upload");
  });
});
