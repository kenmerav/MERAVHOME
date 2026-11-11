import {
  normalizeExtensionBoardState,
  type ExtensionBoardPage,
  type ExtensionBoardState,
} from "./extensionBoardState";
import {
  addCustomRoomDesignProductType,
  mergeExtensionProductIntoRoomDesignWorkflow,
  mergeRoomDesignSelectionsIntoBoard,
  roomDesignBoardElementId,
  roomDesignGeneratedPageCount,
  roomDesignRoomNamesMatch,
  type RoomDesignSelection,
  type RoomDesignWorkflowState,
} from "./roomDesignWorkflow";
import { roomItemNeedsProduct } from "./roomDesignDetails";

export type ExtensionImportLayer = {
  id: string;
  type: "image" | "text" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  src?: string;
  originalSrc?: string;
  backgroundRemovedUrl?: string | null;
  autoRemoveBackground?: boolean;
  backgroundRemovalStatus?: "pending" | "complete";
  label?: string;
  notes?: string;
  link?: string;
  productId?: string | null;
  productName?: string | null;
  vendor?: string | null;
  price?: string | null;
  finish?: string | null;
  sku?: string | null;
  materialRoomId?: string;
  materialCategory?: string | null;
  materialQuantity?: number | null;
  materialQuantityTbd?: boolean;
  materialQuantityUnit?: string;
  materialWastePercent?: number;
  materialFinish?: string | null;
  materialDimensions?: string | null;
  visible?: boolean;
};

type Board = ExtensionBoardState<ExtensionImportLayer>;
type Page = ExtensionBoardPage<ExtensionImportLayer>;
type Room = { id: string; name: string };
type Product = Parameters<typeof mergeExtensionProductIntoRoomDesignWorkflow>[0]["product"];

export function extensionBoardPageRoom(page: Page, rooms: Room[]) {
  if (page.roomId) return rooms.find((room) => room.id === page.roomId);
  const title = page.title.replace(/\s+[—–-]\s+Design Board \d+$/i, "");
  if (!title.trim()) return undefined;
  const matches = rooms.filter((room) => roomDesignRoomNamesMatch(title, room.name));
  return matches.length === 1 ? matches[0] : undefined;
}

export function extensionBoardDirectSelection({
  state,
  product,
  materialCategory,
  roomId,
  board,
  pageId,
}: {
  state: RoomDesignWorkflowState;
  product: Product;
  materialCategory: string;
  roomId: string;
  board: Board;
  pageId: string;
}) {
  const usedOnAnotherPage = new Set(
    board.pages
      .filter((page) => page.id !== pageId)
      .flatMap((page) => page.elements.map(({ id }) => id)),
  );
  const matches = state.selections.filter(
    (item) =>
      item.id.startsWith("link-") &&
      item.productId === product.id &&
      item.state !== "draft" &&
      roomItemNeedsProduct(item) &&
      state.links.some((link) => `link-${link.id}` === item.id && roomItemNeedsProduct(link)) &&
      !usedOnAnotherPage.has(roomDesignBoardElementId(roomId, item.id)),
  );
  const exactOnPage = matches.find((item) =>
    board.pages
      .find((page) => page.id === pageId)
      ?.elements.some(({ id }) => id === roomDesignBoardElementId(roomId, item.id)),
  );
  const existing = exactOnPage || (matches.length === 1 ? matches[0] : undefined);
  if (existing) return { state, selection: existing, itemKey: existing.id.slice(5) };

  const normalized = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
  const category = normalized(materialCategory);
  const candidates = state.links.filter(
    (link) =>
      roomItemNeedsProduct(link) &&
      !link.url &&
      !link.productId &&
      !link.catalogProductName &&
      !state.selections.some((item) => item.id === `link-${link.id}`) &&
      (normalized(link.category) === category ||
        normalized(link.category) === normalized(product.name)),
  );
  let item = candidates.length === 1 ? candidates[0] : undefined;
  if (!item) {
    let label = product.name.slice(0, 80).trim();
    const taken = new Set(
      state.links.map((link) => normalized(link.category.replace(/\(s\)/gi, ""))),
    );
    for (let number = 2; taken.has(normalized(label.replace(/\(s\)/gi, ""))); number += 1) {
      const suffix = ` (${number})`;
      label = `${product.name.slice(0, 80 - suffix.length).trim()}${suffix}`;
    }
    const created = addCustomRoomDesignProductType({
      state,
      label,
      itemId: `custom-${crypto.randomUUID()}`,
    });
    state = created.state;
    item = created.item;
  }
  const merged = mergeExtensionProductIntoRoomDesignWorkflow({
    state,
    itemKey: item.id,
    product: { ...product, quantity: item.quantity },
  });
  return { state: merged.state, selection: merged.selection, itemKey: item.id };
}

export function placeLinkedExtensionSelection({
  board,
  room,
  rooms,
  projectName,
  pageId,
  selection,
  layer,
  placement,
}: {
  board: Board;
  room: Room;
  rooms: Room[];
  projectName: string;
  pageId?: string;
  selection: RoomDesignSelection;
  layer: Omit<ExtensionImportLayer, "id" | "x" | "y" | "zIndex">;
  placement: (elements: ExtensionImportLayer[]) => { x: number; y: number };
}) {
  const id = roomDesignBoardElementId(room.id, selection.id);
  const pagesForRoom = board.pages.filter(
    (page) => extensionBoardPageRoom(page, rooms)?.id === room.id,
  );
  const existingPage = board.pages.find((page) =>
    page.elements.some((element) => element.id === id),
  );
  if (
    existingPage &&
    (!pagesForRoom.includes(existingPage) || (pageId && existingPage.id !== pageId))
  ) {
    throw new Error(
      "The linked board item moved to another page. Open the room and board before trying again.",
    );
  }
  let target = pageId ? pagesForRoom.find((page) => page.id === pageId) : undefined;
  if (pageId && !target)
    throw new Error("This board page is no longer assigned to the selected room.");
  target ??=
    existingPage ||
    pagesForRoom.find((page) => page.id === board.selectedPageId && !page.hidden) ||
    pagesForRoom.find((page) => !page.hidden) ||
    pagesForRoom[0];
  if (!target) {
    if (roomDesignGeneratedPageCount(board, room.id)) {
      throw new Error(
        "This room’s generated board page was reassigned. Check its room on the design board.",
      );
    }
    board = normalizeExtensionBoardState(
      mergeRoomDesignSelectionsIntoBoard({
        boardState: board,
        projectName,
        roomId: room.id,
        roomName: room.name,
        selections: [],
        pageCount: 1,
      }),
    );
    target = board.pages.find((page) => page.id === board.selectedPageId);
    if (!target) throw new Error("Could not create the board page for this room.");
  }
  const page = target;
  const existing = page.elements.find((item) => item.id === id);
  const sameProduct = Boolean(existing?.productId && existing.productId === selection.productId);
  const element: ExtensionImportLayer = {
    ...existing,
    ...layer,
    ...placement(page.elements),
    id,
    ...(existing
      ? { x: existing.x, y: existing.y, width: existing.width, height: existing.height }
      : {}),
    zIndex: existing?.zIndex ?? Math.max(0, ...page.elements.map((item) => item.zIndex ?? 0)) + 1,
    label: sameProduct ? existing?.label || selection.category : selection.category,
    notes: selection.notes || (sameProduct ? existing?.notes : "") || "",
    visible: existing?.visible ?? true,
    materialRoomId: room.id,
    materialQuantity: selection.quantity ?? null,
    materialQuantityTbd: selection.quantity == null,
    materialQuantityUnit: selection.quantityUnit,
    materialWastePercent: selection.wastePercent,
    ...(sameProduct && existing?.originalSrc
      ? {
          src: existing.src,
          originalSrc: existing.originalSrc,
          backgroundRemovedUrl: existing.backgroundRemovedUrl,
          autoRemoveBackground: existing.autoRemoveBackground,
          backgroundRemovalStatus: existing.backgroundRemovalStatus,
        }
      : {}),
  };
  return {
    board: {
      ...board,
      pages: board.pages.map((candidate) =>
        candidate.id === page.id
          ? {
              ...candidate,
              roomId: room.id,
              elements: existing
                ? page.elements.map((item) => (item.id === id ? element : item))
                : [...page.elements, element],
            }
          : candidate,
      ),
    },
    page,
    layerId: id,
  };
}
