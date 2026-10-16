import { drawingNameEvidence, drawingNameWords } from "./specDrawingNameMatches";
import {
  drawingSkuAppears,
  type DrawingMatchBounds,
  type DrawingMatchItem,
} from "./specDrawingMatches";

export type DrawingTextRun = { text: string; bounds: DrawingMatchBounds };
export type DrawingCalloutHighlight = DrawingTextRun & {
  basis: "sku" | "product_name" | "room_item";
};
type TextItem = { str: string; transform: number[]; width: number; height: number };
type Viewport = { transform: number[]; width: number; height: number; scale: number };

/** Convert PDF baselines into the same upright, normalized coordinate system
 * used by the rendered sheet, including page rotation and nonzero view boxes. */
export function drawingTextRuns(items: unknown[], viewport: Viewport): DrawingTextRun[] {
  const v = viewport.transform;
  if (!(viewport.width > 0 && viewport.height > 0)) return [];
  return items.flatMap((value) => {
    const item = value as TextItem;
    if (
      typeof item?.str !== "string" ||
      !item.str.trim() ||
      !Array.isArray(item.transform) ||
      item.transform.length !== 6
    )
      return [];
    const t = item.transform;
    const x = v[0] * t[4] + v[2] * t[5] + v[4];
    const y = v[1] * t[4] + v[3] * t[5] + v[5];
    const angle = Math.atan2(v[1] * t[0] + v[3] * t[1], v[0] * t[0] + v[2] * t[1]);
    const height = Math.hypot(v[0] * t[2] + v[2] * t[3], v[1] * t[2] + v[3] * t[3]);
    const width = Math.abs(item.width * viewport.scale);
    if (![x, y, angle, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
      return [];
    const sin = Math.sin(angle),
      cos = Math.cos(angle);
    const points = [
      [x + sin * height * 0.85, y - cos * height * 0.85],
      [x + sin * height * 0.85 + cos * width, y - cos * height * 0.85 + sin * width],
      [x - sin * height * 0.2, y + cos * height * 0.2],
      [x - sin * height * 0.2 + cos * width, y + cos * height * 0.2 + sin * width],
    ];
    const bounds = {
      left: Math.max(0, Math.min(...points.map((p) => p[0])) / viewport.width),
      right: Math.min(1, Math.max(...points.map((p) => p[0])) / viewport.width),
      top: Math.max(0, Math.min(...points.map((p) => p[1])) / viewport.height),
      bottom: Math.min(1, Math.max(...points.map((p) => p[1])) / viewport.height),
    };
    return bounds.right > bounds.left && bounds.bottom > bounds.top
      ? [{ text: item.str.trim(), bounds }]
      : [];
  });
}
function union(runs: DrawingTextRun[]): DrawingMatchBounds {
  return {
    left: Math.min(...runs.map((r) => r.bounds.left)),
    top: Math.min(...runs.map((r) => r.bounds.top)),
    right: Math.max(...runs.map((r) => r.bounds.right)),
    bottom: Math.max(...runs.map((r) => r.bounds.bottom)),
  };
}
function textLines(runs: DrawingTextRun[]) {
  const lines: DrawingTextRun[] = [];
  for (const run of [...runs].sort(
    (a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left,
  )) {
    const height = run.bounds.bottom - run.bounds.top;
    const line = lines.find(
      (line) =>
        Math.abs(line.bounds.top - run.bounds.top) <
          Math.min(height, line.bounds.bottom - line.bounds.top) * 0.45 &&
        run.bounds.left >= line.bounds.right - 0.002 &&
        run.bounds.left - line.bounds.right < Math.max(0.012, height * 2.5),
    );
    if (line) {
      line.text += ` ${run.text}`;
      line.bounds = union([line, run]);
    } else lines.push({ text: run.text, bounds: { ...run.bounds } });
  }
  return lines.sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
}

/** Boxes surround actual matching callout text, never a guessed fixture or
 * every object on a room-fallback page. Retain separate repeated callouts. */
export function drawingCalloutHighlights(
  runs: DrawingTextRun[],
  item: DrawingMatchItem,
  items: DrawingMatchItem[],
  roomVerified: boolean,
): DrawingCalloutHighlight[] {
  const lines = textLines(runs),
    highlights: DrawingCalloutHighlight[] = [];
  for (const first of lines) {
    const block = [first];
    for (let n = 0; n < 2; n++) {
      const last = block[block.length - 1],
        height = last.bounds.bottom - last.bounds.top;
      const next = lines.find(
        (line) =>
          line.bounds.top >= last.bounds.bottom - height * 0.25 &&
          line.bounds.top - last.bounds.bottom < Math.max(0.012, height * 2) &&
          Math.abs(line.bounds.left - first.bounds.left) < 0.025,
      );
      if (!next || block.includes(next)) break;
      block.push(next);
    }
    const text = block.map((line) => line.text).join(" ");
    if (/\b(existing|demolish|remove|not used)\b/i.test(text)) continue;
    const sku = item.sku.replace(/[^a-z0-9]/gi, "");
    const skuFound = sku.length >= 5 && !/^\d{1,5}$/.test(sku) && drawingSkuAppears(item.sku, text);
    const name = skuFound
      ? null
      : drawingNameEvidence(
          item,
          block.map((line) => line.text),
          items,
          roomVerified,
        );
    if (!skuFound && (!name || name.ambiguous)) continue;
    // Surface/location words such as "shower wall" are not proof that a
    // decorative-band or wall-title callout refers to this particular tile.
    if (
      name?.basis === "room_item" &&
      !name.words.some((word) =>
        /^(sink|faucet|toilet|drain|strainer|sconce|pendant|chandelier|mirror|hook|towel|knob|pull|backplate|filler|system)$/.test(
          word,
        ),
      )
    )
      continue;
    let quoted: DrawingTextRun[] = [];
    if (skuFound) {
      for (let size = 1; size <= block.length && !quoted.length; size++) {
        for (let start = 0; start + size <= block.length; start++) {
          const candidate = block.slice(start, start + size);
          if (drawingSkuAppears(item.sku, candidate.map((line) => line.text).join(" "))) {
            quoted = candidate;
            break;
          }
        }
      }
    } else {
      quoted = block.filter((line) =>
        drawingNameWords(line.text).some((word) => name!.words.includes(word)),
      );
    }
    if (!quoted.length) continue;
    const bounds = union(quoted);
    const padded = {
      left: Math.max(0, bounds.left - 0.004),
      top: Math.max(0, bounds.top - 0.003),
      right: Math.min(1, bounds.right + 0.004),
      bottom: Math.min(1, bounds.bottom + 0.003),
    };
    const existing = highlights.find(
      (mark) =>
        Math.min(mark.bounds.right, padded.right) > Math.max(mark.bounds.left, padded.left) &&
        Math.min(mark.bounds.bottom, padded.bottom) > Math.max(mark.bounds.top, padded.top),
    );
    if (existing) {
      existing.bounds = union([existing, { text: "", bounds: padded }]);
      if (skuFound) existing.basis = "sku";
    } else
      highlights.push({
        text: quoted.map((line) => line.text).join(" · "),
        bounds: padded,
        basis: skuFound ? "sku" : name!.basis,
      });
  }
  const identified = highlights.filter((mark) => mark.basis !== "room_item");
  return identified.length ? identified : highlights;
}
