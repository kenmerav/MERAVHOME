import { describe, expect, it, vi } from "vitest";
import {
  hasAcceptedScaledLayout,
  measuredLayoutKey,
  measuredLayoutIssues,
  measuredSpatialNotes,
} from "../src/lib/measuredSpatial";
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
  it("retains uncertainty while allowing an explicitly accepted scaled draft, including after storage parsing", () => {
    const source = structuredClone(island);
    source.elements[0].depth = 78;
    source.layoutEstimate = {
      basis: "scaled-plan",
      source: "ID0.1 scaled depth 78 inches; placement remains illustrative.",
      acceptedAt: new Date().toISOString(),
      geometry: measuredLayoutKey(source),
    };
    const saved = elevationSchema.parse(JSON.parse(JSON.stringify(source)));
    expect(hasAcceptedScaledLayout(saved)).toBe(true);
    expect(measuredLayoutIssues(saved)).toEqual([]);
    expect(saved.elements[0].inferredAxes).toEqual(["position", "depth"]);
    expect(saved.questions).toEqual(island.questions);
    expect(reconcileElevation(saved, []).ready).toBe(false);
    expect(
      measuredPhotorealPrompt(saved, reconcileElevation(saved, []), ["Camera", "Drawing"]),
    ).toContain("DESIGNER-ACCEPTED SCALED-PLAN DRAFT, NOT VERIFIED CONSTRUCTION DIMENSIONS");
    saved.elements[0].depth = 80;
    expect(hasAcceptedScaledLayout(saved)).toBe(false);
    expect(measuredLayoutIssues(saved)).toHaveLength(1);
  });
  it("invalidates acceptance when surrounding architecture moves", () => {
    const source = structuredClone(island);
    source.elements.push({
      ...source.elements[0],
      id: "wall",
      name: "Surrounding wall",
      installation: "built-in",
    });
    source.layoutEstimate = {
      basis: "scaled-plan",
      source: "ID0.1 scaled layout accepted for a draft.",
      acceptedAt: new Date().toISOString(),
      geometry: measuredLayoutKey(source),
    };
    source.elements.reverse();
    expect(hasAcceptedScaledLayout(source)).toBe(true);
    source.elements[0].z += 1;
    expect(hasAcceptedScaledLayout(source)).toBe(false);
    expect(measuredLayoutIssues(source)).toHaveLength(1);
  });
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
