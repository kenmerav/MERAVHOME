import { describe, expect, it } from "vitest";
import { boardBlankQuantityDefault } from "@/lib/boardBlankQuantityDefault";
import { boardMaterialQuantity, boardPageQuantity } from "@/lib/boardMaterialQuantity";

describe("blank quantities on the board", () => {
  it.each([
    { label: "Couch", materialCategory: "Furniture" },
    { label: "Dresser", materialCategory: "Furniture" },
    { label: "Reading Floor Lamp", materialCategory: "Lighting" },
    { label: "Roman shade", materialCategory: "Other" },
    { label: "Rug", materialCategory: "Flooring" },
    { label: "Filing Cabinet", materialCategory: "Cabinetry" },
  ])("starts an ordinary selection at one: $label", (item) => {
    expect(boardMaterialQuantity(boardBlankQuantityDefault(item))).toMatchObject({
      quantity: 1,
      quantity_tbd: false,
    });
  });
  it.each([
    { label: "Flooring", materialCategory: "Flooring" },
    { label: "Shower tile", materialCategory: "Tile & Stone" },
    { label: "Stone countertop", materialCategory: "Countertops" },
    { label: "Cabinetry", materialCategory: "Cabinetry" },
    { label: "Cabinet pull", materialCategory: "Cabinetry" },
    { label: "Interior doors", materialCategory: "Doors Base & Case" },
    { label: "Paint", materialCategory: "Paint" },
    { label: "Wallpaper", materialCategory: "Wall Coverings" },
  ])("keeps a measurement-based selection TBD: $label", (item) => {
    expect(boardMaterialQuantity(boardBlankQuantityDefault(item))).toMatchObject({
      quantity: null,
      quantity_tbd: true,
    });
  });
  it("preserves deliberate TBD, entered counts, measurement units and linked design decisions", () => {
    const sofa = { label: "Couch", materialCategory: "Furniture" };
    for (const item of [
      { ...sofa, materialQuantityTbd: true },
      { ...sofa, materialQuantity: 0 },
      { ...sofa, materialQuantity: 3 },
      { ...sofa, materialQuantityUnit: "sq ft" },
      { ...sofa, designAccuracySourceId: "decision" },
    ])
      expect(boardBlankQuantityDefault(item)).toEqual(item);
  });
  it("counts separate blank board items while never replacing an explicit TBD", () => {
    const image = { label: "Sconce", materialCategory: "Lighting" };
    expect(
      boardPageQuantity(
        [
          { ...image, id: "a" },
          { ...image, id: "b" },
        ].map(boardBlankQuantityDefault),
      ),
    ).toBe(2);
    expect(
      boardPageQuantity(
        [
          { ...image, id: "a" },
          { ...image, id: "b", materialQuantityTbd: true },
        ].map(boardBlankQuantityDefault),
      ),
    ).toBeNull();
  });
});
