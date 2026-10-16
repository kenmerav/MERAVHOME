import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { buildSpecSpreadsheetRows, specProductHref } from "@/lib/specBookRows";
import { SpecDrawingSelectionDetails } from "@/components/SpecDrawingSelectionDetails";
import { SpecConstructionDrawingsView } from "@/components/SpecConstructionDrawingsView";
import type { MaterialItem } from "@/lib/db";

const rooms = [{ id: "bath", name: "Bathroom Two" }];
const item = {
  id: "tile",
  room_id: "bath",
  item_label: "Shower Wall",
  client_product_name: "Bathroom Two Shower Wall",
  category: "Tile & Stone",
  cad_label: "T-14",
  quantity: null,
  quantity_tbd: true,
  quantity_unit: "square_feet",
  color: "Nieve",
  image_url: "selected-image.webp",
  product_url: "https://example.test/selected-variant",
  notes: "Install vertically.\nUse 1/8 inch grout.",
  ordered_by: "Contractor",
  ordered: false,
  product_id: "product",
  not_needed: false,
  product: {
    id: "product",
    name: "Tierra Linear Nieve Punto",
    vendor: "Tiles of Ezra",
    sku: "EZTIER0520",
    finish: "Glazed",
    dimensions: "2 × 8 inches",
    price: "18.50",
    price_unit: "sq_ft",
    product_url: "https://example.test/catalog-default",
    image_url: "catalog-image.webp",
  },
  room_product: { approval_status: "declined" },
} as MaterialItem;
const full = {
  showPricing: true,
  showLinks: true,
  showOrdering: true,
  hideInternalProductDetails: false,
};
const row = () => buildSpecSpreadsheetRows([item], rooms)[0];
const render = (visibility = full) =>
  renderToStaticMarkup(createElement(SpecDrawingSelectionDetails, { row: row(), visibility }));

describe("complete spec information alongside construction drawings", () => {
  it("keeps complete specs visible before drawings expand, including items with an unassigned room", () => {
    const unknown = { ...item, id: "unassigned", room_id: "deleted-room", client_product_name: "Unassigned Wall Tile" };
    const html = renderToStaticMarkup(createElement(SpecConstructionDrawingsView, {
      projectId: "project", projectName: "Test project", items: [item, unknown], rooms,
      specRows: buildSpecSpreadsheetRows([item, unknown], rooms), visibility: full,
    }));
    expect(html).toContain("Bathroom Two Shower Wall");
    expect(html).toContain("2 × 8 inches");
    expect(html).toContain("Install vertically.");
    expect(html).toContain("Unassigned Wall Tile");
    expect(html).toContain('aria-expanded="false"');
  });
  it("does not leak the hidden catalog name or SKU through the drawing item header", () => {
    const html = renderToStaticMarkup(createElement(SpecConstructionDrawingsView, {
      projectId: "project", projectName: "Test project", items: [item], rooms,
      visibility: { ...full, hideInternalProductDetails: true },
    }));
    expect(html).toContain("Bathroom Two Shower Wall");
    expect(html).not.toContain("Tierra Linear");
    expect(html).not.toContain("EZTIER0520");
  });
  it("uses the selected image, link and client name, preserving TBD and the price basis", () => {
    expect(row()).toMatchObject({
      imageUrl: "selected-image.webp",
      productUrl: item.product_url,
      clientProductName: "Bathroom Two Shower Wall",
      quantity: "TBD",
      quantityUnit: "square_feet",
      clientPrice: "$18.50",
      priceUnit: "sq_ft",
      status: "Needs re-selection",
    });
    const html = render();
    for (const value of [
      "Bathroom Two",
      "Tile &amp; Stone",
      "Shower Wall",
      "T-14",
      "TBD",
      "Sq Ft",
      "Nieve",
      "Glazed",
      "2 × 8 inches",
      "Tiles of Ezra",
      "EZTIER0520",
      "$18.50 / sq ft",
      "Contractor",
      "No",
      "Needs re-selection",
      "Install vertically.",
    ])
      expect(html).toContain(value);
    expect(html).toContain(`href="${item.product_url}"`);
    expect(html).not.toContain("catalog-default");
  });
  it("keeps the existing external-role restrictions for price, links, ordering and internal product details", () => {
    const html = render({
      showPricing: false,
      showLinks: false,
      showOrdering: false,
      hideInternalProductDetails: true,
    });
    for (const value of [
      "$18.50",
      "example.test",
      "Contractor",
      "EZTIER0520",
      "Tierra Linear",
      "Needs re-selection",
      ">Ordered<",
      ">Product Name<",
    ])
      expect(html).not.toContain(value);
    expect(html).toContain("Glazed");
    expect(html).toContain("2 × 8 inches");
    expect(html).toContain("Install vertically.");
  });
  it("preserves explicit zero quantities and does not invent prices for missing values", () => {
    const [zero] = buildSpecSpreadsheetRows(
      [{ ...item, quantity: 0, quantity_tbd: false, product: { ...item.product!, price: null } }],
      rooms,
    );
    expect(zero.quantity).toBe("0");
    expect(zero.clientPrice).toBe("");
  });
  it("keeps unlocated selections in the shared rows while excluding removed items", () => {
    const rows = buildSpecSpreadsheetRows(
      [
        item,
        { ...item, id: "removed", not_needed: true },
        { ...item, id: "no-sku", product: { ...item.product!, sku: null } },
      ],
      rooms,
    );
    expect(rows.map((r) => r.id)).toEqual(["tile", "no-sku"]);
  });
  it("does not turn non-web product links into executable URLs", () => {
    expect(specProductHref("javascript:alert(1)")).toBeNull();
    expect(specProductHref("example.test/product")).toBe("https://example.test/product");
  });
});
