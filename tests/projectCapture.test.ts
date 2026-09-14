import { describe, expect, it } from "vitest";
import {
  formatProjectCaptureKnowledge,
  normalizeProjectCaptureAnalysis,
} from "../src/lib/projectCapture";

describe("project capture knowledge", () => {
  it("normalizes handwriting analysis and keeps only supported due dates", () => {
    const result = normalizeProjectCaptureAnalysis({
      summary: "Kitchen walkthrough",
      transcript: "Move the island six inches.",
      visual_notes: ["A plan sketch shows the island beside the pantry."],
      action_items: [
        { text: "Revise island plan", owner: "Katie", due_date: "2026-09-14" },
        { title: "Confirm pendant spacing", due_date: "next week" },
      ],
    });

    expect(result.transcription).toBe("Move the island six inches.");
    expect(result.action_items).toEqual([
      { text: "Revise island plan", owner: "Katie", due_date: "2026-09-14" },
      { text: "Confirm pendant spacing", owner: null, due_date: null },
    ]);
  });

  it("formats a searchable project record with visual evidence", () => {
    const text = formatProjectCaptureKnowledge(
      normalizeProjectCaptureAnalysis({
        summary: "Primary bath review",
        decisions: ["Keep the existing tub location"],
        changes_requested: ["Use two sconces"],
        visual_notes: ["Elevation sketch includes a centered mirror"],
        transcription: "Double vanity. Two sconces.",
      }),
      { kind: "notes" },
    );

    expect(text).toContain("Changes requested:\n- Use two sconces");
    expect(text).toContain(
      "Sketches and visual notes:\n- Elevation sketch includes a centered mirror",
    );
    expect(text).toContain("Handwritten notes transcription:\nDouble vanity. Two sconces.");
  });
});
