import { z } from "zod";
import { dimensionInches } from "./measuredProductDimensions";

export const specSelectionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  name: z.string(),
  category: z.string(),
  productId: z.string().uuid().nullable(),
  dimensions: z.string().nullable(),
  imageUrl: z.string().nullable(),
  productUrl: z.string().nullable(),
  finish: z.string().nullable(),
  sku: z.string().nullable(),
  vendor: z.string().nullable(),
  quantity: z.union([z.string(), z.number()]).nullable(),
  notes: z.string().nullable(),
  cadLabel: z.string().nullable(),
});
export type SpecSelection = z.infer<typeof specSelectionSchema>;
const positive = z.number().finite().positive().max(1200);
export const elevationSchema = z
  .object({
    name: z.string().max(180),
    source: z.string().max(500),
    width: positive,
    height: positive,
    depth: positive.nullable(),
    layoutEstimate: z
      .object({
        basis: z.literal("scaled-plan"),
        source: z.string().trim().min(10).max(2000),
        acceptedAt: z.string().datetime(),
        geometry: z.string().min(2).max(120000),
      })
      .optional(),
    elements: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          name: z.string().max(180),
          kind: z.enum([
            "cabinet",
            "countertop",
            "mirror",
            "light",
            "faucet",
            "sink",
            "bench",
            "tile",
            "glass",
            "wall",
            "niche",
            "hardware",
          ]),
          installation: z
            .enum(["freestanding", "wall-mounted", "ceiling-mounted", "built-in"])
            .optional(),
          x: z.number().finite(),
          y: z.number().finite(),
          z: z.number().finite(),
          width: positive,
          height: positive,
          depth: positive,
          specId: z.string().uuid().nullable(),
          dimensionEvidence: z.string().max(2000),
          inferredAxes: z.array(z.enum(["width", "height", "depth", "position"])),
          color: z.string().regex(/^#[0-9a-f]{6}$/i),
          front: z.enum(["drawers", "doors", "open", "solid"]),
        }),
      )
      .max(250),
    questions: z.array(z.string().max(2000)).max(100),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.elements.map((e) => e.id)).size !== value.elements.length)
      ctx.addIssue({ code: "custom", message: "Duplicate drawing element IDs." });
    for (const e of value.elements)
      if (
        e.x - e.width / 2 < -0.25 ||
        e.x + e.width / 2 > value.width + 0.25 ||
        e.y < -0.25 ||
        e.y + e.height > value.height + 0.25
      )
        ctx.addIssue({ code: "custom", message: `${e.name} is outside the drawn elevation.` });
  });
export type MeasuredElevation = z.infer<typeof elevationSchema>;
export type MeasuredElement = MeasuredElevation["elements"][number];
export type DimensionChange = {
  elementId: string;
  name: string;
  axis: string;
  drawing: number;
  spec: number;
};
export type MeasuredProductModel = {
  specId: string;
  dataUrl: string;
  filename: string;
  sourceUrl: string;
  confirmed: boolean;
};
export type RenderReview = {
  changes: DimensionChange[];
  issues: string[];
  elements: Array<
    MeasuredElement & {
      selection: SpecSelection | null;
      dimensionStatus: string;
      appearanceStatus: string;
    }
  >;
  ready: boolean;
};

export function productEnvelope(text: string, kind: MeasuredElement["kind"]) {
  let source = text;
  if (kind === "sink") {
    // Sink manufacturers use length left-to-right and width front-to-back.
    source = text
      .split(/[,;]+/)
      .filter((s) => /^\s*Overall (Length|Width|Height)\s*:/i.test(s))
      .map((s) =>
        s
          .replace(/Overall Length/i, "Width")
          .replace(/Overall Width/i, "Depth")
          .replace(/Overall Height/i, "Height"),
      )
      .join("; ");
  } else if (kind === "faucet") {
    // Spout reach/height and faucet-hole centres aren't the overall body envelope.
    source = text
      .split(/[,;]+/)
      .filter((s) => /^\s*(Overall\s+)?(Width|Height|Depth)\s*:/i.test(s))
      .join("; ");
  }
  return dimensionInches(source, null);
}

/** Spec product envelopes win, while drawing centres and installation locations stay fixed. */
export function reconcileElevation(
  raw: MeasuredElevation,
  selections: SpecSelection[],
  models: MeasuredProductModel[] = [],
): RenderReview {
  const elevation = elevationSchema.parse(raw);
  const byId = new Map(selections.map((s) => [s.id, specSelectionSchema.parse(s)]));
  const changes: DimensionChange[] = [],
    issues = [...elevation.questions];
  if (!elevation.depth)
    issues.push(
      "Room depth is not dimensioned. This is an elevation preview until a plan supplies depth.",
    );
  const elements = elevation.elements.map((input) => {
    const e = { ...input, inferredAxes: [...input.inferredAxes] };
    const selection = e.specId ? byId.get(e.specId) : null;
    if (e.specId && !selection)
      throw new Error(`${e.name} references a selection outside this room.`);
    const productDimensions = selection
      ? productEnvelope(selection.dimensions || "", e.kind)
      : ["", "", ""];
    // Slab/tile stock sizes are material sizes, never a room surface envelope.
    const instance = ["mirror", "light", "faucet", "sink", "hardware"].includes(e.kind);
    for (const [i, axis] of (["width", "height", "depth"] as const).entries()) {
      const n = Number(productDimensions[i]);
      if (!instance || !n) continue;
      if (Math.abs(e[axis] - n) > 0.01)
        changes.push({ elementId: e.id, name: e.name, axis, drawing: e[axis], spec: n });
      // Keep the installation centre vertically for wall-mounted products.
      if (axis === "height" && ["mirror", "light"].includes(e.kind)) e.y += (e.height - n) / 2;
      if (axis === "height" && e.kind === "sink") e.y += e.height - n; // Preserve countertop rim height.
      e[axis] = n;
      e.inferredAxes = e.inferredAxes.filter((a) => a !== axis);
    }
    const missing = instance
      ? (["width", "height", "depth"] as const).filter((_, i) => !Number(productDimensions[i]))
      : [];
    if (instance && !selection) issues.push(`${e.name}: choose its exact Spec Book product.`);
    if (instance && selection && missing.length)
      issues.push(
        `${e.name}: Spec Book lacks unambiguous overall ${missing.join(", ")} dimensions. Drawing values remain visible for review.`,
      );
    if (e.inferredAxes.length)
      issues.push(
        `${e.name}: confirm ${e.inferredAxes.join(", ")} against the construction documents.`,
      );
    if (
      e.x - e.width / 2 < -0.01 ||
      e.x + e.width / 2 > elevation.width + 0.01 ||
      e.y < -0.01 ||
      e.y + e.height > elevation.height + 0.01
    )
      issues.push(
        `${e.name}: the specified product does not fit at the drawn installation location.`,
      );
    const linkedModel = models.find(
      (m) => m.specId === e.specId && m.confirmed && m.sourceUrl === selection?.productUrl,
    );
    const appearanceStatus = linkedModel
      ? "Designer-confirmed product model"
      : selection?.imageUrl
        ? "Product photo available; 3D shape needs verification"
        : selection
          ? "Product visual reference missing"
          : "Drawing geometry";
    // A photograph is evidence of appearance, not a verified manufacturer 3D model.
    if (instance && selection && !linkedModel)
      issues.push(
        `${e.name}: no verified manufacturer 3D model is linked; preview shape is representative.`,
      );
    if (["cabinet", "countertop", "bench", "tile", "hardware"].includes(e.kind)) {
      if (!selection) issues.push(`${e.name}: choose its exact Spec Book material/product.`);
      if (selection && !selection.finish)
        issues.push(`${e.name}: confirm the selected material finish before final rendering.`);
      if (!linkedModel)
        issues.push(`${e.name}: procedural detail and material scale need designer verification.`);
    }
    return {
      ...e,
      selection: selection || null,
      dimensionStatus:
        instance && selection && !missing.length ? "Spec Book dimensions" : "Drawing / review",
      appearanceStatus,
    };
  });
  return { changes, issues: [...new Set(issues)], elements, ready: issues.length === 0 };
}

export function measuredRenderBrief(elevation: MeasuredElevation, review: RenderReview) {
  return [
    "MEASURED RENDER — INCHES",
    "Drawing controls architecture and installation centres. Spec Book controls product envelope dimensions and finish. Do not borrow products from another room.",
    `Source: ${elevation.source}. Elevation: ${elevation.width} × ${elevation.height} inches. Room depth: ${elevation.depth ?? "unspecified"}. z is the object's depth centre, positive toward the viewer; it is not a wall attachment.`,
    ...review.elements.map(
      (e) =>
        `${e.name}: x centre ${e.x}, bottom ${e.y}, z centre ${e.z}, width ${e.width}, height ${e.height}, depth ${e.depth}. Installation: ${e.installation || "unspecified"}. Unverified axes: ${e.inferredAxes.join(", ") || "none"}. Product: ${e.selection?.name || "not assigned"}. Finish: ${e.selection?.finish || "not confirmed"}. SKU: ${e.selection?.sku || "not supplied"}.`,
    ),
    "UNRESOLVED",
    ...review.issues,
  ].join("\n");
}
