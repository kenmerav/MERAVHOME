import { describe, expect, it } from "vitest";
import {
  createDefaultRoomDesignWorkflowState,
  mergeRoomDesignSelectionsIntoBoard,
  normalizeRoomDesignWorkflowState,
  type RoomDesignSelection,
} from "../src/lib/roomDesignWorkflow";
import {
  boardMaterialQuantity,
  boardPageQuantity,
  boardQuantityEdit,
} from "../src/lib/boardMaterialQuantity";
import { buildSpecSpreadsheetRows } from "../src/lib/specBookRows";
import {
  formatSpecQuantity,
  specOrderQuantity,
  parseSpecQuantity,
  specQuantityDatabasePatch,
} from "../src/lib/specQuantity";
import {
  roomDesignOrderReady,
  roomDesignSelectionIssues,
  productAwareQuantityUnit,
  retainRoomDesignMeasurements,
} from "../src/lib/roomDesignReview";
import { cleanProductDetail } from "../src/lib/productDetails";
import { createCodexRenderHandoff } from "../src/lib/codexRenderHandoff";
import { canUseRoomDesign, canUseRenderingStudio } from "../src/lib/permissions";

const product: RoomDesignSelection = {
  id: "link-wall",
  category: "Wall finish",
  productName: "Palmetto Verdant 6x6 Ceramic Tile",
  vendor: "Bedrosians",
  finish: "Verdant glazed",
  source: "Product link",
  state: "locked",
  swatch: "",
  url: "https://vendor.example/product?sku=verdant",
  imageUrl: "https://vendor.example/verdant.png",
  quantity: 100,
  quantityUnit: "sq ft",
  wastePercent: 10,
  sku: "100010053",
  dimensions: "6 x 6 inches",
  price: "$32.89",
  scrapeStatus: "complete",
};

describe("designer workflow round trip", () => {
  it("keeps measurement, base quantity and waste distinct through board, Materials and Specs", () => {
    const board = mergeRoomDesignSelectionsIntoBoard({
      boardState: {},
      projectName: "QA",
      roomId: "room",
      roomName: "Kitchen",
      selections: [product],
    });
    const image = board.pages[0].elements.find((element) => element.type === "image")!;
    const amount = boardMaterialQuantity(image);
    expect(amount).toEqual({
      quantity: 100,
      quantity_tbd: false,
      quantity_unit: "square_feet",
      waste_percent: 10,
    });
    const item: any = {
      id: "m",
      room_id: "room",
      item_label: "Wall finish",
      category: "Tile & Stone",
      product_id: "p",
      product: { name: product.productName, finish: product.finish },
      ...amount,
    };
    const row = buildSpecSpreadsheetRows([item], [{ id: "room", name: "Kitchen" }])[0];
    expect(row.quantity).toBe("100");
    expect(row.quantityUnit).toBe("square_feet");
    expect(row.orderQuantity).toBe("110 Sq Ft");
    expect(specOrderQuantity(item)).toBe(110);
  });
  it("never turns a typed TBD into one, including repeated references", () => {
    const board = mergeRoomDesignSelectionsIntoBoard({
      boardState: {},
      projectName: "QA",
      roomId: "r",
      roomName: "Kitchen",
      selections: [{ ...product, quantity: null }],
    });
    const image = board.pages[0].elements.find((element) => element.type === "image")!;
    expect(boardMaterialQuantity(image)).toMatchObject({ quantity: null, quantity_tbd: true });
    expect(boardPageQuantity([image, image])).toBeNull();
    expect(formatSpecQuantity(boardMaterialQuantity(image))).toBe("TBD Sq Ft");
  });
  it("lets board edits resolve TBD and retain zero or fractional measured quantities", () => {
    expect(boardQuantityEdit({ materialQuantityTbd: true }, "2")).toEqual({
      materialQuantity: 2,
      materialQuantityTbd: false,
    });
    expect(boardQuantityEdit({}, "TBD")).toEqual({
      materialQuantity: null,
      materialQuantityTbd: true,
    });
    expect(boardQuantityEdit({}, "0").materialQuantity).toBe(0);
    expect(boardQuantityEdit({ materialQuantityUnit: "sq ft" }, "0.5").materialQuantity).toBe(0.5);
    expect(() => boardQuantityEdit({}, "oops")).toThrow();
  });
  it("keeps fractional area and length but rejects fractional boxes and invalid waste", () => {
    expect(parseSpecQuantity("12.75", "linear_feet", 5).quantity).toBe(12.75);
    expect(() => parseSpecQuantity("1.5", "box")).toThrow();
    expect(() => parseSpecQuantity("100", "square_feet", 101)).toThrow();
  });
  it("round trips extended measurements without changing the legacy database unit constraint", () => {
    const stored = specQuantityDatabasePatch(parseSpecQuantity("12.75", "linear_feet", 5));
    expect(stored.quantity_unit).toBe("count");
    expect(stored.selection_quantity_unit).toBe("linear_feet");
    expect(formatSpecQuantity(stored)).toBe("12.75 Linear Ft");
    expect(specQuantityDatabasePatch(parseSpecQuantity("TBD", "roll"))).toMatchObject({
      quantity: null,
      quantity_tbd: true,
      selection_quantity_unit: "roll",
    });
  });
  it("preserves measurement overrides on refresh while requiring new products to be reviewed", () => {
    const previous = { ...product, quantityUnit: "box" as const, wastePercent: 15 };
    const refreshed = retainRoomDesignMeasurements(
      { ...product, finish: "", state: "selected" },
      previous,
    );
    expect(refreshed).toMatchObject({
      quantityUnit: "box",
      wastePercent: 15,
      finish: product.finish,
      state: "selected",
    });
    expect(
      retainRoomDesignMeasurements({ ...product, url: "https://vendor.example/new" }, previous)
        .quantityUnit,
    ).toBe("sq ft");
  });
  it("retains manually reviewed quantities when a workflow is saved and reopened", () => {
    const initial = createDefaultRoomDesignWorkflowState("Kitchen");
    const restored = normalizeRoomDesignWorkflowState(
      { ...initial, selections: [product] },
      initial,
    );
    expect(restored.selections[0]).toMatchObject({
      quantity: 100,
      quantityUnit: "sq ft",
      wastePercent: 10,
    });
  });
  it("rejects website navigation as a finish in old saved workflows", () => {
    expect(cleanProductDetail("Open Mobile Menu")).toBe("");
    expect(roomDesignSelectionIssues({ ...product, finish: "Open Mobile Menu" })).toContain(
      "Confirm the selected color / finish.",
    );
    expect(roomDesignOrderReady({ ...product, finish: "Open Mobile Menu" })).toBe(false);
    expect(roomDesignOrderReady({ ...product, quantity: null })).toBe(false);
    expect(roomDesignOrderReady({ ...product, sku: undefined })).toBe(false);
    expect(roomDesignOrderReady(product)).toBe(true);
  });
  it("assigns wall tile an area unit without misclassifying paint", () => {
    expect(productAwareQuantityUnit("Wall finish", product.productName)).toBe("sq ft");
    expect(productAwareQuantityUnit("Wall finish", "Greek Villa paint")).toBe("gallon");
    expect(roomDesignSelectionIssues({ ...product, quantityUnit: "gallon" })).toContain(
      "Choose an area or selling unit for tile, rather than gallons.",
    );
  });
  it("packages exact variant references and requires layout evidence when a plan exists", () => {
    const handoff = createCodexRenderHandoff({
      projectName: "QA",
      roomName: "Kitchen",
      selections: [{ ...product, imageFilename: "product-01.png" }],
      attachments: [
        { filename: "plan.png", purpose: "floor-plan" },
        { filename: "product-01.png", purpose: "product-reference" },
      ],
    });
    expect(handoff.layoutReviewRequired).toBe(true);
    expect(handoff.selections[0]).toMatchObject({
      sku: "100010053",
      dimensions: "6 x 6 inches",
      quantityUnit: "sq ft",
      wastePercent: 10,
      imageFilename: "product-01.png",
    });
    expect(handoff.instructions.join(" ")).toContain("Critical missing measurements block");
    expect(handoff.instructions.join(" ")).toContain("shower enclosure glass");
  });
  it("enables active designers while keeping external users and private Rendering Studio excluded", () => {
    expect(canUseRoomDesign({ role: "Employee", is_active: true })).toBe(true);
    expect(canUseRoomDesign({ role: "Client", is_active: true })).toBe(false);
    expect(canUseRoomDesign({ role: "Contractor", is_active: true })).toBe(false);
    expect(canUseRoomDesign({ role: "Employee", is_active: false })).toBe(false);
    expect(
      canUseRenderingStudio({ role: "Employee", is_active: true, email: "designer@example.com" }),
    ).toBe(false);
  });
});
