import { describe, expect, it } from "vitest";
import {
  mergeRoomDesignSelectionsIntoBoard,
  normalizeRoomDesignWorkflowState,
  type RoomDesignSelection,
} from "@/lib/roomDesignWorkflow";

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
});
