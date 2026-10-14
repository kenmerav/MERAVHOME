import { describe, it, expect } from "vitest";
import {
  reconcileElevation,
  productEnvelope,
  elevationSchema,
  type SpecSelection,
  type MeasuredElevation,
} from "../src/lib/measuredRendering";
const id = "26cdf682-1ca0-4d74-ac44-bb9b68fff7a3";
const mirror: SpecSelection = {
  id,
  label: "Mirror",
  name: "Thin Metal Frame Mirror",
  category: "Accent Mirrors",
  productId: "c5420b3b-4b2e-4570-bcf5-f5dcc6bfe254",
  dimensions: '20" W x 30" H x 1.5" D',
  finish: "Polished Nickel",
  sku: null,
  vendor: "Rejuvenation",
  quantity: "3",
  notes: null,
  cadLabel: null,
  imageUrl: "https://example.com/mirror.png",
  productUrl: "https://example.com/mirror",
};
const fixture: MeasuredElevation = {
  name: "Spec K elevation 1",
  source: "ID2.8 elevation 1",
  width: 178,
  height: 121,
  depth: 164.5,
  elements: [
    {
      id: "mirror-left",
      name: "Left mirror",
      kind: "mirror",
      x: 31,
      y: 48,
      z: 1,
      width: 24,
      height: 36,
      depth: 1,
      specId: id,
      dimensionEvidence: "24 x 36 and drawn installation centre",
      inferredAxes: ["depth"],
      color: "#babec1",
      front: "solid",
    },
  ],
  questions: [],
};
describe("Spec dimensions take precedence without moving installation centres", () => {
  it("uses overall sink size without confusing basin measurements or front-to-back width", () => {
    expect(
      productEnvelope(
        "Overall Length: 20.25 inches; Overall Width: 15.6875 inches; Overall Height: 7.3125 inches; Basin Length: 17.625 inches; Basin Width: 13.125 inches; Basin Depth: 5.3125 inches",
        "sink",
      ),
    ).toEqual(["20.25", "7.3125", "15.6875"]);
  });
  it("does not treat faucet spout reach or hole centres as its overall envelope", () => {
    expect(
      productEnvelope(
        "Overall Height: 6-5/16 inches; Spout Height: 3-11/16 inches; Spout Reach: 5-5/16 inches; Centers: 8 inches",
        "faucet",
      ),
    ).toEqual(["", "6.3125", ""]);
  });
  it("uses the real Spec K mirror envelope and preserves centre height", () => {
    const r = reconcileElevation(fixture, [mirror]),
      e = r.elements[0];
    expect([e.width, e.height, e.depth]).toEqual([20, 30, 1.5]);
    expect(e.x).toBe(31);
    expect(e.y + e.height / 2).toBe(66);
    expect(r.changes).toHaveLength(3);
    expect(fixture.elements[0].width).toBe(24);
  });
  it("does not turn a room quantity of three into three mirrors on a two-mirror wall", () => {
    expect(reconcileElevation(fixture, [mirror]).elements).toHaveLength(1);
  });
  it("does not certify a photo-backed procedural shape as an exact manufacturer model", () => {
    const r = reconcileElevation(fixture, [mirror]);
    expect(r.ready).toBe(false);
    expect(r.issues.join(" ")).toContain("manufacturer 3D model");
  });
  it("refuses to borrow a product from another room", () => {
    expect(() => reconcileElevation(fixture, [])).toThrow(/outside this room/);
  });
  it("retains ambiguous dimensions for review", () => {
    const r = reconcileElevation(fixture, [
      { ...mirror, dimensions: "Width: 20 inches; Width: 24 inches; Height: 30 inches" },
    ]);
    expect(r.elements[0].width).toBe(24);
    expect(r.issues.join(" ")).toContain("overall width");
  });
  it("never resizes a countertop to its stock slab width", () => {
    const f = structuredClone(fixture);
    f.elements[0].kind = "countertop";
    const r = reconcileElevation(f, [
      { ...mirror, dimensions: "Width: 128 inches; Height: 64.5 inches; Depth: 1.25 inches" },
    ]);
    expect(r.elements[0].width).toBe(24);
    expect(r.changes).toHaveLength(0);
  });
  it("reports a specified product that no longer fits", () => {
    const r = reconcileElevation(fixture, [
      { ...mirror, dimensions: "Width: 90 inches; Height: 30 inches; Depth: 1.5 inches" },
    ]);
    expect(r.issues.join(" ")).toContain("does not fit");
  });
  it("requires plan depth instead of inventing it", () => {
    expect(reconcileElevation({ ...fixture, depth: null }, [mirror]).issues.join(" ")).toContain(
      "Room depth is not dimensioned",
    );
  });
  it("rejects duplicate source identities", () => {
    expect(() =>
      elevationSchema.parse({ ...fixture, elements: [fixture.elements[0], fixture.elements[0]] }),
    ).toThrow(/Duplicate/);
  });
  it("rejects an off-sheet inferred layout", () => {
    expect(() =>
      elevationSchema.parse({ ...fixture, elements: [{ ...fixture.elements[0], x: -20 }] }),
    ).toThrow(/outside/);
  });
});
