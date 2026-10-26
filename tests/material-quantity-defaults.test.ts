import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  materialQuantityStartsTbd,
  newMaterialQuantityDefaults,
} from "../src/lib/materialQuantityDefaults";
import { roomDesignInitialQuantity } from "../src/lib/roomDesignDetails";
import {
  createDefaultRoomDesignWorkflowState,
  normalizeRoomDesignWorkflowState,
} from "../src/lib/roomDesignWorkflow";
import {
  boardMaterialQuantity,
  boardPageQuantity,
  boardQuantityEdit,
} from "../src/lib/boardMaterialQuantity";

const extension: Record<string, (...args: unknown[]) => unknown> = {};
runInNewContext(
  readFileSync("chrome-extension/send-to-merav-studio/quantity.js", "utf8"),
  extension,
);
const categories = [
  "Tile & Stone",
  "Doors Base & Case",
  "Cabinetry",
  "Cabinetry & Hardware",
  "Doors, Base, Case",
  "Cabinet pulls",
  "Door hinges",
  "Backsplash tile",
];
describe("new quantity defaults", () => {
  it.each(categories)(
    "starts %s at TBD across Room Design, Materials, and extension",
    (category) => {
      expect(materialQuantityStartsTbd(category)).toBe(true);
      expect(roomDesignInitialQuantity(category)).toBeNull();
      expect(newMaterialQuantityDefaults(category, null)).toEqual({
        quantity: null,
        quantity_tbd: true,
      });
      expect(newMaterialQuantityDefaults(category, undefined)).toEqual({
        quantity: null,
        quantity_tbd: true,
      });
      const layer = { materialQuantity: roomDesignInitialQuantity(category) };
      expect(boardMaterialQuantity(layer)).toMatchObject({ quantity: null, quantity_tbd: true });
      expect(
        boardPageQuantity([
          { ...layer, id: "one" },
          { ...layer, id: "two" },
        ]),
      ).toBeNull();
      expect(boardMaterialQuantity({ ...layer, ...boardQuantityEdit(layer, "6") })).toMatchObject({
        quantity: 6,
        quantity_tbd: false,
      });
      expect(extension.initialMeravQuantity(category)).toBe("TBD");
      expect(extension.restoredMeravQuantity({ label: category }, undefined)).toBe("TBD");
    },
  );
  it.each([0, 1, 8, 122.5])("preserves an explicitly entered quantity of %s", (quantity) => {
    for (const category of categories) {
      expect(newMaterialQuantityDefaults(category, quantity)).toEqual({});
      expect(extension.restoredMeravQuantity({ category, quantity }, undefined)).toBe(quantity);
      expect(extension.restoredMeravQuantity({ category, quantity: null }, quantity)).toBe(
        quantity,
      );
    }
  });
  it("preserves other count-based categories and saved TBD values", () => {
    for (const category of [
      "Lighting",
      "Plumbing",
      "Furniture",
      "Hardware",
      "Toilet",
      "Shower door handles",
    ]) {
      expect(materialQuantityStartsTbd(category)).toBe(false);
      expect(roomDesignInitialQuantity(category)).toBe(1);
      expect(extension.initialMeravQuantity(category)).toBe(1);
      expect(newMaterialQuantityDefaults(category, null)).toEqual({});
    }
    expect(extension.restoredMeravQuantity({ label: "Cabinetry", quantity: null }, undefined)).toBe(
      "TBD",
    );
    expect(extension.restoredMeravQuantity({ label: "Cabinetry", quantity: 8 }, "TBD")).toBe("TBD");
  });
  it("preserves a later saved quantity when workflow state is reloaded", () => {
    const state = createDefaultRoomDesignWorkflowState("Kitchen");
    state.links.push({
      id: "custom-cabinetry",
      category: "Cabinetry",
      url: "",
      group: "Cabinetry / Millwork",
      quantity: 24,
      notes: "Field verified",
    });
    const restored = normalizeRoomDesignWorkflowState(JSON.parse(JSON.stringify(state)), "Kitchen");
    expect(restored.links.find((item) => item.id === "custom-cabinetry")).toMatchObject({
      quantity: 24,
      notes: "Field verified",
    });
  });
});
