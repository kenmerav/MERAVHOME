import { z } from "zod";

export const renderingStudioWorkflowStatuses = [
  "source_files_uploaded",
  "ready_for_codex",
  "rendering_in_progress",
  "pending_review",
  "approved",
  "rejected",
  "correction_requested",
  "superseded",
] as const;

export type RenderingStudioWorkflowStatus = (typeof renderingStudioWorkflowStatuses)[number];

export type RenderingStudioPromptElevation = {
  elevationId: string;
  sheetNumber: string;
  roomName: string;
  title: string;
  presentationOrder: number;
  expectedRenderFilename: string;
  expectedSheetFilename?: string | null;
  autocadFilename: string;
  materials: Array<{
    name: string;
    category?: string | null;
    finish?: string | null;
    quantity?: number | null;
    notes?: string | null;
    vendor?: string | null;
    imagePath?: string | null;
  }>;
  correctionNote?: string | null;
};

export const handoffManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  packageType: z.literal("merav-rendering-studio-handoff"),
  project: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  instructionsFilename: z.string().min(1),
  sourceFiles: z.array(
    z.object({
      type: z.enum(["autocad", "specification", "supporting_material"]),
      label: z.string().min(1),
      filename: z.string().min(1),
      packagePath: z.string().min(1),
    }),
  ),
  elevations: z
    .array(
      z.object({
        id: z.string().min(1),
        sheet: z.string().min(1),
        room: z.string().min(1),
        title: z.string().min(1),
        presentationOrder: z.number().int().positive(),
        autocadFilename: z.string().min(1),
        expectedRenderFilename: z.string().min(1),
        expectedSheetFilename: z.string().min(1).optional(),
        materials: z.array(z.record(z.unknown())).default([]),
      }),
    )
    .min(1),
});

export type RenderingStudioHandoffManifest = z.infer<typeof handoffManifestSchema>;

export function safeRenderingResultFilename(value: string) {
  return value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/_+/g, "_")
    .slice(0, 180);
}

export function defaultRenderingResultFilename(
  elevationId: string,
  roomName: string,
  suffix = "render",
) {
  const base = safeRenderingResultFilename(`${elevationId}_${roomName}_${suffix}`);
  return `${base || "elevation_render"}.png`;
}

export function buildCodexRenderingPrompt({
  projectName,
  elevations,
  packFilename,
}: {
  projectName: string;
  elevations: RenderingStudioPromptElevation[];
  packFilename: string;
}) {
  const ordered = [...elevations].sort((a, b) => a.presentationOrder - b.presentationOrder);
  const list = ordered
    .map((elevation, index) => {
      const materials = elevation.materials.length
        ? elevation.materials
            .map((material) =>
              [
                material.name,
                material.vendor,
                material.category,
                material.finish,
                material.quantity ? `qty ${material.quantity}` : null,
                material.notes,
                material.imagePath ? `visual reference: ${material.imagePath}` : null,
              ]
                .filter(Boolean)
                .join(" | "),
            )
            .join("; ")
        : "No active project materials are assigned to this room.";
      return [
        `${index + 1}. ${elevation.elevationId} | Sheet ${elevation.sheetNumber} | ${elevation.roomName} | ${elevation.title}`,
        `   AutoCAD source: ${elevation.autocadFilename}`,
        `   Required rendering filename: ${elevation.expectedRenderFilename}`,
        elevation.expectedSheetFilename
          ? `   Required final-sheet filename: ${elevation.expectedSheetFilename}`
          : null,
        `   Assigned materials: ${materials}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return `MERAV RENDERING STUDIO HANDOFF

Project: ${projectName}
Render pack: ${packFilename}

Open and use the supplied render pack. Copying this prompt alone does not provide access to any private project files.

PROCESS RULES
- Process elevations one at a time in the manifest order below.
- The AutoCAD image for each elevation is the authoritative source for geometry, cabinetry, openings, fixtures, quantities, perspective, and vertical terminations.
- Use the assigned project Spec Book materials and optional supporting references only to determine finishes and product appearance.
- Open and use every listed Spec Book visual-reference image for the elevation where it is assigned. Do not apply a material image to another room or location.
- Preserve source-accurate geometry and camera framing.
- Do not add speculative design changes, furniture, openings, cabinetry, fixtures, or architectural details.
- Do not place AutoCAD dimensions, linework, labels, or annotations over the AI rendering.
- Keep every rendering as a clean standalone image.
- Save every result using its exact required filename.
- After generating each result, compare it to its AutoCAD source. Correct one clearly proven mismatch once before moving to the next elevation.
- Package all completed result images into one ZIP for return to MERAVHOME. Do not rename files inside the results ZIP.

ELEVATIONS

${list}

RETURN CHECKLIST
- Every manifest elevation has one correctly named rendering and final sheet.
- AutoCAD geometry was preserved.
- Assigned materials were used only in their indicated locations.
- No dimensions or drawing annotations appear over renderings.
- The results ZIP contains image files only, with exact filenames.`;
}

export function buildCodexCorrectionPrompt({
  projectName,
  elevations,
}: {
  projectName: string;
  elevations: RenderingStudioPromptElevation[];
}) {
  const rejected = elevations
    .filter((elevation) => elevation.correctionNote?.trim())
    .sort((a, b) => a.presentationOrder - b.presentationOrder);
  const list = rejected
    .map((elevation, index) =>
      [
        `${index + 1}. ${elevation.elevationId} | ${elevation.roomName}`,
        `   AutoCAD source: ${elevation.autocadFilename}`,
        `   Replacement filename: ${elevation.expectedRenderFilename}`,
        elevation.expectedSheetFilename
          ? `   Replacement final-sheet filename: ${elevation.expectedSheetFilename}`
          : null,
        `   Required correction: ${elevation.correctionNote!.trim()}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  return `MERAV RENDERING STUDIO CORRECTION HANDOFF

Project: ${projectName}

Process only the rejected elevations below, in this exact order.

CORRECTION RULES
- Treat each AutoCAD drawing as the authoritative geometry source.
- Change only what the correction note requires.
- Preserve all already-correct geometry, cabinetry, openings, fixtures, quantities, materials, camera position, crop, and lighting direction.
- Do not introduce speculative design changes.
- Do not place AutoCAD dimensions, linework, labels, or annotations over the corrected rendering.
- Save each replacement using its exact required filename.
- Package the corrected files into one ZIP for return to MERAVHOME.

REJECTED ELEVATIONS

${list || "No rejected elevations currently require correction."}`;
}

export type RenderingStudioResultMatch = {
  elevationId: string;
  assetType: "final_rendering" | "final_sheet";
  expectedFilename: string;
  uploadedFilename: string;
};

export function matchRenderingResultFilenames(
  elevations: Array<{
    elevationId: string;
    expectedRenderFilename: string;
    expectedSheetFilename?: string | null;
  }>,
  uploadedFilenames: string[],
) {
  const normalizedUploads = new Map<string, string[]>();
  uploadedFilenames.forEach((filename) => {
    const base = filename.split("/").pop()?.toLocaleLowerCase() || "";
    const values = normalizedUploads.get(base) ?? [];
    values.push(filename);
    normalizedUploads.set(base, values);
  });

  const matches: RenderingStudioResultMatch[] = [];
  const missing: string[] = [];
  const duplicates: string[] = [];
  const used = new Set<string>();

  for (const elevation of elevations) {
    const expected = [
      {
        filename: elevation.expectedRenderFilename,
        assetType: "final_rendering" as const,
        required: true,
      },
      {
        filename: elevation.expectedSheetFilename || "",
        assetType: "final_sheet" as const,
        required: Boolean(elevation.expectedSheetFilename),
      },
    ];
    for (const item of expected) {
      if (!item.filename) continue;
      const candidates = normalizedUploads.get(item.filename.toLocaleLowerCase()) ?? [];
      if (candidates.length > 1) {
        duplicates.push(item.filename);
        candidates.forEach((candidate) => used.add(candidate));
        continue;
      }
      if (!candidates.length) {
        if (item.required) missing.push(item.filename);
        continue;
      }
      const uploadedFilename = candidates[0];
      used.add(uploadedFilename);
      matches.push({
        elevationId: elevation.elevationId,
        assetType: item.assetType,
        expectedFilename: item.filename,
        uploadedFilename,
      });
    }
  }

  return {
    matches,
    missing,
    duplicates,
    unexpected: uploadedFilenames.filter((filename) => !used.has(filename)),
  };
}
