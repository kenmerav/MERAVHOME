import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  checkCodexLayout,
  codexLayoutSchema,
  geometryImportProblem,
  geometryReviewSchema,
  layoutBounds,
  type CodexLayout,
  type LayoutObject,
  type SavedCodexLayout,
} from "../src/lib/codexRenderingLayout";
import { codexLayoutModel, codexLayoutSvg } from "../src/lib/codexLayoutModel";
import { CODEX_LAYOUT_INSTRUCTIONS } from "../src/lib/codexRenderingLayoutInstructions";
const id = "11111111-1111-4111-8111-111111111111",
  doc = "22222222-2222-4222-8222-222222222222",
  spec = "33333333-3333-4333-8333-333333333333";
const drawing = {
  basis: "drawing" as const,
  documentId: doc,
  page: 2,
  note: "Written geometry in test floor plan.",
};
const product = {
  basis: "spec-book" as const,
  specId: spec,
  note: "Selected tub 60 long x30 wide x18 high.",
};
const object = (extra: Partial<LayoutObject>): LayoutObject => ({
  id: "vanity",
  name: "Vanity",
  kind: "cabinet",
  x: 0,
  y: 0,
  z: 0,
  width: 42,
  height: 36,
  depth: 24,
  quarterTurns: 0,
  specId: null,
  evidence: {
    width: drawing,
    height: drawing,
    depth: drawing,
    position: drawing,
    orientation: drawing,
  },
  ...extra,
});
const item = {
  id,
  fingerprint: "a".repeat(64),
  notes: "",
  citation: { documentId: doc, page: 27 },
  items: [
    {
      id: spec,
      dimensions:
        "Height: 18in, Length: 60in, Width: 30in, Basin Length: 44-1/2in, Basin Width: 22in",
    },
  ] as any,
};
function layout(): CodexLayout {
  return {
    version: 1,
    units: "inches",
    itemId: id,
    itemFingerprint: item.fingerprint,
    extent: { width: 109, height: 121, depth: 60 },
    objects: [
      object({}),
      object({
        id: "toilet",
        name: "Toilet",
        kind: "toilet",
        x: 51,
        width: 20,
        height: 30,
        depth: 30,
      }),
      object({
        id: "tub",
        name: "Tub",
        kind: "tub",
        x: 79,
        width: 30,
        height: 18,
        depth: 60,
        specId: spec,
        evidence: {
          width: product,
          height: product,
          depth: product,
          position: drawing,
          orientation: drawing,
        },
      }),
      object({
        id: "glass",
        name: "Long side glass",
        kind: "glass",
        x: 79,
        y: 18,
        width: 0.375,
        height: 66,
        depth: 60,
        enclosureFor: "tub",
      }),
      object({
        id: "access",
        name: "Access",
        kind: "access",
        x: 49,
        z: 35,
        width: 30,
        height: 84,
        depth: 24,
        accessFor: "glass",
      }),
    ],
    sourcePages: [
      { documentId: doc, page: 2 },
      { documentId: doc, page: 27 },
    ],
    notes: [],
  };
}
const check = (l: CodexLayout) => checkCodexLayout(l, item, [doc]);
describe("source-linked layout preflight", () => {
  it("accepts full 60-inch tub depth with unobstructed long-side access", () => {
    expect(check(layout()).ready).toBe(true);
  });
  it("rejects the exact shallow-tub error even if all submitted source notes claim it is correct", () => {
    const l = layout();
    l.objects.find((o) => o.id === "tub")!.depth = 30;
    expect(check(l).checks.some((c) => c.code === "tub:tub:depth" && c.outcome === "fail")).toBe(
      true,
    );
    expect(check(l).ready).toBe(false);
  });
  it("does not treat basin dimensions as overall tub size", () => {
    const l = layout();
    const tub = l.objects.find((o) => o.id === "tub")!;
    tub.width = 22;
    tub.depth = 44.5;
    expect(check(l).ready).toBe(false);
  });
  it("rejects glass across the short end", () => {
    const l = layout(),
      g = l.objects.find((o) => o.id === "glass")!;
    g.z = 59.625;
    g.width = 30;
    g.depth = 0.375;
    expect(check(l).checks.some((c) => c.code === "glass:glass" && c.outcome === "fail")).toBe(
      true,
    );
  });
  it("rejects glass starting on floor instead of tub rim or covering only part of the length", () => {
    for (const patch of [{ y: 0 }, { depth: 30 }]) {
      const l = layout();
      Object.assign(
        l.objects.find((o) => o.id === "glass")!,
        patch,
      );
      expect(check(l).ready).toBe(false);
    }
  });
  it("blocks collisions and an access envelope obstructed by toilet", () => {
    const l = layout();
    l.objects.find((o) => o.id === "access")!.z = 10;
    expect(check(l).checks.some((c) => c.code.includes("access:access:toilet"))).toBe(true);
    const l2 = layout();
    l2.objects.find((o) => o.id === "toilet")!.x = 30;
    expect(check(l2).checks.some((c) => c.code.startsWith("collision:"))).toBe(true);
  });
  it("keeps critical assumed depths blocked; noncritical glass assumptions stay visible", () => {
    const l = layout();
    l.objects[0].evidence.depth = {
      basis: "assumption",
      note: "Typical vanity depth, not written.",
    };
    expect(check(l).ready).toBe(false);
    const l2 = layout();
    l2.objects.find((o) => o.kind === "glass")!.evidence.height = {
      basis: "assumption",
      note: "Presentation glass height needs review.",
    };
    expect(check(l2).ready).toBe(true);
    expect(check(l2).checks.some((c) => c.outcome === "unknown")).toBe(true);
  });
  it("does not accept agent-invented estimate approval or foreign source references", () => {
    const l = layout();
    l.objects[0].evidence.depth = {
      basis: "accepted-estimate",
      note: "User approved typical depth.",
    };
    expect(check(l).ready).toBe(false);
    l.objects[0].evidence.depth = { ...drawing, documentId: spec };
    expect(check(l).ready).toBe(false);
    l.objects[0].evidence.depth = product;
    l.objects[0].evidence.position = product;
    expect(check(l).ready).toBe(false);
  });
  it("validates rotation, bounds, unique IDs, and missing major geometry", () => {
    const o = object({ width: 30, depth: 60, quarterTurns: 1 });
    expect(layoutBounds(o)).toMatchObject({ width: 60, depth: 30 });
    const l = layout();
    l.objects[0].x = 100;
    expect(check(l).ready).toBe(false);
    const dup = layout();
    dup.objects[1].id = dup.objects[0].id;
    expect(codexLayoutSchema.safeParse(dup).success).toBe(false);
    const empty = layout();
    empty.objects = empty.objects.filter((o) => o.kind === "access");
    expect(check(empty).ready).toBe(false);
  });
  it("builds actual numeric 3D geometry and portable views with escaped names", () => {
    const l = layout(),
      model = codexLayoutModel(l),
      tub = model.getObjectByName("Tub")!;
    const b = new THREE.Box3().setFromObject(tub),
      size = new THREE.Vector3();
    b.getSize(size);
    expect(size.x).toBeCloseTo(30);
    expect(size.y).toBeCloseTo(18);
    expect(size.z).toBeCloseTo(60);
    l.objects[0].name = '<script>alert("x")</script>';
    for (const v of ["plan", "front", "angled"] as const) {
      const svg = codexLayoutSvg(l, v);
      expect(svg).toContain("60");
      expect(svg).not.toContain("<script>");
      expect(svg).toContain("&lt;script&gt;");
    }
  });
});
describe("photo import gate", () => {
  const saved: SavedCodexLayout = {
    layout: layout(),
    fingerprint: "b".repeat(64),
    ...check(layout()),
    savedAt: new Date().toISOString(),
  };
  const review = () => ({
    status: "review",
    checks: [{ category: "dimensions", outcome: "unknown" }],
    geometryReview: {
      fingerprint: saved.fingerprint,
      comparisons: (["depth", "orientation", "openings", "enclosure", "occlusion"] as const).map(
        (category) => ({
          category,
          outcome: "pass" as const,
          evidence: "Compared output with numeric geometry model and sources.",
        }),
      ),
    },
  });
  it("requires a saved passing layout and current fingerprint", () => {
    expect(geometryImportProblem(true, null, review())).toContain("Save a layout");
    expect(geometryImportProblem(true, { ...saved, ready: false }, review())).toContain(
      "Save a layout",
    );
    const r = review();
    r.geometryReview.fingerprint = "c".repeat(64);
    expect(geometryImportProblem(true, saved, r)).toContain("stale");
    expect(geometryImportProblem(true, saved, review())).toBeNull();
  });
  it("keeps unknown/failed depth, orientation or glass blocked, and never certifies photo dimensions", () => {
    const r: any = review();
    r.geometryReview.comparisons[0].outcome = "unknown";
    expect(geometryImportProblem(true, saved, r)).toContain("must match");
    r.geometryReview.comparisons[0].outcome = "pass";
    r.checks[0].outcome = "pass";
    expect(geometryImportProblem(true, saved, r)).toContain("pixels");
  });
  it("allows blocked handoff without an image and preserves old versions", () => {
    expect(geometryImportProblem(true, null, { status: "blocked", checks: [] })).toBeNull();
    expect(geometryImportProblem(undefined, null, { status: "review", checks: [] })).toBeNull();
  });
  it("requires five distinct comparisons and layout-first subscription instructions", () => {
    const r = review();
    expect(geometryReviewSchema.safeParse(r.geometryReview).success).toBe(true);
    r.geometryReview.comparisons[1] = r.geometryReview.comparisons[0];
    expect(geometryReviewSchema.safeParse(r.geometryReview).success).toBe(false);
    expect(CODEX_LAYOUT_INSTRUCTIONS).toContain("BEFORE");
    expect(CODEX_LAYOUT_INSTRUCTIONS).toContain("No paid API");
  });
});
