import { expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractDrawingPageText } from "@/lib/specDrawingText.server";
import { reviewTileInstallation } from "@/lib/tileInstallation";
import type { MaterialItem } from "@/lib/db";

it("reads actual PDF text and resolves a tile's installation details from its same-room callout", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([800, 600]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [n, text] of ["BATH 2 - SHOWER WALL", "TIERRA BASICS NIEVE PUNTO", "SKU: EZTIER0520", "SIZE: 2 X 8", "INSTALL: VERTICAL STRAIGHT SET", "GROUT: OFF WHITE, 1/8 INCH JOINTS", "ID79"].entries())
    page.drawText(text, { x: 50, y: 540 - n * 30, size: 12, font });
  const pages = await extractDrawingPageText(await pdf.save(), 1);
  expect(pages).toHaveLength(1);
  const item = { id: "tile", project_id: "project", room_id: "bath", item_label: "Shower wall tile", category: "Tile & Stone", product_id: "product", is_required: false, not_needed: false,
    product: { id: "product", name: "Tierra Basics Nieve Punto", sku: "EZTIER0520", category: "Tile" } } as MaterialItem;
  const review = reviewTileInstallation([item], [{ id: "bath", name: "Bathroom Two" }], { pages, planStatus: "checked", document: { id: "document", title: "Current construction drawings", updated_at: "current" } });
  expect(review.findings).toEqual([]);
  expect(review.covered.map(row => row.field)).toEqual(["grout", "tile_layout"]);
  expect(review.covered[0].evidence[0]).toMatchObject({ source: "plans", page: 1 });
}, 30000);
