import type { MeasuredElevation } from "./measuredRendering";

/** A flat elevation does not establish a freestanding assembly's distance from a wall. */
export function measuredLayoutIssues(elevation: MeasuredElevation): string[] {
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
  return elevation.questions.filter((note) =>
    /opening|open to|through|island|free[ -]?standing|clearance|front.to.back|z offsets?/i.test(
      note,
    ),
  );
}
