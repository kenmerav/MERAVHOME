import { describe, expect, it } from "vitest";
import {
  buildCodexCorrectionPrompt,
  buildCodexRenderingPrompt,
  defaultRenderingResultFilename,
  matchRenderingResultFilenames,
} from "../src/lib/renderingStudioWorkflow";

const elevation = {
  elevationId: "E2.1",
  sheetNumber: "A5.2",
  roomName: "Kitchen",
  title: "Range Wall",
  presentationOrder: 1,
  expectedRenderFilename: "E2.1_Kitchen_Range_Wall.png",
  expectedSheetFilename: "E2.1_Kitchen_Range_Wall_sheet.png",
  autocadFilename: "cad/E2.1.png",
  materials: [
    {
      name: "White oak cabinets",
      category: "Cabinet Finish",
      imagePath: "materials/spec-book/cabinet_white-oak.jpg",
    },
  ],
};

describe("Rendering Studio workflow", () => {
  it("builds strict rendering instructions with exact filenames", () => {
    const prompt = buildCodexRenderingPrompt({
      projectName: "Moore Residence",
      packFilename: "Moore_Residence_Codex_Render_Pack.zip",
      elevations: [elevation],
    });
    expect(prompt).toContain("authoritative source for geometry");
    expect(prompt).toContain("E2.1_Kitchen_Range_Wall.png");
    expect(prompt).toContain("Do not place AutoCAD dimensions");
    expect(prompt).toContain("materials/spec-book/cabinet_white-oak.jpg");
    expect(prompt).toContain("Open and use every listed Spec Book visual-reference image");
  });

  it("limits correction prompts to elevations with correction notes", () => {
    const prompt = buildCodexCorrectionPrompt({
      projectName: "Moore Residence",
      elevations: [
        { ...elevation, correctionNote: "Keep the original three cabinet doors." },
        {
          ...elevation,
          elevationId: "E2.2",
          expectedRenderFilename: "E2.2.png",
          correctionNote: null,
        },
      ],
    });
    expect(prompt).toContain("E2.1");
    expect(prompt).not.toContain("E2.2");
    expect(prompt).toContain("Change only what the correction note requires");
  });

  it("matches exact rendering and final-sheet filenames", () => {
    const result = matchRenderingResultFilenames(
      [
        {
          elevationId: elevation.elevationId,
          expectedRenderFilename: elevation.expectedRenderFilename,
          expectedSheetFilename: elevation.expectedSheetFilename,
        },
      ],
      [elevation.expectedRenderFilename, elevation.expectedSheetFilename, "wrong-name.png"],
    );
    expect(result.matches).toHaveLength(2);
    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual(["wrong-name.png"]);
  });

  it("creates safe default filenames", () => {
    expect(defaultRenderingResultFilename("E 2/1", "Primary Bath")).toBe(
      "E_2-1_Primary_Bath_render.png",
    );
  });

  it("matches a complete 17-elevation return without merging asset types", () => {
    const elevations = Array.from({ length: 17 }, (_, index) => {
      const id = `ELEV-${String(index + 1).padStart(2, "0")}`;
      return {
        elevationId: id,
        expectedRenderFilename: `${id}_render.png`,
        expectedSheetFilename: `${id}_sheet.png`,
      };
    });
    const filenames = elevations.flatMap((item) => [
      item.expectedRenderFilename,
      item.expectedSheetFilename,
    ]);
    const result = matchRenderingResultFilenames(elevations, filenames);

    expect(result.matches).toHaveLength(34);
    expect(result.matches.filter((match) => match.assetType === "final_rendering")).toHaveLength(
      17,
    );
    expect(result.matches.filter((match) => match.assetType === "final_sheet")).toHaveLength(17);
    expect(result.missing).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });
});
