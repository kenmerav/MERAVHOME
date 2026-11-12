import { describe, expect, it } from "vitest";
import { normalizeExtensionBoardState } from "@/lib/extensionBoardState";
import { boardTileInstallationIssues } from "@/lib/boardTileInstallation";
import { roomDesignTileIssues } from "@/lib/roomDesignTile";
import {
  extensionBoardDirectSelection,
  extensionBoardPageRoom,
  placeLinkedExtensionSelection,
  type ExtensionImportLayer,
} from "@/lib/extensionRoomBoardImport";
import {
  createDefaultRoomDesignWorkflowState,
  mergeExtensionProductIntoRoomDesignWorkflow,
  mergeRoomDesignSelectionsIntoBoard,
} from "@/lib/roomDesignWorkflow";

const room = { id: "room-1", name: "Primary Bedroom" };
const otherRoom = { id: "room-2", name: "Foyer" };
const rooms = [room, otherRoom];
const projectName = "Test Project";
const product = {
  id: "product-1",
  name: "Nelson Saucer Bubble Pendant",
  vendor: "Lumens",
  finish: "White",
  sourcePageUrl: "https://example.com/pendant",
  imageUrl: "https://example.com/pendant.png",
  originalImageUrl: "https://example.com/original.png",
  price: "295",
  sku: "pendant-1",
  dimensions: "18 in",
  quantity: 2,
};
const layer = {
  type: "image",
  productId: product.id,
  src: product.imageUrl,
  width: 200,
  height: 150,
} as const;
const placement = () => ({ x: 160, y: 240 });
const note = {
  id: "handwritten",
  type: "text",
  x: 200,
  y: 300,
  width: 100,
  height: 50,
  zIndex: 2,
} as const;
const makeBoard = () =>
  normalizeExtensionBoardState<ExtensionImportLayer>({
    selectedPageId: "foyer",
    pages: [
      { id: "foyer", title: "Foyer", roomId: otherRoom.id, elements: [note] },
      {
        id: "bedroom",
        title: "Bedroom concept",
        roomId: room.id,
        elements: [note],
        presentationVisible: false,
      },
    ],
  });

describe("linked extension imports", () => {
  it("places a room selection on its own existing board page and updates it in place", () => {
    const state = createDefaultRoomDesignWorkflowState(room.name);
    const first = mergeExtensionProductIntoRoomDesignWorkflow({
      state,
      itemKey: "lighting",
      product,
    });
    const placed = placeLinkedExtensionSelection({
      board: makeBoard(),
      rooms,
      room,
      projectName,
      selection: first.selection,
      layer,
      placement,
    });
    expect(placed.page.id).toBe("bedroom");
    expect(placed.board.pages[0].elements).toEqual([note]);
    expect(placed.board.pages[1].presentationVisible).toBe(false);
    expect(placed.board.pages[1].elements).toEqual([
      note,
      expect.objectContaining({
        id: placed.layerId,
        materialQuantity: 2,
        materialRoomId: room.id,
        label: "Lighting",
        x: 160,
      }),
    ]);
    const replaced = mergeExtensionProductIntoRoomDesignWorkflow({
      state: first.state,
      itemKey: "lighting",
      product: { ...product, id: "product-2" },
    });
    const updated = placeLinkedExtensionSelection({
      board: placed.board,
      rooms,
      room,
      projectName,
      selection: replaced.selection,
      layer: { ...layer, productId: "product-2" },
      placement: () => ({ x: 0, y: 0 }),
    });
    expect(updated.board.pages[1].elements).toEqual([
      note,
      expect.objectContaining({
        id: placed.layerId,
        productId: "product-2",
        x: 160,
        y: 240,
      }),
    ]);
  });

  it("creates a room board when the project only has a different room’s board", () => {
    const state = createDefaultRoomDesignWorkflowState(room.name);
    const merged = mergeExtensionProductIntoRoomDesignWorkflow({
      state,
      itemKey: "lighting",
      product,
    });
    const board = normalizeExtensionBoardState<ExtensionImportLayer>({
      pages: makeBoard().pages.slice(0, 1),
    });
    const placed = placeLinkedExtensionSelection({
      board,
      rooms,
      room,
      projectName,
      selection: merged.selection,
      layer,
      placement,
    });
    expect(placed.board.pages[0]).toEqual(board.pages[0]);
    expect(placed.page.title).toBe("Primary Bedroom — Design Board 1");
    expect(placed.board.pages[1].elements.at(-1)?.id).toBe(placed.layerId);
  });

  it("fills an empty checklist slot on a direct send and keeps one placement on repeat", () => {
    const state = createDefaultRoomDesignWorkflowState(room.name);
    const board = makeBoard();
    const direct = { product, materialCategory: "Lighting", roomId: room.id, pageId: "bedroom" };
    const first = extensionBoardDirectSelection({ ...direct, state, board });
    expect(first.itemKey).toBe("lighting");
    expect(first.selection).toMatchObject({ state: "selected", productId: product.id });
    const place = (selection: typeof first.selection, previousBoard: typeof board) =>
      placeLinkedExtensionSelection({
        board: previousBoard,
        rooms,
        room,
        projectName,
        pageId: "bedroom",
        selection,
        layer,
        placement,
      });
    const placed = place(first.selection, board);
    const second = extensionBoardDirectSelection({
      ...direct,
      state: first.state,
      board: placed.board,
    });
    expect(second.state).toBe(first.state);
    expect(place(second.selection, placed.board).board).toEqual(placed.board);
    const composed = mergeRoomDesignSelectionsIntoBoard({
      boardState: placed.board,
      projectName,
      roomId: room.id,
      roomName: room.name,
      selections: first.state.selections,
    });
    expect(composed.pages).toEqual(placed.board.pages);
  });

  it("flags installation decisions after a quick direct tile import", () => {
    const board = makeBoard();
    const tile = { ...product, name: "Porcelain floor tile" };
    const { selection } = extensionBoardDirectSelection({
      state: createDefaultRoomDesignWorkflowState(room.name),
      product: tile,
      materialCategory: "Flooring",
      roomId: room.id,
      pageId: "bedroom",
      board,
    });
    const placed = placeLinkedExtensionSelection({
      board, rooms, room, projectName, pageId: "bedroom",
      selection,
      layer: { ...layer, productName: tile.name },
      placement,
    });
    expect(roomDesignTileIssues(selection)).toEqual(expect.arrayContaining([
      "Enter the grout color and joint width.",
      "Enter the tile lay direction or approved drawing reference.",
    ]));
    const imported = placed.board.pages.flatMap(page => page.elements).find(item => item.id === placed.layerId)!;
    expect(boardTileInstallationIssues(imported)).toEqual([
      "grout color / joint width", "tile layout", "tile lay direction",
    ]);
    expect(boardTileInstallationIssues(
      { ...imported, productName: "Nieve Punto", label: "Nieve Punto", materialCategory: "Tile & Stone" },
      { name: "Nieve Punto", category: "Tile" },
    )).toEqual(["grout color / joint width", "tile layout", "tile lay direction"]);
  });

  it("leaves a previously selected product in place on a direct send", () => {
    const state = createDefaultRoomDesignWorkflowState(room.name);
    const old = mergeExtensionProductIntoRoomDesignWorkflow({
      state,
      itemKey: "lighting",
      product: { ...product, id: "existing", name: "Existing chandelier" },
    });
    const next = extensionBoardDirectSelection({
      state: old.state,
      product,
      materialCategory: "Lighting",
      roomId: room.id,
      board: makeBoard(),
      pageId: "bedroom",
    });
    expect(next.itemKey).not.toBe("lighting");
    expect(next.state.selections).toEqual([
      old.selection,
      expect.objectContaining({ productId: product.id }),
    ]);
  });

  it("uses an explicit room assignment before trying an exact room title", () => {
    const page = makeBoard().pages[1];
    expect(extensionBoardPageRoom(page, rooms)).toEqual(room);
    expect(extensionBoardPageRoom({ ...page, roomId: null, title: "Foyer" }, rooms)).toEqual(
      otherRoom,
    );
    expect(extensionBoardPageRoom({ ...page, roomId: null }, rooms)).toBeUndefined();
    expect(
      extensionBoardPageRoom({ ...page, roomId: "deleted", title: "Foyer" }, rooms),
    ).toBeUndefined();
  });
});
