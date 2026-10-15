import { z } from "zod";
import { MAX_CONSTRUCTION_PAGES } from "./constructionDrawingViews";

export const printedPageAreasSchema = z
  .object({
    version: z.literal(1),
    pages: z.number().int().positive().max(MAX_CONSTRUCTION_PAGES),
    labels: z
      .array(
        z.object({
          page: z.number().int().positive().max(MAX_CONSTRUCTION_PAGES),
          area: z.string().trim().min(1).max(160).nullable(),
        }),
      )
      .max(MAX_CONSTRUCTION_PAGES),
  })
  .refine(
    (value) =>
      value.labels.length === value.pages &&
      new Set(value.labels.map((l) => l.page)).size === value.pages &&
      value.labels.every((l) => l.page <= value.pages),
    "The printed area list must cover every PDF page exactly once.",
  );
export type PrintedPageAreas = z.infer<typeof printedPageAreasSchema>;

// Read only an explicitly printed AREA field. Project-room assignments and
// drawing titles are not evidence for the sheet's printed area name.
export function printedAreaFromText(text: string, confidence = 100): string | null {
  if (confidence < 65) return null;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const index = lines.findIndex((line) => /^AREA(?:\s*[:.]|\s*$)/i.test(line));
  if (index < 0) return null;
  const sameLine = lines[index].replace(/^AREA\s*[:.]?\s*/i, "");
  const candidates = sameLine ? [sameLine] : lines.slice(index + 1, index + 4);
  const area: string[] = [];
  for (const line of candidates) {
    if (
      /^(SCALE|DWG\.?|DRAWING|DRAWN|DATE|REVISION|SHEET|PROJECT|DESIGNER|CHECKED|COPYRIGHT|NOTES?)\b/i.test(
        line,
      )
    )
      break;
    if (area.length && /^\d{1,3}$/.test(line)) {
      area.push(line);
      continue;
    }
    if (!/[A-Z]{2}/i.test(line) || /https?:|www\.|@|\d\s*[/'"=]/i.test(line)) break;
    area.push(line);
  }
  const result = area.join(" ").replace(/\s+/g, " ").trim();
  return result.length >= 2 && result.length <= 160 ? result : null;
}

export function printedAreaPageName(page: number, area?: string | null) {
  return area ? `${area} · Page ${page}` : `Page ${page}`;
}
