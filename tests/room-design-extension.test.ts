import { describe, expect, it } from "vitest";
import { selectionItemsForRoom } from "@/lib/selectionChecklist";
import {
  addCustomRoomDesignProductType,
  createDefaultRoomDesignWorkflowState,
  mergeExtensionProductIntoRoomDesignWorkflow,
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
});
