import { classifyBoardGroup, selectionItemsForRoom } from "@/lib/selectionChecklist";
import { cleanRoomDesignFinish } from "./productDetails";
import { productAwareQuantityUnit } from "./roomDesignReview";
import { roomDesignInitialQuantity, roomItemStatus } from "./roomDesignDetails";

export type RoomDesignMethod = "manual" | "links" | "concept";

export type RoomDesignSelection = {
  accuracySource?: { id: string; version: number };
  id: string;
  category: string;
  productName: string;
  vendor: string;
  manufacturer?: string;
  colorOptions?: string[];
  colorOptionImages?: Record<string, string>;
  surfaceFinish?: string;
  scrapeFacts?: Partial<
    Record<
      | "productName"
      | "manufacturer"
      | "finish"
      | "dimensions"
      | "selectedSize"
      | "sku"
      | "imageUrl",
      string
    >
  >;
  finish: string;
  source: string;
  state: "draft" | "selected" | "locked";
  swatch: string;
  url?: string;
  imageUrl?: string;
  originalImageUrl?: string;
  group?: string;
  quantity?: number | null;
  quantityUnit?: string;
  wastePercent?: number;
  notes?: string;
  price?: string;
  sku?: string;
  dimensions?: string;
  sizeOptions?: string[];
  selectedSize?: string;
  reviewFields?: string[];
  productId?: string | null;
  scrapeStatus?: "complete" | "partial" | "failed";
  scrapeError?: string;
  materialsSyncStatus?: "current" | "changed";
};

export type RoomDesignLink = {
  id: string;
  category: string;
  url: string;
  group: string;
  quantity: number | null;
  notes: string;
  productId?: string;
  catalogProductName?: string;
  custom?: boolean;
  saveToTemplate?: boolean;
};

export type RoomDesignWorkflowState = {
  version: 1;
  method: RoomDesignMethod;
  stage: number;
  links: RoomDesignLink[];
  linksRoomName: string;
  selections: RoomDesignSelection[];
  conceptImageUrl: string;
  roomImageUrl: string;
  floorPlanImageUrl: string;
  sketchupImageUrl: string;
  completedRenderImageUrl: string;
  boardReady: boolean;
  renderReady: boolean;
  materialsSent: boolean;
  updatedAt: string;
};

type BoardElement = Record<string, unknown> & {
  id: string;
  type: "image" | "text" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
};

type BoardPage = Record<string, unknown> & {
  id: string;
  title: string;
  roomId: string | null;
  elements: BoardElement[];
};

type BoardState = Record<string, unknown> & {
  pages: BoardPage[];
  selectedPageId: string;
};

const PAGE_PREFIX = "room-design-v2";

export function roomDesignDefaultQuantityUnit(category: string, productName = "") {
  if (productName) return productAwareQuantityUnit(category, productName);
  if (/stair runner/i.test(category)) return "linear ft";
  if (/power/i.test(category)) return "each";
  if (/flooring|tile|backsplash/i.test(category)) return "sq ft";
  if (/baseboard|casing|transition/i.test(category)) return "linear ft";
  if (/countertop/i.test(category)) return "slab";
  if (/wall finish|ceiling finish|vanity finish|paint/i.test(category)) return "gallon";
  if (/shower system/i.test(category)) return "set";
  return "each";
}

export function roomDesignDefaultWastePercent(category: string) {
  if (/flooring|tile|backsplash/i.test(category)) return 10;
  if (/baseboard|casing|transition/i.test(category)) return 5;
  return 0;
}

function roomDesignGroupSwatch(group: string) {
  const swatches: Record<string, string> = {
    Materials: "linear-gradient(135deg,#e9e2d8,#b9ab98 48%,#f5f2ec 52%,#cdbfae)",
    "Cabinetry / Millwork": "repeating-linear-gradient(90deg,#b7946f 0 7px,#c7a783 8px 13px)",
    Plumbing: "linear-gradient(145deg,#f0ede5 0 35%,#97938a 36% 44%,#ded9cf 45% 66%,#77736c 67%)",
    Lighting: "radial-gradient(circle,#f2dfba 0 24%,#b58a50 26% 34%,transparent 36%)",
    Appliances: "linear-gradient(135deg,#d9d8d4,#777672 48%,#efeee9 50%,#999793)",
    Hardware: "radial-gradient(circle,#b58a50 0 35%,#836236 36% 45%,transparent 47%)",
    "Feature / Decor": "linear-gradient(135deg,#ccbca8,#8d7864)",
    "Architecture / Other": "linear-gradient(135deg,#ece8df,#c9c1b5)",
  };
  return swatches[group] || swatches["Architecture / Other"];
}

export function createDefaultRoomDesignWorkflowState(roomName: string): RoomDesignWorkflowState {
  return {
    version: 1,
    method: "links",
    stage: 0,
    links: selectionItemsForRoom(roomName).map((requiredItem) => ({
      id: requiredItem.key,
      category: requiredItem.label,
      url: "",
      group: classifyBoardGroup(requiredItem.label),
      quantity: roomDesignInitialQuantity(requiredItem.label),
      notes: "",
    })),
    linksRoomName: roomName,
    selections: [],
    conceptImageUrl: "",
    roomImageUrl: "",
    floorPlanImageUrl: "",
    sketchupImageUrl: "",
    completedRenderImageUrl: "",
    boardReady: false,
    renderReady: false,
    materialsSent: false,
    updatedAt: new Date().toISOString(),
  };
}

function normalizedCategory(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function roomDesignRoomNamesMatch(expectedRoomName: string, actualRoomName: string) {
  return (
    !expectedRoomName || normalizedCategory(expectedRoomName) === normalizedCategory(actualRoomName)
  );
}

/** Adds newly introduced room rows without replacing saved work or restoring intentionally removed rows. */
export function reconcileRoomDesignChecklist(
  state: RoomDesignWorkflowState,
  roomName: string,
): RoomDesignWorkflowState {
  const isPrimaryBathroom = /primary.*bath/i.test(roomName);
  const isPowderBathroom = /powder.*(?:bath|room)/i.test(roomName);
  const renamedLinks = state.links.map((link) =>
    isPrimaryBathroom &&
    (link.id === "freestanding-tub" || normalizedCategory(link.category) === "freestanding tub")
      ? { ...link, category: "Tub", group: classifyBoardGroup("Tub") }
      : link,
  );
  const categories = new Set(renamedLinks.map((link) => normalizedCategory(link.category)));
  const ids = new Set(renamedLinks.map((link) => link.id));
  const defaultTub = isPrimaryBathroom
    ? createDefaultRoomDesignWorkflowState(roomName).links.find((link) => link.id === "tub")
    : undefined;
  const missingTub =
    defaultTub &&
    !ids.has(defaultTub.id) &&
    !categories.has(normalizedCategory(defaultTub.category))
      ? [defaultTub]
      : [];
  const newPowderBathroomCategories = new Set([
    "Recessed lighting",
    "Exhaust fan",
    "Toilet paper holder",
    "Hand towel holder",
  ]);
  const missingPowderBathroomLinks = isPowderBathroom
    ? createDefaultRoomDesignWorkflowState(roomName).links.filter(
        (link) =>
          newPowderBathroomCategories.has(link.category) &&
          !ids.has(link.id) &&
          !categories.has(normalizedCategory(link.category)),
      )
    : [];
  const missingLinks = [...missingTub, ...missingPowderBathroomLinks];
  const newBathroomCategories = new Set([
    "Recessed lighting",
    "Exhaust fan",
    "Toilet paper holder",
    "Hand towel holder",
    "Towel bar",
    "Shower glass / enclosure",
    "Shower glass hardware",
    "Shower niche",
    "Shower bench",
    "Shower curb / threshold",
    "Shower rough-in valve",
  ]);
  const upgradedRoom =
    !isPrimaryBathroom &&
    !isPowderBathroom &&
    /bath|restroom|washroom|laundry|utility|mud.?room|built.?in|fireplace|project.?wide|whole.?home|whole.?house/i.test(
      roomName,
    );
  const additions = createDefaultRoomDesignWorkflowState(roomName).links.filter(
    (link) =>
      (upgradedRoom ||
        [
          "Ceiling fan",
          "Stair runner",
          "Exterior paint touch-ups",
          "Tile installation defaults",
        ].includes(link.category) ||
        ((isPrimaryBathroom || isPowderBathroom) && newBathroomCategories.has(link.category))) &&
      !ids.has(link.id) &&
      !categories.has(normalizedCategory(link.category)) &&
      !missingLinks.some((other) => other.id === link.id),
  );
  missingLinks.push(...additions);
  const links = [...renamedLinks, ...missingLinks];
  const linkBySelectionId = new Map(links.map((link) => [`link-${link.id}`, link]));
  const selections = state.selections.map((selection) => {
    const link = linkBySelectionId.get(selection.id);
    return link && (selection.category !== link.category || selection.group !== link.group)
      ? { ...selection, category: link.category, group: link.group }
      : selection;
  });

  const renamed = renamedLinks.some((link, index) => link !== state.links[index]);
  const selectionRenamed = selections.some(
    (selection, index) => selection !== state.selections[index],
  );
  if (missingLinks.length === 0 && !renamed && !selectionRenamed) {
    return state;
  }
  return {
    ...state,
    links,
    selections,
    linksRoomName: roomName || state.linksRoomName,
  };
}

export function addCustomRoomDesignProductType({
  state,
  label,
  itemId,
}: {
  state: RoomDesignWorkflowState;
  label: string;
  itemId: string;
}) {
  const category = label.trim().replace(/\s+/g, " ");
  if (!category) throw new Error("Enter a product type name.");
  if (category.length > 80) throw new Error("Product type names must be 80 characters or fewer.");

  const existing = state.links.find(
    (link) => normalizedCategory(link.category) === normalizedCategory(category),
  );
  if (existing) return { state, item: existing, added: false };
  if (!/^custom-[a-z0-9-]+$/i.test(itemId)) throw new Error("Could not create the product type.");

  const item: RoomDesignLink = {
    id: itemId,
    category,
    url: "",
    group: classifyBoardGroup(category),
    quantity: roomDesignInitialQuantity(category),
    notes: "",
    custom: true,
    saveToTemplate: false,
  };
  return {
    state: {
      ...state,
      links: [...state.links, item],
      boardReady: false,
      renderReady: false,
      updatedAt: new Date().toISOString(),
    },
    item,
    added: true,
  };
}

export function mergeExtensionProductIntoRoomDesignWorkflow({
  state,
  itemKey,
  product,
}: {
  state: RoomDesignWorkflowState;
  itemKey: string;
  product: {
    id: string;
    name: string;
    vendor: string;
    finish: string;
    sourcePageUrl: string;
    imageUrl: string;
    originalImageUrl: string;
    price: string;
    sku: string;
    dimensions: string;
    sizeOptions?: string[];
    selectedSize?: string;
    quantity: number | null;
  };
}) {
  const target = state.links.find((link) => link.id === itemKey);
  if (!target) throw new Error("That product type is no longer available for this room.");

  const selectionId = `link-${target.id}`;
  const existingSelection = state.selections.find((selection) => selection.id === selectionId);
  if (existingSelection?.accuracySource)
    throw new Error(
      "This selection has versioned design decisions. Import as a new selection or review the replacement in Room Design first.",
    );
  const nextSelection: RoomDesignSelection = {
    ...existingSelection,
    id: selectionId,
    category: target.category,
    productName: product.name,
    vendor: product.vendor,
    finish: product.finish || "Finish needs review",
    source: "Product link",
    state: "selected",
    swatch: roomDesignGroupSwatch(target.group),
    url: product.sourcePageUrl,
    imageUrl: product.imageUrl,
    originalImageUrl: product.originalImageUrl,
    group: target.group,
    quantity: product.quantity,
    quantityUnit:
      existingSelection?.quantityUnit ||
      roomDesignDefaultQuantityUnit(target.category, product.name),
    wastePercent: existingSelection?.wastePercent ?? roomDesignDefaultWastePercent(target.category),
    notes: target.notes || existingSelection?.notes,
    price: product.price || undefined,
    sku: product.sku || undefined,
    dimensions: product.dimensions || undefined,
    sizeOptions: product.sizeOptions,
    selectedSize: product.selectedSize,
    reviewFields: undefined,
    productId: product.id,
    scrapeStatus: product.finish ? "complete" : "partial",
    scrapeError: product.finish ? undefined : "Color/finish needs review.",
    materialsSyncStatus: state.materialsSent ? "changed" : existingSelection?.materialsSyncStatus,
  };
  const selections = state.selections.some((selection) => selection.id === selectionId)
    ? state.selections.map((selection) =>
        selection.id === selectionId ? nextSelection : selection,
      )
    : [...state.selections, nextSelection];
  const links = state.links.map((link) =>
    link.id === target.id
      ? {
          ...link,
          url: product.sourcePageUrl,
          quantity: product.quantity,
          productId: product.id,
          catalogProductName: product.name,
        }
      : link,
  );
  const filled = new Set(
    selections
      .filter((selection) => selection.state !== "draft")
      .map((selection) => selection.id.replace(/^link-/, "")),
  );
  const targetIndex = links.findIndex((link) => link.id === target.id);
  const nextLinks = [...links.slice(targetIndex + 1), ...links.slice(0, targetIndex)];
  const nextItem = nextLinks.find((link) => !filled.has(link.id)) ?? null;

  return {
    state: {
      ...state,
      method: "links" as const,
      stage: 1,
      links,
      linksRoomName: state.linksRoomName || "Room",
      selections,
      boardReady: false,
      renderReady: false,
      updatedAt: new Date().toISOString(),
    },
    item: target,
    nextItem,
    replaced: Boolean(existingSelection),
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  const normalized = string(value).trim();
  return normalized || undefined;
}

function positiveNumber(value: unknown, fallback: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function normalizeRoomDesignWorkflowState(
  value: unknown,
  fallback: Omit<RoomDesignWorkflowState, "version" | "updatedAt">,
): RoomDesignWorkflowState {
  const candidate = object(value);
  const method =
    candidate.method === "manual" || candidate.method === "links" || candidate.method === "concept"
      ? candidate.method
      : fallback.method;
  const links = Array.isArray(candidate.links)
    ? candidate.links.flatMap((entry) => {
        const item = object(entry);
        const id = string(item.id);
        const category = string(item.category);
        if (!id || !category) return [];
        return [
          {
            id,
            category,
            url: string(item.url),
            group: string(item.group) || "Architecture / Other",
            quantity: positiveNumber(item.quantity, null),
            notes: string(item.notes),
            productId: optionalString(item.productId),
            catalogProductName: optionalString(item.catalogProductName),
            custom: item.custom === true,
            saveToTemplate: item.saveToTemplate === true,
          },
        ];
      })
    : fallback.links;
  const selections: RoomDesignSelection[] = Array.isArray(candidate.selections)
    ? candidate.selections.flatMap<RoomDesignSelection>((entry) => {
        const item = object(entry);
        const id = string(item.id);
        const category = string(item.category);
        if (!id || !category) return [];
        const selectionState =
          item.state === "draft" || item.state === "locked" || item.state === "selected"
            ? item.state
            : "selected";
        return [
          {
            id,
            category,
            productName: string(item.productName) || category,
            accuracySource:
              typeof object(item.accuracySource).id === "string" &&
              typeof object(item.accuracySource).version === "number"
                ? (item.accuracySource as RoomDesignSelection["accuracySource"])
                : undefined,
            vendor: string(item.vendor),
            manufacturer: optionalString(item.manufacturer),
            colorOptions: Array.isArray(item.colorOptions)
              ? item.colorOptions.filter((value): value is string => typeof value === "string")
              : undefined,
            colorOptionImages: item.colorOptionImages
              ? (Object.fromEntries(
                  Object.entries(object(item.colorOptionImages)).filter(
                    ([, value]) => typeof value === "string" && /^https?:\/\//i.test(value),
                  ),
                ) as Record<string, string>)
              : undefined,
            surfaceFinish: optionalString(item.surfaceFinish),
            scrapeFacts: item.scrapeFacts
              ? Object.fromEntries(
                  [
                    "productName",
                    "manufacturer",
                    "finish",
                    "dimensions",
                    "selectedSize",
                    "sku",
                    "imageUrl",
                  ].flatMap((key) => {
                    const value = optionalString(object(item.scrapeFacts)[key]);
                    return value ? [[key, value]] : [];
                  }),
                )
              : undefined,
            finish: cleanRoomDesignFinish(item.finish),
            source: string(item.source) || "Product link",
            state: selectionState,
            swatch: string(item.swatch),
            url: optionalString(item.url),
            imageUrl: optionalString(item.imageUrl),
            originalImageUrl: optionalString(item.originalImageUrl),
            group: optionalString(item.group),
            quantity: positiveNumber(item.quantity, null),
            quantityUnit: optionalString(item.quantityUnit),
            wastePercent:
              typeof item.wastePercent === "number" && Number.isFinite(item.wastePercent)
                ? item.wastePercent
                : undefined,
            notes: optionalString(item.notes),
            price: optionalString(item.price),
            sku: optionalString(item.sku),
            dimensions: optionalString(item.dimensions),
            sizeOptions: Array.isArray(item.sizeOptions)
              ? item.sizeOptions.filter((value): value is string => typeof value === "string")
              : undefined,
            selectedSize: optionalString(item.selectedSize),
            reviewFields: Array.isArray(item.reviewFields)
              ? item.reviewFields.filter((value): value is string => typeof value === "string")
              : undefined,
            productId: typeof item.productId === "string" ? item.productId : null,
            scrapeStatus:
              item.scrapeStatus === "complete" ||
              item.scrapeStatus === "partial" ||
              item.scrapeStatus === "failed"
                ? item.scrapeStatus
                : undefined,
            scrapeError: optionalString(item.scrapeError),
            materialsSyncStatus:
              item.materialsSyncStatus === "current" || item.materialsSyncStatus === "changed"
                ? item.materialsSyncStatus
                : undefined,
          },
        ];
      })
    : fallback.selections;

  return {
    version: 1,
    method,
    stage:
      typeof candidate.stage === "number" && Number.isFinite(candidate.stage)
        ? Math.min(5, Math.max(0, Math.round(candidate.stage)))
        : fallback.stage,
    links,
    linksRoomName: string(candidate.linksRoomName) || fallback.linksRoomName,
    selections,
    conceptImageUrl: string(candidate.conceptImageUrl) || fallback.conceptImageUrl,
    roomImageUrl: string(candidate.roomImageUrl) || fallback.roomImageUrl,
    floorPlanImageUrl: string(candidate.floorPlanImageUrl) || fallback.floorPlanImageUrl,
    sketchupImageUrl: string(candidate.sketchupImageUrl) || fallback.sketchupImageUrl,
    completedRenderImageUrl:
      string(candidate.completedRenderImageUrl) || fallback.completedRenderImageUrl,
    boardReady: candidate.boardReady === true,
    renderReady: candidate.renderReady === true,
    materialsSent: candidate.materialsSent === true,
    updatedAt: string(candidate.updatedAt) || new Date().toISOString(),
  };
}

function generatedPageId(roomId: string, pageIndex: number) {
  return `${PAGE_PREFIX}:${roomId}:${pageIndex + 1}`;
}

function generatedElementId(roomId: string, selectionId: string) {
  return `${PAGE_PREFIX}:${roomId}:selection:${selectionId}`;
}

function isGeneratedRoomPage(page: BoardPage, roomId: string) {
  return page.id.startsWith(`${PAGE_PREFIX}:${roomId}:`);
}

export function roomDesignGeneratedPageCount(boardState: unknown, roomId: string) {
  return normalizeBoardState(boardState).pages.filter((page) => isGeneratedRoomPage(page, roomId))
    .length;
}

function placement(index: number, count: number, label: string) {
  const columns = count <= 4 ? 2 : count <= 8 ? 4 : count <= 15 ? 5 : 6;
  const rows = Math.ceil(count / columns);
  const startX = 70;
  const startY = 175;
  const cellWidth = 1260 / columns;
  const cellHeight = 600 / rows;
  const small = /drain|rough.?in|switch|outlet|plate|hardware|hook|accessor|transition/i.test(
    label,
  );
  const large =
    !small &&
    /flooring|wall finish|ceiling finish|vanity|countertop|backsplash|tile|tub|mirror/i.test(label);
  const width = Math.min(cellWidth - 34, small ? 112 : large ? 210 : 168);
  const height = Math.min(cellHeight - 58, small ? 82 : large ? 150 : 120);
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: Math.round(startX + column * cellWidth + (cellWidth - width) / 2),
    y: Math.round(startY + row * cellHeight + (cellHeight - height - 36) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function headerElements(
  projectName: string,
  roomId: string,
  roomName: string,
  pageIndex: number,
  pageCount: number,
) {
  const pageKey = `${PAGE_PREFIX}:${roomId}:${pageIndex + 1}`;
  const pageLabel = pageCount > 1 ? `PAGE ${pageIndex + 1}` : "";
  return [
    {
      id: `${pageKey}:header:project`,
      type: "text" as const,
      x: 300,
      y: 35,
      width: 800,
      height: 32,
      zIndex: 1,
      text: projectName.toUpperCase(),
      color: "#78716c",
      fontSize: 16,
      fontFamily: "var(--font-montserrat)",
      letterSpacing: 7,
      locked: true,
      visible: true,
    },
    {
      id: `${pageKey}:header:room`,
      type: "text" as const,
      x: 300,
      y: 76,
      width: 800,
      height: 55,
      zIndex: 2,
      text: roomName.toUpperCase(),
      color: "#1c1917",
      fontSize: 42,
      fontFamily: "var(--font-display)",
      letterSpacing: 1,
      locked: true,
      visible: true,
    },
    ...(pageLabel
      ? [
          {
            id: `${pageKey}:header:page`,
            type: "text" as const,
            x: 550,
            y: 128,
            width: 300,
            height: 24,
            zIndex: 3,
            text: pageLabel,
            color: "#a8a29e",
            fontSize: 11,
            fontFamily: "var(--font-montserrat)",
            letterSpacing: 4,
            locked: true,
            visible: true,
          },
        ]
      : []),
    {
      id: `${pageKey}:footer:brand`,
      type: "text" as const,
      x: 450,
      y: 850,
      width: 500,
      height: 36,
      zIndex: 1,
      text: "MERAV INTERIORS",
      color: "#a8a29e",
      fontSize: 20,
      fontFamily: "var(--font-montserrat)",
      letterSpacing: 6,
      locked: true,
      visible: true,
    },
  ];
}

function normalizeBoardState(value: unknown): BoardState {
  const candidate = object(value);
  const pages = Array.isArray(candidate.pages)
    ? candidate.pages.flatMap((entry) => {
        const page = object(entry);
        if (typeof page.id !== "string" || !page.id) return [];
        return [
          {
            ...page,
            id: page.id,
            title: string(page.title) || "Design Board",
            roomId: typeof page.roomId === "string" ? page.roomId : null,
            elements: Array.isArray(page.elements)
              ? page.elements.filter((element): element is BoardElement =>
                  Boolean(
                    element &&
                    typeof element === "object" &&
                    typeof (element as BoardElement).id === "string",
                  ),
                )
              : [],
          },
        ];
      })
    : [];
  return {
    ...candidate,
    pages,
    selectedPageId:
      typeof candidate.selectedPageId === "string" ? candidate.selectedPageId : pages[0]?.id || "",
  };
}

function isUntouchedDefaultPage(state: BoardState, page: BoardPage) {
  const hasPageComment = Array.isArray(state.comments)
    ? state.comments.some((entry) => object(entry).pageId === page.id)
    : false;
  return (
    page.id === "board-1" &&
    page.title === "Design Board 1" &&
    page.roomId === null &&
    page.elements.length === 0 &&
    !hasPageComment
  );
}

export function mergeRoomDesignSelectionsIntoBoard({
  boardState,
  projectName,
  roomId,
  roomName,
  selections,
  pageCount,
}: {
  boardState: unknown;
  projectName: string;
  roomId: string;
  roomName: string;
  selections: RoomDesignSelection[];
  pageCount?: number;
}) {
  const base = normalizeBoardState(boardState);
  const usableSelections = selections.filter(
    (selection) =>
      selection.state !== "draft" &&
      roomItemStatus(selection) !== "Not needed" &&
      (Boolean(selection.imageUrl) || roomItemStatus(selection) !== "Choose product"),
  );
  const count = Math.max(
    1,
    Math.min(
      pageCount ?? Math.ceil(usableSelections.length / 18),
      Math.max(1, usableSelections.length),
    ),
  );
  const priorGeneratedPages = base.pages.filter((page) => isGeneratedRoomPage(page, roomId));
  const priorElements = new Map(
    priorGeneratedPages.flatMap((page) =>
      page.elements.map((element) => [element.id, element] as const),
    ),
  );
  const pageCountChanged = priorGeneratedPages.length > 0 && priorGeneratedPages.length !== count;
  const retainedPages = base.pages.filter(
    (page) => !isGeneratedRoomPage(page, roomId) && !isUntouchedDefaultPage(base, page),
  );
  const generatedPages: BoardPage[] = Array.from({ length: count }, (_, pageIndex) => ({
    id: generatedPageId(roomId, pageIndex),
    title: `${roomName} — Design Board ${pageIndex + 1}`,
    roomId,
    presentationVisible: true,
    elements: headerElements(projectName, roomId, roomName, pageIndex, count),
  }));

  const basePageSize = Math.floor(usableSelections.length / count);
  const remainder = usableSelections.length % count;
  let cursor = 0;
  generatedPages.forEach((page, pageIndex) => {
    const pageSize = basePageSize + (pageIndex < remainder ? 1 : 0);
    const pageSelections = usableSelections.slice(cursor, cursor + pageSize);
    cursor += pageSize;
    page.elements.push(
      ...pageSelections.map((selection, index) => {
        const id = generatedElementId(roomId, selection.id);
        const existing = priorElements.get(id);
        const stockPlacement = placement(index, pageSelections.length, selection.category);
        if (!selection.imageUrl) {
          return {
            ...(existing ?? {}),
            id,
            type: "text" as const,
            x: existing?.x ?? stockPlacement.x,
            y: existing?.y ?? stockPlacement.y,
            width: existing?.width ?? stockPlacement.width,
            height: existing?.height ?? stockPlacement.height,
            zIndex: existing?.zIndex ?? 10 + index,
            fontSize: 14,
            color: "#171511",
            text: `${selection.category}\n${roomItemStatus(selection)}\n${selection.notes || ""}`,
            label: selection.category,
            notes: selection.notes || null,
            visible: true,
            materialExcludeFromMaterials: true,
          };
        }
        const originalSrc = selection.originalImageUrl || selection.imageUrl;
        const hasPreparedCutout = Boolean(
          selection.originalImageUrl && selection.originalImageUrl !== selection.imageUrl,
        );
        const sameSourceAsExisting = Boolean(existing && existing.originalSrc === originalSrc);
        const existingSrc = typeof existing?.src === "string" ? existing.src : undefined;
        const existingBackgroundRemovedUrl =
          typeof existing?.backgroundRemovedUrl === "string" ? existing.backgroundRemovedUrl : null;
        const shouldAutoRemoveBackground = hasPreparedCutout
          ? false
          : sameSourceAsExisting
            ? existing?.autoRemoveBackground === true
            : !isMaterialSwatch(selection.category);
        return {
          ...(existing ?? {}),
          id,
          type: "image" as const,
          x: !existing || pageCountChanged ? stockPlacement.x : existing.x,
          y: !existing || pageCountChanged ? stockPlacement.y : existing.y,
          width: !existing || pageCountChanged ? stockPlacement.width : existing.width,
          height: !existing || pageCountChanged ? stockPlacement.height : existing.height,
          rotation: typeof existing?.rotation === "number" ? existing.rotation : 0,
          zIndex: typeof existing?.zIndex === "number" ? existing.zIndex : 10 + index,
          src:
            hasPreparedCutout || !sameSourceAsExisting
              ? selection.imageUrl!
              : existingSrc || selection.imageUrl!,
          originalSrc,
          backgroundRemovedUrl: hasPreparedCutout
            ? selection.imageUrl
            : sameSourceAsExisting
              ? existingBackgroundRemovedUrl
              : null,
          autoRemoveBackground: shouldAutoRemoveBackground,
          label: selection.category,
          link: selection.url || "",
          productId: selection.productId ?? null,
          productName: selection.productName || selection.category,
          vendor: selection.vendor || null,
          price: selection.price || null,
          sku: selection.sku || null,
          finish: selection.finish || null,
          notes: selection.notes || null,
          visible: true,
          hideDetails: false,
          materialItemId: null,
          materialRoomId: roomId,
          materialCategory: selection.category,
          designAccuracySourceId: selection.accuracySource?.id,
          designAccuracySelectionVersion: selection.accuracySource?.version,
          materialQuantity: positiveNumber(selection.quantity, null),
          materialQuantityTbd: selection.quantity == null,
          materialQuantityUnit:
            selection.quantityUnit || roomDesignDefaultQuantityUnit(selection.category),
          materialWastePercent: selection.wastePercent || 0,
          materialFinish: selection.finish || null,
          materialDimensions: selection.dimensions || null,
          materialInfoNotNeeded: false,
          materialInfoSkipApproved: false,
          materialExcludeFromMaterials:
            existing?.materialExcludeFromMaterials === true ||
            roomItemStatus(selection) === "Instructions only" ||
            roomItemStatus(selection) === "TBD",
        };
      }),
    );
  });

  const insertAt = base.pages.findIndex((page) => page.roomId === roomId);
  const pages = [...retainedPages];
  pages.splice(
    insertAt >= 0 ? Math.min(insertAt, pages.length) : pages.length,
    0,
    ...generatedPages,
  );
  const selectedPageId = generatedPages[0]?.id || base.selectedPageId || pages[0]?.id || "";
  return { ...base, pages, selectedPageId };
}

function isMaterialSwatch(category: string) {
  return /flooring|wall finish|ceiling finish|vanity finish|countertop|backsplash|shower wall tile|shower floor tile/i.test(
    category,
  );
}

export function isRoomDesignGeneratedPageId(value: string) {
  return value.startsWith(`${PAGE_PREFIX}:`);
}

export function roomDesignBoardDisplayLabel(element: {
  id?: unknown;
  label?: unknown;
  productName?: unknown;
  materialCategory?: unknown;
}) {
  const savedLabel = typeof element.label === "string" ? element.label.trim() : "";
  const productName = typeof element.productName === "string" ? element.productName.trim() : "";
  const materialCategory =
    typeof element.materialCategory === "string" ? element.materialCategory.trim() : "";
  const isGeneratedRoomDesignItem =
    typeof element.id === "string" && element.id.startsWith(`${PAGE_PREFIX}:`);

  // Room Design boards use the checklist type (for example, "Tub") as the
  // presentation caption. Keep productName separate for Materials and specs.
  return isGeneratedRoomDesignItem && materialCategory
    ? savedLabel && savedLabel !== productName
      ? savedLabel
      : materialCategory
    : savedLabel || productName;
}
