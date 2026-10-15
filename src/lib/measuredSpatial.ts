import type { MeasuredElevation } from "./measuredRendering";

// Bind a draft acceptance to the entire entered layout, including nearby architecture.
// Any measurement/placement edit requires another explicit review.
export function measuredLayoutKey(elevation: MeasuredElevation): string {
  return JSON.stringify({
    width: elevation.width,
    height: elevation.height,
    depth: elevation.depth,
    elements: elevation.elements
      .map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        installation: e.installation,
        x: e.x,
        y: e.y,
        z: e.z,
        width: e.width,
        height: e.height,
        depth: e.depth,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export function hasAcceptedScaledLayout(elevation: MeasuredElevation): boolean {
  return (
    elevation.layoutEstimate?.basis === "scaled-plan" &&
    elevation.layoutEstimate.geometry === measuredLayoutKey(elevation)
  );
}

/** A flat elevation does not establish a freestanding assembly's distance from a wall. */
export function measuredLayoutIssues(elevation: MeasuredElevation): string[] {
  if (hasAcceptedScaledLayout(elevation)) return [];
  const assemblies = elevation.elements.filter((e) =>
    e.installation
      ? e.installation === "freestanding"
      : /\b(island|free[ -]?standing)\b/i.test(e.name),
  );
  if (!assemblies.length) return [];
  const uncertainPosition =
    assemblies.some((e) => e.inferredAxes.includes("position")) ||
    elevation.questions.some(
      (q) =>
        /front.to.back|installation offsets?|z offsets?|island.*(?:position|offset|clearance)/i.test(
          q,
        ) &&
        /illustrative|unknown|\bconfirm\b|not supplied|no (?:supporting )?plan|not (?:dimensioned|measured)|unverified|missing/i.test(
          q,
        ),
    );
  const uncertainDepth = assemblies.some((e) => e.inferredAxes.includes("depth"));
  if (!uncertainPosition && !uncertainDepth) return [];
  const name = assemblies.some((e) => /\bisland\b/i.test(e.name))
    ? "Island"
    : "Freestanding furniture";
  return [
    `${name} layout is unverified: ${[uncertainPosition && "position and clearances", uncertainDepth && "depth"].filter(Boolean).join("; ")}. Add a dimensioned floor plan as a supporting view, then read the drawing again before creating an image.`,
  ];
}

export function measuredSpatialNotes(elevation: MeasuredElevation): string[] {
  const notes = elevation.questions.filter((note) =>
    /opening|open to|through|island|free[ -]?standing|clearance|front.to.back|z offsets?/i.test(
      note,
    ),
  );
  return hasAcceptedScaledLayout(elevation)
    ? [
        `DESIGNER-ACCEPTED SCALED-PLAN DRAFT, NOT VERIFIED CONSTRUCTION DIMENSIONS. ${elevation.layoutEstimate!.source} Use the current entered geometry for this draft. Earlier reader notes about illustrative placeholder values are historical and do not override these accepted draft values. Unresolved source questions remain unverified.`,
        ...notes,
      ]
    : notes;
}
