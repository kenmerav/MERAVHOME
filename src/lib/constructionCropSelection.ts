import type { DrawingBounds } from "./constructionDrawingViews";

export type CropPoint = { x: number; y: number };
export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const minimum = 0.03;
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

/** Coordinates refer to the displayed sheet itself, independent of screen size. */
export function cropPoint(
  clientX: number,
  clientY: number,
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  },
): CropPoint {
  return {
    x: clamp((clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp((clientY - rect.top) / Math.max(1, rect.height)),
  };
}

export function drawCrop(start: CropPoint, end: CropPoint): DrawingBounds | null {
  const bounds = {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
  return bounds.right - bounds.left >= minimum && bounds.bottom - bounds.top >= minimum
    ? bounds
    : null;
}

export function moveCrop(bounds: DrawingBounds, dx: number, dy: number): DrawingBounds {
  const x = clamp(dx, -bounds.left, 1 - bounds.right);
  const y = clamp(dy, -bounds.top, 1 - bounds.bottom);
  return {
    left: bounds.left + x,
    right: bounds.right + x,
    top: bounds.top + y,
    bottom: bounds.bottom + y,
  };
}

export function resizeCrop(
  bounds: DrawingBounds,
  handle: CropHandle,
  dx: number,
  dy: number,
): DrawingBounds {
  const result = { ...bounds };
  // A small margin avoids floating point rounding below the citation's 3% minimum.
  const gap = minimum + 1e-9;
  if (handle.includes("w")) result.left = clamp(bounds.left + dx, 0, bounds.right - gap);
  if (handle.includes("e")) result.right = clamp(bounds.right + dx, bounds.left + gap, 1);
  if (handle.includes("n")) result.top = clamp(bounds.top + dy, 0, bounds.bottom - gap);
  if (handle.includes("s")) result.bottom = clamp(bounds.bottom + dy, bounds.top + gap, 1);
  return result;
}
