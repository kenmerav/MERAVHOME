import { z } from "zod";

export const MAX_CONSTRUCTION_PAGES = 100000;

export const drawingBoundsSchema = z
  .object({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    right: z.number().min(0).max(1),
    bottom: z.number().min(0).max(1),
  })
  .refine(
    (b) => b.right - b.left >= 0.03 && b.bottom - b.top >= 0.03,
    "Choose a readable drawing area within the page.",
  );
export type DrawingBounds = z.infer<typeof drawingBoundsSchema>;
export type ConstructionDrawingView = {
  id: string;
  roomId: string | null;
  title: string;
  sheet: string;
  page: number;
  kind: "elevation" | "plan" | "section" | "detail";
  bounds: DrawingBounds;
  evidence: string;
};
export const drawingCitationSchema = z.object({
  documentId: z.string().uuid(),
  documentTitle: z.string().max(300),
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/),
  viewId: z.string().max(120),
  title: z.string().max(200),
  sheet: z.string().max(100),
  page: z.number().int().positive().max(MAX_CONSTRUCTION_PAGES),
  bounds: drawingBoundsSchema,
});
export type DrawingCitation = z.infer<typeof drawingCitationSchema>;

export function cleanConstructionViews(
  value: unknown,
  rooms: { id: string; name?: string }[],
  pages: number,
) {
  const result = z
    .object({
      complete: z.literal(true),
      reviewedPages: z.array(z.number().int().positive()),
      views: z
        .array(
          z.object({
            id: z.string().min(1).max(120),
            roomId: z.string().uuid().nullable(),
            title: z.string().min(1).max(200),
            sheet: z.string().min(1).max(100),
            page: z.number().int().positive(),
            kind: z.enum(["elevation", "plan", "section", "detail"]),
            bounds: drawingBoundsSchema,
            evidence: z.string().min(1).max(1000),
          }),
        )
        .max(500),
    })
    .parse(value);
  if (
    result.reviewedPages.length !== pages ||
    new Set(result.reviewedPages).size !== pages ||
    result.reviewedPages.some((p) => p > pages) ||
    new Set(result.views.map((v) => v.id)).size !== result.views.length ||
    result.views.some((v) => v.page > pages || (v.roomId && !rooms.some((r) => r.id === v.roomId)))
  )
    throw Error("The drawing list is incomplete or refers to an unknown room/page.");
  const ambiguous = new Set(
    rooms
      .filter(
        (r) =>
          r.name &&
          rooms.filter((other) => other.name?.trim().toLowerCase() === r.name?.trim().toLowerCase())
            .length > 1,
      )
      .map((r) => r.id),
  );
  return result.views
    .map((v) => (ambiguous.has(v.roomId || "") ? { ...v, roomId: null } : v))
    .sort(
      (a, b) => a.page - b.page || a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left,
    );
}
export function roomDrawingViews(views: ConstructionDrawingView[], roomId: string) {
  return views.filter((v) => v.roomId === roomId);
}
export function constructionPageEntries(
  pages: number,
  views: ConstructionDrawingView[],
  rooms: { id: string; name: string }[] = [],
) {
  if (!Number.isSafeInteger(pages) || pages < 0 || pages > MAX_CONSTRUCTION_PAGES)
    throw Error("This PDF has an unsupported page count.");
  const byPage = new Map<number, ConstructionDrawingView[]>();
  for (const view of views) byPage.set(view.page, [...(byPage.get(view.page) || []), view]);
  return Array.from({ length: pages }, (_, index) => {
    const page = index + 1,
      pageViews = byPage.get(page) || [];
    const sheets = [...new Set(pageViews.map((v) => v.sheet))];
    const names = [
      ...new Set(pageViews.map((v) => rooms.find((r) => r.id === v.roomId)?.name).filter(Boolean)),
    ];
    const label = [`Page ${page}`, ...sheets, ...pageViews.map((v) => v.title), ...names].join(
      " · ",
    );
    return { page, sheets, label, views: pageViews };
  });
}
export function filterConstructionPages<T extends { page: number; label: string }>(
  pages: T[],
  search: string,
): T[] {
  const query = search.trim().toLowerCase();
  if (!query) return pages;
  return pages.filter((p) =>
    /^\d+$/.test(query) ? p.page === Number(query) : p.label.toLowerCase().includes(query),
  );
}
export function constructionPreviewKey(
  documentKey: string | undefined,
  page: number,
  bounds: DrawingBounds,
) {
  return JSON.stringify([
    documentKey || "",
    page,
    bounds.left,
    bounds.top,
    bounds.right,
    bounds.bottom,
  ]);
}
export function drawingCropPixels(bounds: DrawingBounds, width: number, height: number) {
  const b = drawingBoundsSchema.parse(bounds);
  const x = Math.floor(b.left * width),
    y = Math.floor(b.top * height);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(b.right * width) - x),
    height: Math.max(1, Math.ceil(b.bottom * height) - y),
  };
}
