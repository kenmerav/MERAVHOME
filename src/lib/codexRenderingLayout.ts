import { z } from "zod";
import { dimensionInches } from "./measuredProductDimensions";
import type { SpecSelection } from "./measuredRendering";

const size = z.number().finite().positive().max(2400);
const point = z.number().finite().min(0).max(2400);
export const layoutEvidenceSchema = z.discriminatedUnion("basis", [
  z.object({
    basis: z.literal("drawing"),
    documentId: z.string().uuid(),
    page: z.number().int().positive(),
    note: z.string().trim().min(5).max(1000),
  }),
  z.object({
    basis: z.literal("spec-book"),
    specId: z.string().uuid(),
    note: z.string().trim().min(5).max(1000),
  }),
  z.object({ basis: z.literal("accepted-estimate"), note: z.string().trim().min(10).max(1000) }),
  z.object({ basis: z.literal("assumption"), note: z.string().trim().min(5).max(1000) }),
]);
const objectSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().trim().min(1).max(180),
  kind: z.enum([
    "cabinet",
    "countertop",
    "tub",
    "toilet",
    "island",
    "shower",
    "glass",
    "wall",
    "opening",
    "access",
    "other",
  ]),
  // Local width is X, height is Y, depth is Z; origin is lower rear left, not centre.
  x: point,
  y: point,
  z: point,
  width: size,
  height: size,
  depth: size,
  quarterTurns: z.number().int().min(0).max(3),
  specId: z.string().uuid().nullable(),
  evidence: z.object({
    width: layoutEvidenceSchema,
    height: layoutEvidenceSchema,
    depth: layoutEvidenceSchema,
    position: layoutEvidenceSchema,
    orientation: layoutEvidenceSchema,
  }),
  enclosureFor: z.string().max(80).optional(),
  accessFor: z.string().max(80).optional(),
});
export const codexLayoutSchema = z
  .object({
    version: z.literal(1),
    units: z.literal("inches"),
    itemId: z.string().uuid(),
    itemFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    extent: z.object({ width: size, height: size, depth: size }),
    objects: z.array(objectSchema).min(1).max(100),
    sourcePages: z
      .array(z.object({ documentId: z.string().uuid(), page: z.number().int().positive() }))
      .min(1)
      .max(30),
    notes: z.array(z.string().trim().min(1).max(1000)).max(30),
  })
  .superRefine((layout, ctx) => {
    if (new Set(layout.objects.map((o) => o.id)).size !== layout.objects.length)
      ctx.addIssue({ code: "custom", message: "Layout object IDs must be unique." });
  });
export type CodexLayout = z.infer<typeof codexLayoutSchema>;
export type LayoutObject = CodexLayout["objects"][number];
export type LayoutCheck = { code: string; outcome: "pass" | "fail" | "unknown"; evidence: string };
export type SavedCodexLayout = {
  layout: CodexLayout;
  fingerprint: string;
  checks: LayoutCheck[];
  ready: boolean;
  savedAt: string;
};
type LayoutItem = {
  id: string;
  fingerprint: string;
  notes: string;
  items: SpecSelection[];
  citation: { documentId: string; page: number };
};
export function layoutBounds(o: LayoutObject) {
  // x/z always locate the minimum corner AFTER the quarter-turn; dimensions remain local.
  return {
    x: o.x,
    y: o.y,
    z: o.z,
    width: o.quarterTurns % 2 ? o.depth : o.width,
    height: o.height,
    depth: o.quarterTurns % 2 ? o.width : o.depth,
  };
}
function overlaps(a: ReturnType<typeof layoutBounds>, b: ReturnType<typeof layoutBounds>) {
  return (
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.1 &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.1 &&
    Math.min(a.z + a.depth, b.z + b.depth) - Math.max(a.z, b.z) > 0.1
  );
}
const critical = new Set(["cabinet", "tub", "toilet", "island", "shower", "opening"]);
const solids = new Set(["cabinet", "tub", "toilet", "island"]);
export function checkCodexLayout(
  raw: CodexLayout,
  item: LayoutItem,
  documentIds: string[],
): { checks: LayoutCheck[]; ready: boolean } {
  const l = codexLayoutSchema.parse(raw),
    checks: LayoutCheck[] = [];
  const add = (code: string, outcome: LayoutCheck["outcome"], evidence: string) =>
    checks.push({ code, outcome, evidence });
  if (l.itemId !== item.id || l.itemFingerprint !== item.fingerprint)
    add("snapshot", "fail", "Layout belongs to a different saved view.");
  else add("snapshot", "pass", "Layout matches the saved drawing and Spec Book snapshot.");
  if (
    !l.sourcePages.some(
      (p) => p.documentId === item.citation.documentId && p.page === item.citation.page,
    ) ||
    l.sourcePages.some((p) => !documentIds.includes(p.documentId))
  )
    add(
      "sources",
      "fail",
      "Cite the selected elevation and only this project's included documents.",
    );
  if (!l.objects.some((o) => critical.has(o.kind)))
    add(
      "coverage",
      "fail",
      "Include the visible major fixtures and openings, not just decorative geometry.",
    );
  for (const o of l.objects) {
    const b = layoutBounds(o);
    if (
      b.x + b.width > l.extent.width + 0.1 ||
      b.y + b.height > l.extent.height + 0.1 ||
      b.z + b.depth > l.extent.depth + 0.1
    )
      add(`bounds:${o.id}`, "fail", `${o.name} is outside the model extent.`);
    for (const [axis, e] of Object.entries(o.evidence)) {
      let valid = e.basis !== "assumption";
      if (
        e.basis === "drawing" &&
        (!documentIds.includes(e.documentId) ||
          !l.sourcePages.some((p) => p.documentId === e.documentId && p.page === e.page))
      )
        valid = false;
      if (e.basis === "spec-book" && !item.items.some((s) => s.id === e.specId)) valid = false;
      if (e.basis === "spec-book" && ["position", "orientation"].includes(axis)) valid = false;
      // An agent's new approval assertion is not acceptance: it must quote frozen user notes.
      if (e.basis === "accepted-estimate" && !item.notes.includes(e.note)) valid = false;
      if (!valid)
        add(
          `evidence:${o.id}:${axis}`,
          critical.has(o.kind) ? "fail" : "unknown",
          `${o.name} ${axis}: ${e.note} (${e.basis}).`,
        );
    }
    if (o.specId && !item.items.some((s) => s.id === o.specId))
      add(`product:${o.id}`, "fail", `${o.name} references a product outside this room.`);
    // Explicit tub length maps to LOCAL depth; rotating a tub never swaps its stored envelope.
    if (o.kind === "tub") {
      const s = item.items.find((s) => s.id === o.specId);
      const text = (s?.dimensions || "")
        .split(/[,;]+/)
        .filter((t) => /^\s*(?:Overall\s+)?(?:Length|Width|Height|Depth)\s*:/i.test(t))
        .join("; ")
        .replace(/\b(?:Overall\s+)?Length\s*:/gi, "Depth:");
      const dims = dimensionInches(text, null).map(Number);
      for (const [i, axis] of (["width", "height", "depth"] as const).entries())
        if (!dims[i] || Math.abs(o[axis] - dims[i]) > 0.05)
          add(
            `tub:${o.id}:${axis}`,
            "fail",
            `${o.name}: model ${axis} ${o[axis]} in; selected tub ${dims[i] || "unspecified"} in. Resolve missing/conflicting product dimensions.`,
          );
      if (
        dims.every(Boolean) &&
        dims.every((n, i) => Math.abs(n - [o.width, o.height, o.depth][i]) <= 0.05)
      )
        add(
          `tub:${o.id}`,
          "pass",
          `${o.name}: selected ${o.width} × ${o.depth} × ${o.height} in envelope retained before orientation.`,
        );
    }
    if (o.kind === "glass") {
      const target = l.objects.find(
        (t) => t.id === o.enclosureFor && ["tub", "shower"].includes(t.kind),
      );
      if (!target) {
        add(`glass:${o.id}`, "fail", `${o.name}: link glass to the actual tub/shower.`);
        continue;
      }
      const t = layoutBounds(target),
        longZ = t.depth >= t.width;
      const edge = longZ
        ? Math.min(Math.abs(b.x - t.x), Math.abs(b.x + b.width - t.x - t.width))
        : Math.min(Math.abs(b.z - t.z), Math.abs(b.z + b.depth - t.z - t.depth));
      const start = longZ ? Math.abs(b.z - t.z) : Math.abs(b.x - t.x);
      const span = longZ ? b.depth : b.width,
        required = longZ ? t.depth : t.width;
      if (
        target.kind === "tub" &&
        (edge > 1 ||
          start > 1 ||
          Math.abs(span - required) > 1 ||
          Math.abs(b.y - (t.y + t.height)) > 1 ||
          (longZ ? b.width : b.depth) > 1)
      )
        add(
          `glass:${o.id}`,
          "fail",
          `${o.name}: tub enclosure must follow the complete long open side and start on its rim; a door across the short end is incorrect.`,
        );
      if (!l.objects.some((a) => a.kind === "access" && a.accessFor === o.id))
        add(
          `access:${o.id}`,
          "fail",
          `${o.name}: include a source-reviewed access/swing envelope outside the enclosure.`,
        );
    }
  }
  for (const a of l.objects.filter((o) => solids.has(o.kind)))
    for (const b of l.objects.filter((o) => solids.has(o.kind) && o.id > a.id))
      if (overlaps(layoutBounds(a), layoutBounds(b)))
        add(`collision:${a.id}:${b.id}`, "fail", `${a.name} overlaps ${b.name}.`);
  for (const a of l.objects.filter((o) => o.kind === "access"))
    for (const b of l.objects.filter((o) => solids.has(o.kind)))
      if (overlaps(layoutBounds(a), layoutBounds(b)))
        add(`access:${a.id}:${b.id}`, "fail", `${a.name} is obstructed by ${b.name}.`);
  for (const a of l.objects.filter((o) => o.kind === "glass"))
    for (const b of l.objects.filter((o) => solids.has(o.kind) && o.id !== a.enclosureFor))
      if (overlaps(layoutBounds(a), layoutBounds(b)))
        add(`glass-collision:${a.id}:${b.id}`, "fail", `${a.name} intersects ${b.name}.`);
  for (const t of l.objects.filter((o) => ["tub", "shower"].includes(o.kind)))
    if (!l.objects.some((o) => o.kind === "glass" && o.enclosureFor === t.id))
      add(
        `enclosure:${t.id}`,
        "fail",
        `${t.name}: include the enclosure footprint before rendering.`,
      );
  const ready = !checks.some((c) => c.outcome === "fail");
  if (ready)
    add(
      "preflight",
      "pass",
      "Envelope/source checks passed. Representative fixture shapes and photo dimensions still require review; no construction certification.",
    );
  return { checks, ready };
}

export const geometryReviewSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    comparisons: z
      .array(
        z.object({
          category: z.enum(["depth", "orientation", "openings", "enclosure", "occlusion"]),
          outcome: z.enum(["pass", "fail", "unknown"]),
          evidence: z.string().trim().min(10).max(1500),
        }),
      )
      .length(5),
  })
  .superRefine((r, ctx) => {
    if (new Set(r.comparisons.map((c) => c.category)).size !== 5)
      ctx.addIssue({
        code: "custom",
        message: "Compare all five geometry categories exactly once.",
      });
  });
export function geometryImportProblem(
  required: boolean | undefined,
  saved: SavedCodexLayout | null,
  report: {
    status: string;
    geometryReview?: z.infer<typeof geometryReviewSchema>;
    checks: { category: string; outcome: string }[];
  },
) {
  if (!required || report.status === "blocked") return null;
  if (!saved?.ready)
    return "Save a layout that passes the geometry checks before rendering this view.";
  if (!report.geometryReview || report.geometryReview.fingerprint !== saved.fingerprint)
    return "Compare the image with the current saved layout; its geometry fingerprint is missing or stale.";
  if (
    report.geometryReview.comparisons.some((c) => c.outcome === "fail") ||
    report.geometryReview.comparisons.some(
      (c) => ["depth", "orientation", "enclosure"].includes(c.category) && c.outcome !== "pass",
    )
  )
    return "Depth, orientation and enclosure must match the model; unresolved geometry stays blocked.";
  if (report.checks.some((c) => c.category === "dimensions" && c.outcome === "pass"))
    return "Generated pixels cannot verify dimensions. Keep the photo dimension check unknown.";
  return null;
}
