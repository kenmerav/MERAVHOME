import { describe, it, expect } from "vitest";
import {
  cropPoint,
  drawCrop,
  moveCrop,
  resizeCrop,
  type CropHandle,
} from "../src/lib/constructionCropSelection";
import { drawingBoundsSchema, drawingCropPixels } from "../src/lib/constructionDrawingViews";

describe("visual construction crop selection", () => {
  const bounds = { left: 0.2, top: 0.3, right: 0.7, bottom: 0.8 };
  it("maps the displayed sheet to the original pixels regardless of screen position and scale", () => {
    const rect = { left: 100, top: 200, width: 800, height: 600 };
    const start = cropPoint(260, 380, rect),
      end = cropPoint(660, 680, rect);
    expect(drawCrop(start, end)).toEqual(bounds);
    expect(drawingCropPixels(drawCrop(start, end)!, 3200, 2400)).toEqual({
      x: 640,
      y: 720,
      width: 1600,
      height: 1200,
    });
    expect(cropPoint(420, 560, { ...rect, width: 1600, height: 1200 })).toEqual(start);
  });
  it("supports dragging in reverse and clamps a pointer outside the sheet", () => {
    expect(drawCrop({ x: 0.7, y: 0.8 }, { x: 0.2, y: 0.3 })).toEqual(bounds);
    expect(cropPoint(-200, 900, { left: 100, top: 200, width: 800, height: 600 })).toEqual({
      x: 0,
      y: 1,
    });
  });
  it("ignores clicks and tiny boxes that cannot be used as a drawing citation", () => {
    expect(drawCrop({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toBeNull();
    expect(drawCrop({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.8 })).toBeNull();
  });
  it("moves without changing size or allowing any edge outside the source", () => {
    const lowerLeft = moveCrop(bounds, -1, 1);
    expect(lowerLeft.left).toBe(0);
    expect(lowerLeft.bottom).toBe(1);
    expect(lowerLeft.top).toBeCloseTo(0.5);
    expect(lowerLeft.right).toBeCloseTo(0.5);
    const moved = moveCrop(bounds, 1, -1);
    expect(moved.right).toBe(1);
    expect(moved.top).toBe(0);
    expect(moved.right - moved.left).toBeCloseTo(0.5);
    expect(moved.bottom - moved.top).toBeCloseTo(0.5);
  });
  it("keeps all eight handles valid when dragged past the opposite edge or source boundary", () => {
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as CropHandle[]) {
      for (const offset of [-2, 2]) {
        const resized = resizeCrop(bounds, handle, offset, offset);
        expect(drawingBoundsSchema.safeParse(resized).success).toBe(true);
        if (!handle.includes("w")) expect(resized.left).toBe(bounds.left);
        if (!handle.includes("e")) expect(resized.right).toBe(bounds.right);
        if (!handle.includes("n")) expect(resized.top).toBe(bounds.top);
        if (!handle.includes("s")) expect(resized.bottom).toBe(bounds.bottom);
      }
    }
  });
});
