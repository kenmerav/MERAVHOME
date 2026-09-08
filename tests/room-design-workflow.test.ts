import { describe, expect, it } from "vitest";
import {
  mergeRoomDesignSelectionsIntoBoard,
  normalizeRoomDesignWorkflowState,
  type RoomDesignSelection,
} from "@/lib/roomDesignWorkflow";
import { SELECTION_ROOM_TEMPLATES } from "@/lib/selectionChecklist";
import { inferMaterialCategory, productDisplayCategory } from "@/lib/roomTemplates";
import {
  CATALOG_NAME_PENDING_NOTE,
  shouldReplaceCatalogProductName,
} from "@/lib/catalogProductName";

function selection(
  id: string,
  category: string,
  imageUrl = `https://images.example.com/${id}.png`,
): RoomDesignSelection {
  return {
    id,
    category,
    productName: `${category} product`,
    vendor: "Studio Vendor",
    finish: "Aged brass",
    source: "Product link",
    state: "selected",
    swatch: "#ddd",
    imageUrl,
    url: `https://vendor.example.com/${id}`,
    quantity: 1,
  };
}

describe("Room Design V2 shared board merge", () => {
  it("preserves every manual page and every other room page", () => {
    const existing = {
      selectedPageId: "manual-page",
      presentationSettings: { theme: "studio" },
      pages: [
        {
          id: "manual-page",
          title: "Materials Throughout",
          roomId: null,
          elements: [
            { id: "manual-image", type: "image", x: 1, y: 2, width: 3, height: 4, zIndex: 1 },
          ],
        },
        {
          id: "room-design-v2:other-room:1",
          title: "Other Room",
          roomId: "other-room",
          elements: [],
        },
      ],
    };

    const merged = mergeRoomDesignSelectionsIntoBoard({
      boardState: existing,
      projectName: "Pilot Project",
      roomId: "kitchen",
      roomName: "Kitchen",
      selections: [selection("faucet", "Faucet")],
      pageCount: 1,
    });

    expect(merged.presentationSettings).toEqual({ theme: "studio" });
    expect(merged.pages.find((page) => page.id === "manual-page")).toEqual(existing.pages[0]);
    expect(merged.pages.find((page) => page.id === "room-design-v2:other-room:1")).toEqual(
      existing.pages[1],
    );
    expect(merged.pages.some((page) => page.id === "room-design-v2:kitchen:1")).toBe(true);
  });

  it("replaces only a completely untouched starter page", () => {
    const merged = mergeRoomDesignSelectionsIntoBoard({
      boardState: {
        pages: [
          {
            id: "board-1",
            title: "Design Board 1",
            roomId: null,
            elements: [],
          },
          {
            id: "primary-bedroom",
            title: "Primary Bedroom",
            roomId: "bedroom",
            elements: [],
          },
        ],
        selectedPageId: "board-1",
        comments: [],
      },
      projectName: "Pilot Project",
      roomId: "kitchen",
      roomName: "Kitchen",
      selections: [selection("faucet", "Faucet")],
      pageCount: 1,
    });

    expect(merged.pages).toHaveLength(2);
    expect(merged.pages.map((page) => page.id)).toEqual([
      "primary-bedroom",
      "room-design-v2:kitchen:1",
    ]);
    expect(merged.selectedPageId).toBe("room-design-v2:kitchen:1");
  });

  it("replaces only that room's generated pages and keeps user-arranged positions", () => {
    const first = mergeRoomDesignSelectionsIntoBoard({
      boardState: { pages: [], selectedPageId: "" },
      projectName: "Pilot Project",
      roomId: "kitchen",
      roomName: "Kitchen",
      selections: [selection("faucet", "Faucet")],
      pageCount: 1,
    });
    const generatedPage = first.pages[0];
    const generatedImage = generatedPage.elements.find((element) => element.type === "image")!;
    generatedImage.x = 999;
    generatedImage.y = 777;

    const second = mergeRoomDesignSelectionsIntoBoard({
      boardState: first,
      projectName: "Pilot Project",
      roomId: "kitchen",
      roomName: "Kitchen",
      selections: [{ ...selection("faucet", "Faucet"), finish: "Polished nickel" }],
      pageCount: 1,
    });
    const updatedImage = second.pages[0].elements.find((element) => element.type === "image")!;

    expect(second.pages).toHaveLength(1);
    expect(updatedImage.x).toBe(999);
    expect(updatedImage.y).toBe(777);
    expect(updatedImage.finish).toBe("Polished nickel");
  });

  it("uses a smaller stock footprint for drains and rough-ins", () => {
    const merged = mergeRoomDesignSelectionsIntoBoard({
      boardState: null,
      projectName: "Pilot Project",
      roomId: "bath",
      roomName: "Primary Bathroom",
      selections: [
        selection("mirror", "Mirror"),
        selection("drain", "Shower drain"),
        selection("rough-in", "Valve rough-in"),
      ],
      pageCount: 1,
    });
    const images = merged.pages[0].elements.filter((element) => element.type === "image");
    const mirror = images.find((element) => element.label === "Mirror")!;
    const drain = images.find((element) => element.label === "Shower drain")!;
    const roughIn = images.find((element) => element.label === "Valve rough-in")!;

    expect(drain.width).toBeLessThan(mirror.width);
    expect(roughIn.height).toBeLessThan(mirror.height);
  });

  it("opens generated products immediately and queues fixture backgrounds in the full editor", () => {
    const merged = mergeRoomDesignSelectionsIntoBoard({
      boardState: null,
      projectName: "Pilot Project",
      roomId: "kitchen",
      roomName: "Kitchen",
      selections: [selection("faucet", "Faucet"), selection("floor", "Flooring")],
      pageCount: 1,
    });
    const images = merged.pages[0].elements.filter((element) => element.type === "image");
    const faucet = images.find((element) => element.label === "Faucet")!;
    const flooring = images.find((element) => element.label === "Flooring")!;

    expect(faucet.src).toBe("https://images.example.com/faucet.png");
    expect(faucet.autoRemoveBackground).toBe(true);
    expect(flooring.autoRemoveBackground).toBe(false);
  });

  it("preserves a full-editor background choice when the same room is synced again", () => {
    const first = mergeRoomDesignSelectionsIntoBoard({
      boardState: null,
      projectName: "Pilot Project",
      roomId: "kitchen",
      roomName: "Kitchen",
      selections: [selection("faucet", "Faucet")],
      pageCount: 1,
    });
    const firstImage = first.pages[0].elements.find((element) => element.type === "image")!;
    firstImage.src = "https://example.com/faucet-cutout.png";
    firstImage.backgroundRemovedUrl = "https://example.com/faucet-cutout.png";
    firstImage.autoRemoveBackground = false;

    const second = mergeRoomDesignSelectionsIntoBoard({
      boardState: first,
      projectName: "Pilot Project",
      roomId: "kitchen",
      roomName: "Kitchen",
      selections: [selection("faucet", "Faucet")],
      pageCount: 1,
    });
    const secondImage = second.pages[0].elements.find((element) => element.type === "image")!;

    expect(secondImage.src).toBe("https://example.com/faucet-cutout.png");
    expect(secondImage.backgroundRemovedUrl).toBe("https://example.com/faucet-cutout.png");
    expect(secondImage.autoRemoveBackground).toBe(false);
  });
});

describe("Room Design V2 workflow normalization", () => {
  it("rejects malformed entries and restores safe defaults", () => {
    const normalized = normalizeRoomDesignWorkflowState(
      { method: "unknown", links: [{ bad: true }], selections: [{ id: "", category: "" }] },
      {
        method: "links",
        stage: 0,
        links: [],
        linksRoomName: "Kitchen",
        selections: [],
        conceptImageUrl: "",
        roomImageUrl: "",
        floorPlanImageUrl: "",
        sketchupImageUrl: "",
        completedRenderImageUrl: "",
        boardReady: false,
        renderReady: false,
        materialsSent: false,
      },
    );

    expect(normalized.method).toBe("links");
    expect(normalized.links).toEqual([]);
    expect(normalized.selections).toEqual([]);
    expect(normalized.version).toBe(1);
  });

  it("keeps a saved catalog choice attached to its checklist item", () => {
    const normalized = normalizeRoomDesignWorkflowState(
      {
        links: [
          {
            id: "faucet",
            category: "Faucet",
            url: "https://vendor.example.com/faucet",
            group: "Plumbing",
            quantity: 1,
            notes: "",
            productId: "catalog-product-id",
            catalogProductName: "Saved Faucet",
          },
        ],
      },
      {
        method: "links",
        stage: 0,
        links: [],
        linksRoomName: "Kitchen",
        selections: [],
        conceptImageUrl: "",
        roomImageUrl: "",
        floorPlanImageUrl: "",
        sketchupImageUrl: "",
        completedRenderImageUrl: "",
        boardReady: false,
        renderReady: false,
        materialsSent: false,
      },
    );

    expect(normalized.links[0]).toMatchObject({
      productId: "catalog-product-id",
      catalogProductName: "Saved Faucet",
    });
  });
});

describe("Room Design V2 checklist templates", () => {
  it("replaces only temporary project labels with scraped catalog names", () => {
    expect(
      shouldReplaceCatalogProductName({
        existingName: "Dining Room All Over Paint Color",
        scrapedName: "Aura Interior Paint",
      }),
    ).toBe(true);
    expect(
      shouldReplaceCatalogProductName({
        existingName: "Ceiling finish",
        scrapedName: "Aura Interior Paint",
        itemLabel: "Ceiling finish",
      }),
    ).toBe(true);
    expect(
      shouldReplaceCatalogProductName({
        existingName: "Temporary selection",
        scrapedName: "Aura Interior Paint",
        notes: CATALOG_NAME_PENDING_NOTE,
      }),
    ).toBe(true);
    expect(
      shouldReplaceCatalogProductName({
        existingName: "Roman Clay",
        scrapedName: "Aura Interior Paint",
      }),
    ).toBe(false);
    expect(
      shouldReplaceCatalogProductName({
        existingName: "Kitchen Faucet",
        scrapedName: "Purist Faucet",
      }),
    ).toBe(false);
  });

  it("routes wall and ceiling finishes to the Paint catalog section", () => {
    expect(inferMaterialCategory("Wall finish")).toBe("Paint");
    expect(inferMaterialCategory("Ceiling finish")).toBe("Paint");
  });

  it("keeps baseboard products in Doors Base & Case after saving as hardware", () => {
    expect(
      productDisplayCategory({
        category: "Hardware",
        subcategory: "Base & Case",
        name: "Baseboard",
      }),
    ).toBe("Doors Base & Case");
    expect(
      productDisplayCategory({
        category: "Hardware",
        subcategory: "Cabinet Pulls",
        name: "Baseboard",
      }),
    ).toBe("Doors Base & Case");
  });

  it("keeps independently selected product types in separate rows", () => {
    const kitchen = SELECTION_ROOM_TEMPLATES.find((room) => room.key === "kitchen")!;
    const primaryBathroom = SELECTION_ROOM_TEMPLATES.find(
      (room) => room.key === "primary-bathroom",
    )!;
    const kitchenLabels = kitchen.items.map((item) => item.label);
    const bathroomLabels = primaryBathroom.items.map((item) => item.label);

    expect(kitchenLabels).toEqual(
      expect.arrayContaining([
        "Baseboard",
        "Casing",
        "Doors",
        "Door hardware",
        "Cabinet layout",
        "Appliance layout",
      ]),
    );
    expect(kitchenLabels).not.toContain("Baseboard + casing");
    expect(kitchenLabels).not.toContain("Doors + door hardware");
    expect(kitchenLabels).not.toContain("Cabinet + appliance layout");
    expect(bathroomLabels).toEqual(
      expect.arrayContaining(["Baseboard", "Casing", "Doors", "Door hardware"]),
    );
  });
});
