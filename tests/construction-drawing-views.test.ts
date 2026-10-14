import { describe, it, expect } from "vitest";
import {
  cleanConstructionViews,
  roomDrawingViews,
  drawingCropPixels,
  drawingBoundsSchema,
  constructionPageEntries,
  filterConstructionPages,
  constructionPreviewKey,
  drawingCitationSchema,
} from "../src/lib/constructionDrawingViews";
const primary = "33333333-3333-4333-8333-333333333333",
  casita = "44444444-4444-4444-8444-444444444444";
const rooms = [{ id: primary }, { id: casita }];
const view = {
  id: "ID2.8-1",
  roomId: primary,
  title: "Primary bathroom — elevation 1",
  sheet: "ID2.8",
  page: 2,
  kind: "elevation",
  bounds: { left: 0.03, top: 0.1, right: 0.45, bottom: 0.75 },
  evidence: "View title and primary bathroom keyed plan callout.",
};
const result = {
  complete: true,
  reviewedPages: [1, 2],
  views: [
    view,
    {
      ...view,
      id: "ID2.8-2",
      title: "Primary bathroom — elevation 2",
      bounds: { left: 0.51, top: 0.1, right: 0.95, bottom: 0.75 },
    },
    { ...view, id: "ID2.8-3", roomId: casita, title: "Casita bathroom" },
    { ...view, id: "detail-unclear", roomId: null },
  ],
};
describe("Construction room view selection", () => {
  it("lists every physical page even when most pages have no indexed room match", () => {
    const views = cleanConstructionViews(result, rooms, 2);
    const pages = constructionPageEntries(31, views, [
      { id: primary, name: "Primary bathroom" },
      { id: casita, name: "Casita bathroom" },
    ]);
    expect(pages).toHaveLength(31);
    expect(pages.map((p) => p.page)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(pages[30]).toMatchObject({ page: 31, sheets: [], views: [] });
    expect(pages[1].views).toHaveLength(4);
    expect(pages[1].label).toContain("Primary bathroom");
    expect(pages[1].label).toContain("Casita bathroom");
    expect(constructionPageEntries(600, [])).toHaveLength(600);
  });
  it("searches physical page numbers exactly and uses saved sheet/room labels", () => {
    const pages = constructionPageEntries(31, [view], [{ id: primary, name: "Primary bathroom" }]);
    expect(filterConstructionPages(pages, "16").map((p) => p.page)).toEqual([16]);
    expect(filterConstructionPages(pages, "ID2.8").map((p) => p.page)).toEqual([2]);
    expect(filterConstructionPages(pages, "primary bathroom").map((p) => p.page)).toEqual([2]);
    expect(filterConstructionPages(pages, " ")).toHaveLength(31);
    expect(filterConstructionPages(pages, "missing sheet")).toHaveLength(0);
  });
  it("cannot reuse an old document/page/crop preview for the next selection", () => {
    const key = constructionPreviewKey("source-a", 16, view.bounds);
    expect(constructionPreviewKey("source-b", 16, view.bounds)).not.toBe(key);
    expect(constructionPreviewKey("source-a", 17, view.bounds)).not.toBe(key);
    expect(constructionPreviewKey("source-a", 16, { ...view.bounds, right: 1 })).not.toBe(key);
    expect(constructionPreviewKey("source-a", 16, { ...view.bounds })).toBe(key);
  });
  it("retains citations for pages after 500 without weakening crop or source identity validation", () => {
    const citation = {
      documentId: primary,
      documentTitle: "Drawings",
      sourceKey: "a".repeat(64),
      viewId: "manual-page-601",
      title: "Page 601",
      sheet: "PDF page 601",
      page: 601,
      bounds: view.bounds,
    };
    expect(drawingCitationSchema.parse(citation).page).toBe(601);
    expect(drawingCitationSchema.safeParse({ ...citation, page: 0 }).success).toBe(false);
    expect(drawingCitationSchema.safeParse({ ...citation, sourceKey: "invalid" }).success).toBe(
      false,
    );
  });
  it("leaves duplicate room names for manual matching", () => {
    const views = cleanConstructionViews(
      result,
      [
        { id: primary, name: "Bathroom" },
        { id: casita, name: "Bathroom" },
      ],
      2,
    );
    expect(roomDrawingViews(views, primary)).toEqual([]);
  });
  it("keeps two elevations separate and excludes other/unclear rooms", () => {
    const views = cleanConstructionViews(result, rooms, 2);
    expect(roomDrawingViews(views, primary).map((v) => v.id)).toEqual(["ID2.8-1", "ID2.8-2"]);
    expect(roomDrawingViews(views, casita)).toHaveLength(1);
  });
  it("rejects partial page coverage and impossible physical citations", () => {
    expect(() => cleanConstructionViews({ ...result, reviewedPages: [1] }, rooms, 2)).toThrow();
    expect(() =>
      cleanConstructionViews({ ...result, views: [{ ...view, page: 3 }] }, rooms, 2),
    ).toThrow();
  });
  it("rejects unknown project rooms and duplicate view identities", () => {
    expect(() => cleanConstructionViews(result, [{ id: primary }], 2)).toThrow();
    expect(() => cleanConstructionViews({ ...result, views: [view, view] }, rooms, 2)).toThrow();
  });
  it("rejects inverted, out-of-page or unreadably small crops", () => {
    expect(
      drawingBoundsSchema.safeParse({ left: 0.8, right: 0.4, top: 0.1, bottom: 0.8 }).success,
    ).toBe(false);
    expect(drawingBoundsSchema.safeParse({ left: 0, right: 1.1, top: 0, bottom: 1 }).success).toBe(
      false,
    );
    expect(drawingBoundsSchema.safeParse({ left: 0, right: 0.01, top: 0, bottom: 1 }).success).toBe(
      false,
    );
  });
  it("uses upright top-left page coordinates without chopping dimension edges", () => {
    expect(
      drawingCropPixels({ left: 0.25, top: 0.1, right: 0.75, bottom: 0.9 }, 2000, 1000),
    ).toEqual({ x: 500, y: 100, width: 1000, height: 800 });
  });
});
