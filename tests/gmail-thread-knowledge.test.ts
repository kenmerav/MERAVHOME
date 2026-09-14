import { describe, expect, it } from "vitest";
import { buildGmailThreadKnowledge, mergeCoverageDate } from "../src/lib/gmailThreadKnowledge";

describe("Gmail thread knowledge", () => {
  it("keeps the complete chronological thread, including an older agreement", () => {
    const result = buildGmailThreadKnowledge([
      {
        id: "newer",
        threadId: "thread-1",
        timestamp: Date.parse("2026-06-12T17:00:00Z"),
        subject: "Re: Cabinetry Coordination",
        from: "Katie <katie@meravinteriors.com>",
        to: "Eric <eric@example.com>",
        cc: "",
        body: "Gabrielle will coordinate field measurements.",
        participantEmails: ["katie@meravinteriors.com", "eric@example.com"],
      },
      {
        id: "older",
        threadId: "thread-1",
        timestamp: Date.parse("2026-06-01T16:00:00Z"),
        subject: "Cabinetry Coordination",
        from: "Ken <ken@meravinteriors.com>",
        to: "Eric <eric@example.com>",
        cc: "",
        body: "MERAV will place the cabinet order after final approval.",
        participantEmails: ["ken@meravinteriors.com", "eric@example.com"],
      },
    ]);

    expect(result.coverageStart).toBe("2026-06-01T16:00:00.000Z");
    expect(result.coverageEnd).toBe("2026-06-12T17:00:00.000Z");
    expect(result.body.indexOf("MERAV will place")).toBeLessThan(
      result.body.indexOf("Gabrielle will coordinate"),
    );
    expect(result.messageIds).toEqual(["older", "newer"]);
  });

  it("merges mailbox coverage without overstating its bounds", () => {
    expect(
      mergeCoverageDate("2026-06-12T00:00:00.000Z", "2026-06-01T00:00:00.000Z", "earliest"),
    ).toBe("2026-06-01T00:00:00.000Z");
    expect(
      mergeCoverageDate("2026-09-01T00:00:00.000Z", "2026-09-09T00:00:00.000Z", "latest"),
    ).toBe("2026-09-09T00:00:00.000Z");
  });
});
