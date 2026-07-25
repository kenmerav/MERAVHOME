import { readFileSync } from "node:fs";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { describe, expect, test } from "vitest";
import {
  parseRenderingStudioManifest,
  renderingStudioElevationSlideKeys,
  validateRenderingStudioPackageEntries,
} from "../src/lib/renderingStudioPackage";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function fixtureManifest() {
  return {
    schemaVersion: "1.0",
    packageType: "merav-rendering-studio-import",
    project: "Fixture Residence",
    generatedAt: "2026-07-24T22:49:31.877Z",
    sourceDrawingRule: "Keep AutoCAD separate.",
    presentationDefaults: {
      renderingPage: "cad-and-render-side-by-side",
      presentation: "cad-then-render",
      constructionReference: "original-autocad-drawing-set",
    },
    elevations: [
      {
        id: "ID2.0-1",
        sheet: "ID2.0",
        room: "Kitchen",
        title: "Sink Wall",
        presentationOrder: 1,
        cadFilename: "cad/sink-cad.png",
        renderFilename: "renders/sink-render.png",
        finalSheetFilename: "final-sheets/sink-sheet.png",
        materials: [{ id: "m1", name: "White oak", quantity: 1 }],
        approval: "approved",
        reviewStatus: "approved",
      },
      {
        id: "ID2.1-1",
        sheet: "ID2.1",
        room: "Living Room",
        title: "Fireplace",
        presentationOrder: 2,
        cadFilename: "cad/fireplace-cad.png",
        renderFilename: "renders/fireplace-render.png",
        finalSheetFilename: "final-sheets/fireplace-sheet.png",
        materials: [],
        approval: "approved",
        reviewStatus: "approved",
      },
    ],
  };
}

function fixtureEntries() {
  const manifest = fixtureManifest();
  const entries: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(manifest)),
  };
  for (const elevation of manifest.elevations) {
    entries[elevation.cadFilename] = PNG_BYTES;
    entries[elevation.renderFilename] = PNG_BYTES;
    entries[elevation.finalSheetFilename] = PNG_BYTES;
  }
  return entries;
}

describe("Rendering Studio package validation", () => {
  test("keeps the three elevation assets separate and follows presentation order", () => {
    const validation = validateRenderingStudioPackageEntries(fixtureEntries());
    expect(validation.elevationCount).toBe(2);
    expect(validation.assetCount).toBe(6);
    expect(validation.manifest.elevations.map((elevation) => elevation.id)).toEqual([
      "ID2.0-1",
      "ID2.1-1",
    ]);
  });

  test("rejects the whole package when one final sheet is missing", () => {
    const entries = fixtureEntries();
    delete entries["final-sheets/fireplace-sheet.png"];
    expect(() => validateRenderingStudioPackageEntries(entries)).toThrow(
      "ID2.1-1 is missing its final presentation sheet",
    );
  });

  test("rejects duplicate presentation positions", () => {
    const manifest = fixtureManifest();
    manifest.elevations[1].presentationOrder = 1;
    expect(() => parseRenderingStudioManifest(JSON.stringify(manifest))).toThrow(
      "duplicate presentation order 1",
    );
  });

  test("builds stable slide keys for all presentation choices", () => {
    expect(renderingStudioElevationSlideKeys("ID2.0-1", "cad-and-render-side-by-side")).toEqual([
      "studio-elevation:ID2.0-1:side-by-side",
    ]);
    expect(renderingStudioElevationSlideKeys("ID2.0-1", "cad-then-render")).toEqual([
      "studio-elevation:ID2.0-1:cad",
      "studio-elevation:ID2.0-1:render",
    ]);
    expect(renderingStudioElevationSlideKeys("ID2.0-1", "rendering-only")).toEqual([
      "studio-elevation:ID2.0-1:render",
    ]);
    expect(renderingStudioElevationSlideKeys("ID2.0-1", "cad-only")).toEqual([
      "studio-elevation:ID2.0-1:cad",
    ]);
    expect(renderingStudioElevationSlideKeys("ID2.0-1", "final-sheet")).toEqual([
      "studio-elevation:ID2.0-1:sheet",
    ]);
  });

  const externalPackagePath = process.env.RENDERING_STUDIO_PACKAGE_PATH;
  const externalTest = externalPackagePath ? test : test.skip;
  externalTest("validates every asset in the supplied Moore Residence package", () => {
    const entries = unzipSync(readFileSync(externalPackagePath!));
    const validation = validateRenderingStudioPackageEntries(entries);
    expect(validation.manifest.project).toBe("Moore Residence");
    expect(validation.elevationCount).toBe(17);
    expect(validation.assetCount).toBe(51);
    expect(
      validation.manifest.elevations.every(
        (elevation) =>
          Boolean(entries[elevation.cadFilename]?.length) &&
          Boolean(entries[elevation.renderFilename]?.length) &&
          Boolean(entries[elevation.finalSheetFilename]?.length),
      ),
    ).toBe(true);
  });

  test("accepts a ZIP round trip without merging asset entries", () => {
    const zipped = zipSync(fixtureEntries());
    const validation = validateRenderingStudioPackageEntries(unzipSync(zipped));
    expect(validation.assetCount).toBe(6);
  });
});
