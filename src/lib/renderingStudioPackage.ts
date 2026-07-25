import { z } from "zod";

export const RENDERING_STUDIO_PACKAGE_TYPE = "merav-rendering-studio-import";
export const RENDERING_STUDIO_SCHEMA_VERSION = "1.0";

export const renderingStudioPresentationModes = [
  "cad-and-render-side-by-side",
  "cad-then-render",
  "rendering-only",
  "cad-only",
  "final-sheet",
] as const;

export type RenderingStudioPresentationMode = (typeof renderingStudioPresentationModes)[number];

export type RenderingStudioAssetType = "autocad" | "final_rendering" | "final_sheet";

const presentationModeSchema = z.enum(renderingStudioPresentationModes);

const materialSchema = z
  .object({
    id: z.string().min(1),
    room: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    name: z.string().min(1),
    finish: z.string().nullable().optional(),
    quantity: z.number().nullable().optional(),
  })
  .passthrough();

const packagePathSchema = z
  .string()
  .min(1)
  .refine(isSafeRenderingStudioPackagePath, "Asset filenames must be safe relative ZIP paths.");

const elevationSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9._-]+$/, "Elevation IDs contain unsupported characters."),
  sheet: z.string().min(1),
  room: z.string().min(1),
  title: z.string().min(1),
  presentationOrder: z.number().int().positive(),
  cadFilename: packagePathSchema,
  renderFilename: packagePathSchema,
  finalSheetFilename: packagePathSchema,
  materials: z.array(materialSchema).default([]),
  approval: z.string().min(1),
  reviewStatus: z.string().min(1),
});

const manifestSchema = z.object({
  schemaVersion: z.literal(RENDERING_STUDIO_SCHEMA_VERSION),
  packageType: z.literal(RENDERING_STUDIO_PACKAGE_TYPE),
  project: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  sourceDrawingRule: z.string().min(1).optional(),
  presentationDefaults: z
    .object({
      renderingPage: presentationModeSchema.optional(),
      presentation: presentationModeSchema.default("cad-then-render"),
      constructionReference: z.string().min(1).optional(),
    })
    .default({ presentation: "cad-then-render" }),
  elevations: z.array(elevationSchema).min(1).max(200),
});

export type RenderingStudioManifest = z.infer<typeof manifestSchema>;
export type RenderingStudioManifestElevation = RenderingStudioManifest["elevations"][number];

export type RenderingStudioPackageValidation = {
  manifest: RenderingStudioManifest;
  assetCount: number;
  elevationCount: number;
};

export function isSafeRenderingStudioPackagePath(value: string) {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  return value
    .split("/")
    .every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

export function parseRenderingStudioManifest(raw: string | Uint8Array) {
  const source = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("manifest.json is not valid JSON.");
  }

  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    throw new Error(`manifest.json is invalid${location}: ${issue?.message || "Unknown error"}`);
  }

  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const elevation of result.data.elevations) {
    if (ids.has(elevation.id)) {
      throw new Error(`manifest.json contains duplicate elevation ID ${elevation.id}.`);
    }
    if (orders.has(elevation.presentationOrder)) {
      throw new Error(
        `manifest.json contains duplicate presentation order ${elevation.presentationOrder}.`,
      );
    }
    ids.add(elevation.id);
    orders.add(elevation.presentationOrder);
  }

  return {
    ...result.data,
    elevations: [...result.data.elevations].sort(
      (a, b) => a.presentationOrder - b.presentationOrder,
    ),
  };
}

function imageMimeType(bytes: Uint8Array, filename: string) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png" as const;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg" as const;
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp" as const;
  }
  throw new Error(`${filename} is not a supported PNG, JPEG, or WebP image.`);
}

export function validateRenderingStudioPackageEntries(
  entries: Record<string, Uint8Array>,
): RenderingStudioPackageValidation {
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes?.length)
    throw new Error("The ZIP does not contain manifest.json at its root.");
  const manifest = parseRenderingStudioManifest(manifestBytes);
  const referencedPaths = new Set<string>();

  for (const elevation of manifest.elevations) {
    const assets = [
      ["AutoCAD source", elevation.cadFilename],
      ["final rendering", elevation.renderFilename],
      ["final presentation sheet", elevation.finalSheetFilename],
    ] as const;
    for (const [label, filename] of assets) {
      if (referencedPaths.has(filename)) {
        throw new Error(`${filename} is referenced by more than one elevation asset.`);
      }
      referencedPaths.add(filename);
      const bytes = entries[filename];
      if (!bytes?.length) {
        throw new Error(`${elevation.id} is missing its ${label}: ${filename}`);
      }
      imageMimeType(bytes, filename);
    }
  }

  return {
    manifest,
    elevationCount: manifest.elevations.length,
    assetCount: referencedPaths.size,
  };
}

export function renderingStudioAssetMimeType(bytes: Uint8Array, filename: string) {
  return imageMimeType(bytes, filename);
}

export function renderingStudioElevationSlidePrefix(elevationId: string) {
  return `studio-elevation:${elevationId}:`;
}

export function renderingStudioElevationSlideKeys(
  elevationId: string,
  mode: RenderingStudioPresentationMode,
) {
  const prefix = renderingStudioElevationSlidePrefix(elevationId);
  if (mode === "cad-and-render-side-by-side") return [`${prefix}side-by-side`];
  if (mode === "cad-then-render") return [`${prefix}cad`, `${prefix}render`];
  if (mode === "rendering-only") return [`${prefix}render`];
  if (mode === "cad-only") return [`${prefix}cad`];
  return [`${prefix}sheet`];
}

export function isRenderingStudioPresentationMode(
  value: unknown,
): value is RenderingStudioPresentationMode {
  return renderingStudioPresentationModes.includes(value as RenderingStudioPresentationMode);
}
