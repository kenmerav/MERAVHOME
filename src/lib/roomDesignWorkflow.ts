export type RoomDesignMethod = "manual" | "links" | "concept";

export type RoomDesignSelection = {
  id: string;
  category: string;
  productName: string;
  vendor: string;
  finish: string;
  source: string;
  state: "draft" | "selected" | "locked";
  swatch: string;
  url?: string;
  imageUrl?: string;
  originalImageUrl?: string;
  group?: string;
  quantity?: number;
  quantityUnit?: string;
  wastePercent?: number;
  notes?: string;
  price?: string;
  sku?: string;
  dimensions?: string;
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
  quantity: number;
  notes: string;
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

function positiveNumber(value: unknown, fallback: number) {
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
            quantity: positiveNumber(item.quantity, 1),
            notes: string(item.notes),
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
            vendor: string(item.vendor),
            finish: string(item.finish),
            source: string(item.source) || "Product link",
            state: selectionState,
            swatch: string(item.swatch),
            url: optionalString(item.url),
            imageUrl: optionalString(item.imageUrl),
            originalImageUrl: optionalString(item.originalImageUrl),
            group: optionalString(item.group),
            quantity: positiveNumber(item.quantity, 1),
            quantityUnit: optionalString(item.quantityUnit),
            wastePercent:
              typeof item.wastePercent === "number" && Number.isFinite(item.wastePercent)
                ? item.wastePercent
                : undefined,
            notes: optionalString(item.notes),
            price: optionalString(item.price),
            sku: optionalString(item.sku),
            dimensions: optionalString(item.dimensions),
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
      height: 24,
      zIndex: 1,
      text: "MERAV INTERIORS",
      color: "#a8a29e",
      fontSize: 12,
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
    (selection) => selection.state !== "draft" && Boolean(selection.imageUrl),
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
  const retainedPages = base.pages.filter((page) => !isGeneratedRoomPage(page, roomId));
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
          src: selection.imageUrl!,
          originalSrc: selection.originalImageUrl || selection.imageUrl,
          label: selection.category,
          link: selection.url || "",
          productId: selection.productId ?? null,
          productName: selection.productName || selection.category,
          vendor: selection.vendor || null,
          price: selection.price || null,
          finish: selection.finish || null,
          notes: selection.notes || null,
          visible: true,
          hideDetails: false,
          materialItemId: null,
          materialRoomId: roomId,
          materialCategory: selection.category,
          materialQuantity: positiveNumber(selection.quantity, 1),
          materialFinish: selection.finish || null,
          materialDimensions: selection.dimensions || null,
          materialInfoNotNeeded: false,
          materialInfoSkipApproved: false,
          materialExcludeFromMaterials: false,
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

export function isRoomDesignGeneratedPageId(value: string) {
  return value.startsWith(`${PAGE_PREFIX}:`);
}
