import { describe, expect, it } from "vitest";
import { pdfSelectionNameMismatch, keepNamedProductForGenericBoard, latestBoardProduct } from "@/lib/specProductIdentity";
import { checkSpecDetails } from "@/lib/specCompletion";

const link = "https://media.arizonatile.com/pis/docs/slab/Quartzite/Bella.pdf";
const material = { id: "item", room_id: "room", category: "Countertops", item_label: "Countertop",
  product_id: "product", product_url: link, color: "Bella Quartzite", quantity: 1, not_needed: false,
  product: { id: "product", name: "CARRASCO Quartzite", product_url: link, finish: "Bella Quartzite", price: null } } as any;

describe("Spec product identity review", () => {
  it("flags Bartow's mismatch using both the linked PDF name and selected color", () => {
    const findings = checkSpecDetails([material], [{ id: "room", name: "Kitchen" }]);
    expect(findings.filter(f => f.field === "product")).toMatchObject([{ item_id: "item", current: "CARRASCO Quartzite" }]);
  });
  it("does not flag a matching product, generic label, generic PDF, or unsupported source", () => {
    expect(pdfSelectionNameMismatch(link, "Bella Quartzite", "Bella Quartzite")).toBeNull();
    expect(pdfSelectionNameMismatch(link, "Bella Quartzite", "Quartzite Countertop")).toBeNull();
    expect(pdfSelectionNameMismatch("https://example.test/specifications.pdf", "Specifications", "Carrasco Quartzite")).toBeNull();
    expect(pdfSelectionNameMismatch("https://example.test/black.pdf", "Black", "Dixon Sofa")).toBeNull();
    expect(pdfSelectionNameMismatch("https://example.test/bella", "Bella", "Carrasco Quartzite")).toBeNull();
    expect(pdfSelectionNameMismatch(link, "White", "Carrasco Quartzite")).toBeNull();
  });
});

describe("Keeping an identified product when re-sending its board image", () => {
  const input = { boardName: "Countertop", boardPageId: "page", boardElementId: "layer", boardProductId: "product",
    boardLink: link, productLink: link, boardColor: "Bella Quartzite", materialId: "item",
    material: { id: "item", product_id: "product", product_url: link, color: "Bella Quartzite", source_board_page_id: "page", source_board_element_id: "layer" } };
  it("keeps the corrected catalog product for the same board selection", () => {
    expect(keepNamedProductForGenericBoard(input)).toBe(true);
  });
  it("uses the fresh Materials product instead of an older open board's catalog cache", () => {
    const cached = { id: "product", name: "CARRASCO Quartzite" };
    const fresh = { id: "product", name: "Bella Quartzite" };
    expect(latestBoardProduct("item", "product", [{ id: "item", product_id: "product", product: fresh }], cached)).toEqual(fresh);
  });
  it("does not retain the old product for a changed variant, source, or explicitly named selection", () => {
    expect(keepNamedProductForGenericBoard({ ...input, boardLink: "https://vendor.test/other.pdf" })).toBe(false);
    expect(keepNamedProductForGenericBoard({ ...input, boardColor: "White" })).toBe(false);
    expect(keepNamedProductForGenericBoard({ ...input, boardName: "Carrasco Quartzite" })).toBe(false);
    expect(keepNamedProductForGenericBoard({ ...input, boardElementId: "other" })).toBe(false);
    expect(keepNamedProductForGenericBoard({ ...input, materialId: "other" })).toBe(false);
  });
});
