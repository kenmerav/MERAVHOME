import { describe, expect, it } from "vitest";
import {
  printedAreaFromText,
  printedAreaPageName,
  printedPageAreasSchema,
} from "../src/lib/constructionPageAreas";
import {
  constructionPageEntries,
  filterConstructionPages,
} from "../src/lib/constructionDrawingViews";

describe("Printed construction sheet area names", () => {
  it("uses the printed AREA field and stops before SCALE or drawing metadata", () => {
    expect(
      printedAreaFromText(
        'DRAWN BY: BSC\nDWG. TITLE:\nELEVATIONS\nAREA:\nPRIMARY BATH\nSCALE:\n1/2" = 1-0"\nDWG NO.\nID2.8',
        85,
      ),
    ).toBe("PRIMARY BATH");
    expect(printedAreaFromText("AREA:KITCHEN\nSCALE: 1/2", 90)).toBe("KITCHEN");
  });
  it("keeps wrapped area names and a bathroom number on its own line", () => {
    expect(printedAreaFromText('AREA\nBATHROOM\n3\nSCALE\n1/2"', 88)).toBe("BATHROOM 3");
    expect(printedAreaFromText("AREA:\nCASITA LIVING ROOM\n& KITCHEN\nSCALE:\n1/2", 80)).toBe(
      "CASITA LIVING ROOM & KITCHEN",
    );
  });
  it("does not invent area labels from the project room, title, dimensions, or uncertain OCR", () => {
    expect(printedAreaFromText("DWG. TITLE:\nPRIMARY BATH ELEVATION\nSCALE: 1/2")).toBeNull();
    expect(printedAreaFromText("AREA:\nPRIMARY BATH\nSCALE:", 40)).toBeNull();
    expect(printedAreaFromText("AREA:\nSCALE:\n1/2")).toBeNull();
    expect(printedAreaFromText('AREA:\n1/2" = 1-0"')).toBeNull();
    expect(printedAreaFromText("AREA SCHEDULE\nKITCHEN")).toBeNull();
  });
  it("adds exact area labels to page names/search without changing physical page order", () => {
    const pages = constructionPageEntries(
      29,
      [],
      [],
      [
        { page: 16, area: "PRIMARY BATH" },
        { page: 29, area: "CASITA BATHROOM" },
      ],
    );
    expect(pages[15].area).toBe("PRIMARY BATH");
    expect(printedAreaPageName(16, pages[15].area)).toBe("PRIMARY BATH · Page 16");
    expect(printedAreaPageName(1, null)).toBe("Page 1");
    expect(filterConstructionPages(pages, "casita bathroom").map((p) => p.page)).toEqual([29]);
    expect(pages.map((p) => p.page)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });
  it("saves complete coverage including pages without a readable AREA, and rejects gaps/duplicates", () => {
    const value = {
      version: 1,
      pages: 2,
      labels: [
        { page: 1, area: null },
        { page: 2, area: "FIRST FLOOR" },
      ],
    };
    expect(printedPageAreasSchema.safeParse(value).success).toBe(true);
    expect(
      printedPageAreasSchema.safeParse({ ...value, labels: [value.labels[0], value.labels[0]] })
        .success,
    ).toBe(false);
    expect(printedPageAreasSchema.safeParse({ ...value, labels: [value.labels[0]] }).success).toBe(
      false,
    );
    expect(
      printedPageAreasSchema.safeParse({
        ...value,
        labels: [value.labels[0], { page: 3, area: "KITCHEN" }],
      }).success,
    ).toBe(false);
  });
});
