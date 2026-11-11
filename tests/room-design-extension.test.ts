import { describe, expect, it } from "vitest";
import { selectionItemsForRoom } from "@/lib/selectionChecklist";
import {
  extensionOrderEstimate,
  parseExtensionSelectionReview,
} from "@/lib/extensionSelectionReview";
import { extensionSelectionRevision } from "@/lib/extensionSelectionRevision.server";
import {
  addCustomRoomDesignProductType,
  createDefaultRoomDesignWorkflowState,
  mergeExtensionProductIntoRoomDesignWorkflow,
  normalizeRoomDesignWorkflowState,
  mergeRoomDesignSelectionsIntoBoard,
  reconcileRoomDesignChecklist,
  roomDesignRoomNamesMatch,
} from "@/lib/roomDesignWorkflow";

const product = {
  id: "product-1",
  name: "Bryant Large Pendant",
  vendor: "Visual Comfort",
  finish: "Antique Burnished Brass",
  sourcePageUrl: "https://example.com/bryant-pendant",
  imageUrl: "https://example.com/bryant-pendant-cutout.png",
  originalImageUrl: "https://example.com/bryant-pendant.jpg",
  price: "1299.00",
  sku: "TOB-5001",
  dimensions: '18" W x 24" H',
  quantity: 3,
};

describe("Room Design extension destination", () => {
  it("uses the same split checklist as the Room Design page", () => {
    const labels = selectionItemsForRoom("Kitchen").map((item) => item.label);
    expect(labels).toContain("Baseboard");
    expect(labels).toContain("Casing");
    expect(labels).toContain("Doors");
    expect(labels).toContain("Door hardware");
    expect(labels).toContain("Island pendants");
  });

  it("includes a generic tub selection for Primary Bathrooms", () => {
    const labels = selectionItemsForRoom("Primary Bathroom").map((item) => item.label);
    expect(labels).toContain("Tub");
    expect(labels).toContain("Tub filler");
    expect(labels).not.toContain("Freestanding tub");
  });

  it("uses the full Powder Bathroom checklist for common room-name variants", () => {
    for (const roomName of ["Powder Bathroom", "Powder Bath", "Powder Room"]) {
      const labels = selectionItemsForRoom(roomName).map((item) => item.label);
      expect(labels).toEqual(
        expect.arrayContaining([
          "Vanity layout",
          "Countertop",
          "Sink",
          "Faucet",
          "Toilet",
          "Mirror",
          "Vanity sconces",
          "Exhaust fan",
          "Toilet paper holder",
          "Hand towel holder",
        ]),
      );
      expect(labels).not.toContain("Tub");
      expect(labels).not.toContain("Shower system");
    }
  });

  it("adds newly introduced Powder Bathroom rows without replacing saved work", () => {
    const state = createDefaultRoomDesignWorkflowState("Powder Bathroom");
    const olderState = {
      ...state,
      links: state.links
        .filter(
          (item) =>
            ![
              "Recessed lighting",
              "Exhaust fan",
              "Toilet paper holder",
              "Hand towel holder",
            ].includes(item.category),
        )
        .map((item) =>
          item.category === "Faucet"
            ? { ...item, url: "https://example.com/saved-faucet", notes: "Keep this choice" }
            : item,
        ),
    };
    const reconciled = reconcileRoomDesignChecklist(olderState, "Powder Bathroom");

    expect(reconciled.links.find((item) => item.category === "Faucet")).toMatchObject({
      url: "https://example.com/saved-faucet",
      notes: "Keep this choice",
    });
    expect(reconciled.links.map((item) => item.category)).toEqual(
      expect.arrayContaining([
        "Recessed lighting",
        "Exhaust fan",
        "Toilet paper holder",
        "Hand towel holder",
      ]),
    );
  });

  it("upgrades an older Primary Bathroom checklist without losing saved work", () => {
    const state = createDefaultRoomDesignWorkflowState("Primary Bathroom");
    const olderState = {
      ...state,
      links: state.links
        .filter((item) => item.id !== "tub")
        .concat({
          id: "freestanding-tub",
          category: "Freestanding tub",
          url: "https://example.com/tub",
          group: "Plumbing",
          quantity: 1,
          notes: "Keep this choice",
        }),
    };
    const reconciled = reconcileRoomDesignChecklist(olderState, "Primary Bathroom");
    const tub = reconciled.links.find((item) => item.id === "freestanding-tub");

    expect(tub).toMatchObject({
      category: "Tub",
      url: "https://example.com/tub",
      notes: "Keep this choice",
    });
    expect(reconciled.links.filter((item) => item.category === "Tub")).toHaveLength(1);
  });

  it("adds a custom product type once and keeps it room-specific", () => {
    const state = createDefaultRoomDesignWorkflowState("Primary Bathroom");
    const first = addCustomRoomDesignProductType({
      state,
      label: "  Towel warmer  ",
      itemId: "custom-123",
    });
    const duplicate = addCustomRoomDesignProductType({
      state: first.state,
      label: "towel warmer",
      itemId: "custom-456",
    });

    expect(first.added).toBe(true);
    expect(first.item).toMatchObject({
      id: "custom-123",
      category: "Towel warmer",
      custom: true,
    });
    expect(duplicate.added).toBe(false);
    expect(duplicate.state.links.filter((item) => item.category === "Towel warmer")).toHaveLength(
      1,
    );
  });

  it("fails closed when a stored room ID and visible room name disagree", () => {
    expect(roomDesignRoomNamesMatch("Primary Bathroom", "Primary Bathroom")).toBe(true);
    expect(roomDesignRoomNamesMatch(" primary   bathroom ", "Primary Bathroom")).toBe(true);
    expect(roomDesignRoomNamesMatch("Primary Bathroom", "Primary Bedroom")).toBe(false);
  });

  it("adds a catalog product to one room selection without touching the board", () => {
    const state = createDefaultRoomDesignWorkflowState("Kitchen");
    const result = mergeExtensionProductIntoRoomDesignWorkflow({
      state: { ...state, boardReady: true, renderReady: true },
      itemKey: "island-pendants",
      product,
    });

    expect(result.state.selections).toHaveLength(1);
    expect(result.state.selections[0]).toMatchObject({
      id: "link-island-pendants",
      category: "Island pendants",
      productName: "Bryant Large Pendant",
      quantity: 3,
      productId: "product-1",
      state: "selected",
    });
    expect(result.state.links.find((item) => item.id === "island-pendants")).toMatchObject({
      productId: "product-1",
      quantity: 3,
    });
    expect(result.state.stage).toBe(1);
    expect(result.state.boardReady).toBe(false);
    expect(result.state.renderReady).toBe(false);
    expect(result.nextItem?.id).toBeTruthy();
  });

  it("replaces the selected product instead of duplicating the checklist item", () => {
    const first = mergeExtensionProductIntoRoomDesignWorkflow({
      state: { ...createDefaultRoomDesignWorkflowState("Kitchen"), materialsSent: true },
      itemKey: "island-pendants",
      product,
    });
    const second = mergeExtensionProductIntoRoomDesignWorkflow({
      state: first.state,
      itemKey: "island-pendants",
      product: { ...product, id: "product-2", name: "Darlana Pendant", quantity: 2 },
    });

    expect(second.replaced).toBe(true);
    expect(second.state.selections).toHaveLength(1);
    expect(second.state.selections[0]).toMatchObject({
      productId: "product-2",
      productName: "Darlana Pendant",
      quantity: 2,
      materialsSyncStatus: "changed",
    });
  });

  const tile = {
    ...product,
    name: "Harbor Porcelain Tile",
    manufacturer: "Harbor Tile",
    finish: "Ivory matte",
    dimensions: "11.8 × 23.8 in, 9 mm thick",
    quantity: 100,
  };
  const tileDetails = {
    quantityUnit: "sq ft",
    wastePercent: "10",
    confirmed: true,
    installationLocation: "Primary Bathroom, elevation A6.2",
    purchase: {
      unitPrice: "55.00",
      priceUnit: "carton",
      sellingUnit: "carton",
      priceType: "Trade",
      priceSource: "Quote 42",
      availability: "2 weeks",
      coverage: "11",
    },
    tile: {
      location: "Shower walls to ceiling",
      layout: "Running bond, 33% offset",
      direction: "Horizontal from centerline",
      groutProduct: "Mapei Ultracolor Plus FA",
      groutColor: "Warm Gray",
      jointWidth: "1/8 in",
      edgeTreatment: "Metal trim",
      edgeProduct: "Schluter Jolly",
      edgeFinish: "Brushed brass",
      edgeSize: "3/8 in",
      suitability: "Shower wall listed on the manufacturer spec sheet",
    },
  };

  it("stores the verified tile with its exact order quantity and passes install notes to the board", () => {
    const state = createDefaultRoomDesignWorkflowState("Primary Bathroom");
    const item = state.links.find((link) => link.category === "Shower wall tile")!;
    const result = mergeExtensionProductIntoRoomDesignWorkflow({
      state,
      itemKey: item.id,
      product: { ...tile, price: "", review: parseExtensionSelectionReview(tileDetails, 100) },
    });
    expect(result.issues).toEqual([]);
    expect(result.selection).toMatchObject({ state: "locked", quantity: 100, wastePercent: 10 });
    expect(result.selection.extensionPurchase?.checkedAt).toBeTruthy();
    expect(extensionOrderEstimate(result.selection)).toEqual({
      quantity: 10,
      unit: "carton",
      total: "$550.00",
    });
    expect(
      extensionOrderEstimate({
        ...result.selection,
        extensionPurchase: {
          ...result.selection.extensionPurchase!,
          minimumOrder: 12,
          priceUnit: "sq ft",
          unitPrice: "$5.00",
        },
      }),
    ).toEqual({ quantity: 12, unit: "carton", total: "$660.00" });
    expect(
      normalizeRoomDesignWorkflowState(JSON.parse(JSON.stringify(result.state)), state)
        .selections[0].extensionPurchase,
    ).toEqual(result.selection.extensionPurchase);
    expect(result.state.links.find((link) => link.id === item.id)?.notes).toContain(
      "Grout joint width: 1/8 in",
    );
    expect(result.selection.notes).toContain("Installation location / reference: Primary Bathroom, elevation A6.2");
    const board = mergeRoomDesignSelectionsIntoBoard({
      boardState: {},
      projectName: "Test",
      roomId: "room-1",
      roomName: "Primary Bathroom",
      selections: result.state.selections,
    });
    expect(board.pages.flatMap((page) => page.elements)).toContainEqual(
      expect.objectContaining({
        materialQuantity: 100,
        materialQuantityUnit: "sq ft",
        materialWastePercent: 10,
        notes: expect.stringContaining("Tile layout: Running bond, 33% offset"),
      }),
    );
    expect(JSON.stringify(board)).not.toContain("Quote 42");
  });

  it("keeps unchecked or incomplete captures open for verification and guards per-item revisions", () => {
    const state = createDefaultRoomDesignWorkflowState("Primary Bathroom");
    const item = state.links.find((link) => link.category === "Shower wall tile")!;
    const result = mergeExtensionProductIntoRoomDesignWorkflow({
      state,
      itemKey: item.id,
      product: {
        ...tile,
        quantity: null,
        review: parseExtensionSelectionReview(
          {
            ...tileDetails,
            purchase: { ...tileDetails.purchase, coverage: "" },
            tile: { ...tileDetails.tile, jointWidth: "1/8" },
          },
          null,
        ),
      },
    });
    expect(result.selection.state).toBe("selected");
    expect(result.selection.extensionPurchase?.checkedAt).toBe("");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/unit to the grout joint width/),
        expect.stringMatching(/square feet per selling unit/),
        expect.stringMatching(/quantity.*TBD/),
      ]),
    );
    expect(extensionOrderEstimate(result.selection)).toBeNull();
    const other = state.links.find((link) => link.id !== item.id)!;
    expect(extensionSelectionRevision(result.state, item.id)).not.toBe(
      extensionSelectionRevision(state, item.id),
    );
    expect(extensionSelectionRevision(result.state, other.id)).toBe(
      extensionSelectionRevision(state, other.id),
    );
    const unchecked = mergeExtensionProductIntoRoomDesignWorkflow({
      state,
      itemKey: item.id,
      product: {
        ...tile,
        review: parseExtensionSelectionReview({ ...tileDetails, confirmed: false }, 100),
      },
    });
    expect(unchecked.issues).toEqual([]);
    expect(unchecked.selection.state).toBe("selected");
  });
});
