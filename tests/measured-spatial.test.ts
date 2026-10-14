import { describe, expect, it, vi } from "vitest";
import { measuredLayoutIssues, measuredSpatialNotes } from "../src/lib/measuredSpatial";
import {
  elevationSchema,
  measuredRenderBrief,
  reconcileElevation,
  type MeasuredElevation,
} from "../src/lib/measuredRendering";
import { measuredPhotorealPrompt } from "../src/lib/measuredPhotoreal";
import { generateMeasuredPhotoreal } from "../src/lib/measuredPhotoreal.server";

const island: MeasuredElevation = {
  name: "Kitchen",
  source: "Kitchen elevation",
  width: 372.5,
  height: 133,
  depth: null,
  questions: [
    "All nonzero z offsets are illustrative; no supporting plan was supplied.",
    "The central area is an opening to the dining room, not a solid wall.",
  ],
  elements: [
    {
      id: "island",
      name: "Island countertop",
      kind: "countertop",
      x: 186,
      y: 36,
      z: 48,
      width: 160,
      height: 1.25,
      depth: 36,
      specId: null,
      dimensionEvidence: "Depth and position illustrative",
      inferredAxes: ["position", "depth"],
      color: "#ffffff",
      front: "solid",
    },
  ],
};
describe("freestanding layout and source architecture", () => {
  it("blocks the reported elevation-only island even though it has numeric placeholder depths", () => {
    const issues = measuredLayoutIssues(island);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("position and clearances");
    expect(issues[0]).toContain("depth");
    expect(issues[0]).toContain("dimensioned floor plan");
  });
  it("does not mistake a known product depth or room size for a confirmed island position", () => {
    const source = structuredClone(island);
    source.depth = 240;
    source.elements[0].inferredAxes = ["position"];
    expect(measuredLayoutIssues(source)).toHaveLength(1);
    source.elements[0].inferredAxes = [];
    expect(measuredLayoutIssues(source)).toHaveLength(1); // Source explicitly still calls the offsets illustrative.
  });
  it("accepts confirmed island offsets without requiring an unrelated whole-room depth", () => {
    const source = structuredClone(island);
    source.questions = [island.questions[1]];
    source.elements[0].inferredAxes = [];
    source.elements[0].dimensionEvidence =
      "Depth and placement confirmed by dimensioned supporting plan";
    source.questions.push("Island position and clearances confirmed by dimensioned plan.");
    expect(measuredLayoutIssues(source)).toEqual([]);
  });
  it("uses typed installation for newly read scenes and retains compatibility with older ones", () => {
    const source = structuredClone(island);
    source.elements[0].name = "Centre cabinet";
    source.elements[0].installation = "freestanding";
    expect(measuredLayoutIssues(elevationSchema.parse(source))).toHaveLength(1);
    source.elements[0].installation = "built-in";
    expect(measuredLayoutIssues(source)).toEqual([]);
    expect(elevationSchema.parse(island)).toEqual(island);
  });
  it("keeps the opening fact and depth centre in the image brief instead of asking for a full wall", () => {
    const review = reconcileElevation(island, []);
    const prompt = measuredPhotorealPrompt(island, review, ["Camera", "Drawing"]);
    expect(measuredRenderBrief(island, review)).toContain("z centre 48");
    expect(prompt).toContain(
      "SOURCE SPATIAL NOTE (retain any stated uncertainty): The central area is an opening to the dining room, not a solid wall.",
    );
    expect(prompt).toContain("never fill it with plaster, shiplap");
    expect(prompt).not.toContain("Show the full designed wall");
    expect(measuredSpatialNotes(island)).toContain(island.questions[1]);
  });
  it("rejects an unverified island before contacting the paid image service", async () => {
    const fetcher = vi.fn();
    await expect(
      generateMeasuredPhotoreal(island, reconcileElevation(island, []), [], fetcher),
    ).rejects.toThrow("layout is unverified");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
