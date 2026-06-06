import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  MessageSquare,
  Plus,
  Search,
  Scissors,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import {
  db,
  type MaterialItem,
  type Product,
  type ProductCategory,
  type Room,
  type UserProfile,
} from "@/lib/db";
import { buildClientProductName } from "@/lib/clientProductName";
import {
  ALL_CATEGORIES,
  inferMaterialCategory,
  toProductCategory,
  type ItemCategory,
} from "@/lib/roomTemplates";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/projects/$id/design-boards")({
  head: () => ({ meta: [{ title: "Design Boards — MERAV Studio" }] }),
  component: ProjectDesignBoardsPage,
});

type BoardElementType = "image" | "text" | "shape";

type BoardElement = {
  id: string;
  type: BoardElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex: number;
  src?: string;
  originalSrc?: string;
  label?: string;
  notes?: string;
  text?: string;
  background?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  letterSpacing?: number;
  link?: string;
  locked?: boolean;
  visible?: boolean;
  hideDetails?: boolean;
  productId?: string | null;
  productName?: string | null;
  vendor?: string | null;
  price?: string | null;
  finish?: string | null;
  materialItemId?: string | null;
  materialRoomId?: string | null;
  materialCategory?: string | null;
  materialQuantity?: number | null;
  materialFinish?: string | null;
  materialInfoNotNeeded?: boolean;
};

type BoardPage = {
  id: string;
  title: string;
  roomId: string | null;
  elements: BoardElement[];
};

type BoardCommentTargetType = "page" | "element";

type BoardComment = {
  id: string;
  targetType: BoardCommentTargetType;
  targetId: string;
  pageId: string;
  body: string;
  taggedUserIds: string[];
  createdById?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
};

type BoardState = {
  pages: BoardPage[];
  selectedPageId: string;
  comments?: BoardComment[];
  versions?: BoardVersion[];
};

type BoardVersion = {
  id: string;
  label: string;
  createdAt: string;
  createdBy?: string | null;
  state: BoardState;
};

type BoardPatch =
  | { kind: "select-page"; pageId: string }
  | { kind: "upsert-page"; page: BoardPage; afterPageId?: string | null }
  | { kind: "patch-page"; pageId: string; patch: Partial<Omit<BoardPage, "id" | "elements">> }
  | { kind: "upsert-layer"; pageId: string; layer: BoardElement }
  | { kind: "patch-layer"; pageId: string; layerId: string; patch: Partial<BoardElement> }
  | { kind: "delete-layer"; pageId: string; layerId: string }
  | { kind: "upsert-comment"; comment: BoardComment }
  | { kind: "delete-comment"; commentId: string }
  | {
      kind: "bulk-patch-layers";
      pageId: string;
      patches: Array<{ layerId: string; patch: Partial<BoardElement> }>;
    }
  | { kind: "restore-state"; state: BoardState };

type BoardRealtimeMessage = {
  patch: BoardPatch;
  clientId: string;
  userId?: string | null;
  sentAt: number;
};

type ActiveBoardUser = {
  clientId: string;
  userId?: string | null;
  name: string;
  email?: string | null;
  color: string;
  selectedPageId?: string | null;
  selectedLayerId?: string | null;
  selectedAt?: string | null;
  onlineAt: string;
};

type SendMaterialResult =
  | {
      status: "sent";
      materialItemId: string | null;
      productId: string | null;
      roomId: string;
      quantity: number;
    }
  | { status: "skipped" };

type BoardMaterialTrayItem = MaterialItem & {
  room?: Room | null;
};

type DragMode =
  | {
      kind: "move";
      pageId: string;
      id?: string;
      startX: number;
      startY: number;
      originalPositions: Record<string, { x: number; y: number }>;
    }
  | {
      kind: "resize";
      pageId: string;
      id: string;
      startX: number;
      startY: number;
      originalWidth: number;
      originalHeight: number;
    }
  | {
      kind: "resize-group";
      pageId: string;
      startX: number;
      startY: number;
      originalBounds: BoardRect;
      originalElements: Record<string, BoardRect>;
    }
  | null;

type BoardRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SelectionMarquee = {
  pageId: string;
  boardLeft: number;
  boardTop: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
} | null;

type ImageVariantKind = "thumbnail" | "preview" | "original";

type OptimizedBoardImageProps = {
  src: string;
  alt: string;
  kind: ImageVariantKind;
  className?: string;
  draggable?: boolean;
  loading?: "eager" | "lazy";
};

const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const MAIN_PAGE_GAP = 40;
const ACTIVE_PAGE_PRELOAD_RADIUS = 1;
const PAGE_STRIP_VIRTUALIZE_AFTER = 40;
const PAGE_THUMBNAIL_SLOT_WIDTH = 124;
const PAGE_THUMBNAIL_OVERSCAN = 4;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.25;
const AUTOSAVE_DELAY_MS = 700;
const VERSION_SNAPSHOT_INTERVAL_MS = 45_000;
const REMOTE_SELECTION_STALE_MS = 1500;
const BOARD_FONT_OPTIONS = [
  { label: "Montserrat", value: "var(--font-montserrat)" },
  { label: "Cormorant", value: "var(--font-display)" },
  { label: "Inter", value: "var(--font-sans)" },
  { label: "Georgia", value: 'Georgia, "Times New Roman", serif' },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
];
const DEFAULT_BOARD_TEXT_FONT = BOARD_FONT_OPTIONS[0].value;
const DEFAULT_BOARD_TEXT_COLOR = "#000000";
const BOARD_TEXT_COLOR_OPTIONS = [
  { label: "Black", value: "#000000" },
  { label: "White", value: "#ffffff" },
  { label: "Red", value: "#dc2626" },
  { label: "Blue", value: "#2563eb" },
];
const NARROW_BOARD_CATALOG_CATEGORIES = new Set<ItemCategory>([
  "Accent Mirrors",
  "Accessories",
  "Cabinetry & Hardware",
  "Doors Base & Case",
  "Tile & Stone",
  "Wall Coverings",
]);

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function productMatchesBoardCatalogCategory(product: Product, category: ItemCategory) {
  const productCategory = toProductCategory(category);
  if (product.category !== productCategory) return false;

  if (!NARROW_BOARD_CATALOG_CATEGORIES.has(category)) return true;

  const inferredCategory = inferMaterialCategory(
    [
      product.name,
      product.subcategory,
      product.vendor,
      product.finish,
      product.sku,
      product.notes,
      product.product_url,
    ]
      .filter(Boolean)
      .join(" "),
    product.product_url,
  );
  return inferredCategory === category;
}

function materialItemHasBoardTraySignal(item: MaterialItem) {
  return Boolean(
    !item.not_needed &&
      (!item.is_required ||
        item.product_id ||
        item.product_url?.trim() ||
        item.product?.image_url ||
        item.color?.trim() ||
        item.notes?.trim()),
  );
}

function materialItemMatchesBoardCategory(item: MaterialItem, category: ItemCategory) {
  if (normalizedMaterialItemCategory(item) === category) return true;
  if (item.product && productMatchesBoardCatalogCategory(item.product, category)) return true;
  return inferredMaterialItemCategory(item) === category;
}

function normalizedMaterialItemCategory(item: MaterialItem): ItemCategory {
  const itemCategory = item.category?.trim();
  if (itemCategory && (ALL_CATEGORIES as readonly string[]).includes(itemCategory)) {
    return itemCategory as ItemCategory;
  }
  return inferredMaterialItemCategory(item);
}

function inferredMaterialItemCategory(item: MaterialItem): ItemCategory {
  return inferMaterialCategory(
    [
      item.client_product_name,
      item.item_label,
      item.category,
      item.color,
      item.notes,
      item.product_url,
      item.product?.name,
      item.product?.subcategory,
      item.product?.vendor,
      item.product?.finish,
      item.product?.product_url,
    ]
      .filter(Boolean)
      .join(" "),
    item.product_url ?? item.product?.product_url,
  );
}

function ProjectDesignBoardsPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const boardStripRef = useRef<HTMLDivElement | null>(null);
  const thumbnailStripRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingPageFocusRef = useRef<string | null>(null);
  const copiedElementsRef = useRef<BoardElement[]>([]);
  const undoStackRef = useRef<BoardState[]>([]);
  const hasCustomZoomRef = useRef(false);
  const scrollSelectionRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const broadcastThrottleRef = useRef<Record<string, number>>({});
  const remoteLoadedRef = useRef(false);
  const boardStateRef = useRef<BoardState>(defaultBoardState());
  const lastGoodBoardStateRef = useRef<BoardState>(boardStateRef.current);
  const lastSavedJsonRef = useRef("");
  const lastRemoteUpdatedAtRef = useRef("");
  const lastVersionAtRef = useRef(0);
  const pendingSaveJsonRef = useRef<string | null>(null);
  const localEditShieldUntilRef = useRef(0);
  const removingBackgroundRef = useRef(false);
  const applyingRemoteRef = useRef(false);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const clientIdRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
  );
  const [boardState, setBoardState] = useState<BoardState>(() => boardStateRef.current);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [toolsPinned, setToolsPinned] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentTagIds, setCommentTagIds] = useState<string[]>([]);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee>(null);
  const [boardScale, setBoardScale] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ItemCategory | "All">("All");
  const [removingBackground, setRemovingBackground] = useState(false);
  const [sendingMaterialId, setSendingMaterialId] = useState<string | null>(null);
  const [bulkMaterialScope, setBulkMaterialScope] = useState<"page" | "board" | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveBoardUser[]>([]);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [saveStatus, setSaveStatus] = useState<
    "local" | "loading" | "ready" | "saving" | "saved" | "error"
  >("loading");
  const [thumbnailViewport, setThumbnailViewport] = useState({ scrollLeft: 0, width: 0 });

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const canEditDesignBoards =
    profile?.is_active === true && (profile.role === "Admin" || profile.role === "Employee");
  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.getProject(id),
  });
  const {
    data: sharedBoard,
    isLoading: loadingSharedBoard,
    refetch: refetchSharedBoard,
  } = useQuery({
    queryKey: ["designBoard", id],
    queryFn: () => db.getDesignBoard(id),
    enabled: canEditDesignBoards,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms", id],
    queryFn: async () => (await db.listRooms(id)) ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["catalog", search],
    queryFn: async () => (await db.listCatalog(search)) ?? [],
  });
  const { data: roomImages = [] } = useQuery({
    queryKey: ["projectImages", id],
    queryFn: async () => (await db.listProjectRoomImages(id)) ?? [],
  });
  const { data: materialItems = [] } = useQuery({
    queryKey: ["materialItems", id],
    queryFn: async () => (await db.listMaterialItemsByProject(id)) ?? [],
    enabled: canEditDesignBoards,
  });
  const { data: taggableUsers = [] } = useQuery({
    queryKey: ["designBoardTaggableUsers"],
    queryFn: async () =>
      ((
        await supabase
          .from("user_profiles")
          .select("*")
          .in("role", ["Admin", "Employee"])
          .eq("is_active", true)
          .order("full_name")
      ).data ?? []) as UserProfile[],
    enabled: canEditDesignBoards,
  });

  const pages = boardState.pages.length ? boardState.pages : defaultPages();
  const comments = boardState.comments ?? [];
  const selectedPageId = pages.some((page) => page.id === boardState.selectedPageId)
    ? boardState.selectedPageId
    : pages[0].id;
  const selectedPageIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === selectedPageId),
  );
  const activePage = pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const editablePageIds = useMemo(() => {
    const ids = new Set<string>();
    for (
      let index = Math.max(0, selectedPageIndex - ACTIVE_PAGE_PRELOAD_RADIUS);
      index <= Math.min(pages.length - 1, selectedPageIndex + ACTIVE_PAGE_PRELOAD_RADIUS);
      index += 1
    ) {
      ids.add(pages[index].id);
    }
    return ids;
  }, [pages, selectedPageIndex]);
  const virtualizeThumbnails = pages.length > PAGE_STRIP_VIRTUALIZE_AFTER;
  const thumbnailWindow = useMemo(() => {
    if (!virtualizeThumbnails) {
      return { start: 0, end: pages.length, before: 0, after: 0 };
    }
    const viewportWidth = thumbnailViewport.width || 900;
    const visibleStart = Math.floor(thumbnailViewport.scrollLeft / PAGE_THUMBNAIL_SLOT_WIDTH);
    const visibleEnd = Math.ceil(
      (thumbnailViewport.scrollLeft + viewportWidth) / PAGE_THUMBNAIL_SLOT_WIDTH,
    );
    const start = clampNumber(visibleStart - PAGE_THUMBNAIL_OVERSCAN, 0, pages.length);
    const end = clampNumber(visibleEnd + PAGE_THUMBNAIL_OVERSCAN, start, pages.length);
    return {
      start,
      end,
      before: start * PAGE_THUMBNAIL_SLOT_WIDTH,
      after: (pages.length - end) * PAGE_THUMBNAIL_SLOT_WIDTH,
    };
  }, [pages.length, thumbnailViewport.scrollLeft, thumbnailViewport.width, virtualizeThumbnails]);
  const elements = activePage.elements;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedElements = useMemo(
    () => elements.filter((element) => selectedIdSet.has(element.id)),
    [elements, selectedIdSet],
  );
  const selected =
    elements.find((element) => element.id === selectedId) ?? selectedElements[0] ?? null;
  const commentTarget = selected
    ? {
        targetType: "element" as const,
        targetId: selected.id,
        pageId: selectedPageId,
        label:
          selected.type === "text"
            ? "Selected text box"
            : selected.label || selected.productName || "Selected item",
      }
    : {
        targetType: "page" as const,
        targetId: activePage.id,
        pageId: activePage.id,
        label: "Select an item or text box",
      };
  const activePageComments = comments.filter((comment) => comment.pageId === activePage.id);
  const selectedTargetComments = selected
    ? comments.filter(
        (comment) => comment.targetType === "element" && comment.targetId === selected.id,
      )
    : [];
  const commentCountsByElement = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of comments) {
      if (comment.targetType !== "element") continue;
      const key = `${comment.pageId}:${comment.targetId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [comments]);
  const selectedBounds = useMemo(() => getElementsBounds(selectedElements), [selectedElements]);
  const selectedCount = selectedElements.length;
  const orderedElements = useMemo(
    () => [...elements].sort((a, b) => a.zIndex - b.zIndex),
    [elements],
  );
  const filteredProducts = useMemo(
    () =>
      category === "All"
        ? products
        : products.filter((product) => productMatchesBoardCatalogCategory(product, category)),
    [category, products],
  );
  const roomById = useMemo(
    () => new Map(rooms.map((room) => [room.id, room] as const)),
    [rooms],
  );
  const filteredProjectMaterials = useMemo(
    () =>
      materialItems
        .filter((item) => materialItemHasBoardTraySignal(item))
        .filter((item) => category === "All" || materialItemMatchesBoardCategory(item, category))
        .filter((item) => {
          const q = search.trim().toLowerCase();
          if (!q) return true;
          const room = roomById.get(item.room_id);
          return [
            item.item_label,
            item.client_product_name,
            item.category,
            item.color,
            item.notes,
            item.product_url,
            item.product?.name,
            item.product?.vendor,
            item.product?.finish,
            room?.name,
          ]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(q));
        })
        .map((item) => ({ ...item, room: roomById.get(item.room_id) ?? null })),
    [category, materialItems, roomById, search],
  );
  const linkedProductCount = elements.filter((element) => element.productId).length;
  const imageElements = elements.filter((element) => element.type === "image");
  const resolveMaterialRoom = useCallback(
    (element: BoardElement, page: BoardPage) => {
      const assignedRoomId = element.materialRoomId || page.roomId;
      if (assignedRoomId) {
        return rooms.find((candidate) => candidate.id === assignedRoomId) ?? null;
      }
      return inferRoomFromPageTitle(page.title, rooms);
    },
    [rooms],
  );
  const imageMaterialReadinessIssues = useCallback(
    (element: BoardElement, page: BoardPage) => {
      const issues = imageMaterialIssues(element);
      if (
        element.type === "image" &&
        !element.materialInfoNotNeeded &&
        !resolveMaterialRoom(element, page)
      ) {
        issues.push("room");
      }
      return issues;
    },
    [resolveMaterialRoom],
  );
  const activePageMissingInfoCount = imageElements.filter(
    (element) => imageMaterialReadinessIssues(element, activePage).length,
  ).length;
  const boardMissingInfoCount = pages.reduce(
    (total, page) =>
      total +
      page.elements.filter(
        (element) => element.type === "image" && imageMaterialReadinessIssues(element, page).length,
      ).length,
    0,
  );
  const allBoardDetailsHidden =
    imageElements.length > 0 && imageElements.every((element) => element.hideDetails);
  const onlineUsers = useMemo(() => {
    const usersByIdentity = new Map<string, ActiveBoardUser>();
    for (const user of activeUsers) {
      const identity = user.userId || user.email || user.name || user.clientId;
      if (!usersByIdentity.has(identity)) usersByIdentity.set(identity, user);
    }
    return Array.from(usersByIdentity.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [activeUsers]);
  const remoteSelections = useMemo(() => {
    const selections = new Map<string, ActiveBoardUser[]>();
    for (const user of activeUsers) {
      if (!user.selectedLayerId || !user.selectedPageId) continue;
      const selectedAt = user.selectedAt ? new Date(user.selectedAt).getTime() : 0;
      if (!selectedAt || presenceNow - selectedAt > REMOTE_SELECTION_STALE_MS) continue;
      const key = `${user.selectedPageId}:${user.selectedLayerId}`;
      selections.set(key, [...(selections.get(key) ?? []), user]);
    }
    return selections;
  }, [activeUsers, presenceNow]);

  const pushUndo = useCallback(() => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), cloneBoardState(boardState)];
  }, [boardState]);

  const markRemoteBoardApplied = (remoteJson: string, updatedAt?: string | null) => {
    lastSavedJsonRef.current = remoteJson;
    if (updatedAt) lastRemoteUpdatedAtRef.current = updatedAt;
  };

  const applySharedBoardSnapshot = useCallback(
    (
      remoteBoard: NonNullable<typeof sharedBoard>,
      _message?: string,
      options?: { preserveSelectedPage?: boolean },
    ) => {
      const normalizedRemoteState = normalizeBoardState(remoteBoard.board_state);
      const currentSelectedPageId = boardStateRef.current.selectedPageId;
      const remoteState = options?.preserveSelectedPage
        ? preserveBoardSelectedPage(normalizedRemoteState, currentSelectedPageId)
        : openBoardStateOnFirstPage(normalizedRemoteState);
      const remoteJson = JSON.stringify(prepareBoardStateForSave(remoteState));
      applyingRemoteRef.current = true;
      boardStateRef.current = remoteState;
      lastGoodBoardStateRef.current = remoteState;
      setBoardState(remoteState);
      markRemoteBoardApplied(remoteJson, remoteBoard.updated_at);
      pendingSaveJsonRef.current = null;
      remoteLoadedRef.current = true;
      queryClient.setQueryData(["designBoard", id], remoteBoard);
      setSaveStatus("ready");
    },
    [id, queryClient],
  );

  const saveBoardStateSafely = useCallback(
    async (state: BoardState) => {
      const stateToSave = prepareBoardStateForSave(state);
      const expectedUpdatedAt = lastRemoteUpdatedAtRef.current;
      const saveJson = JSON.stringify(stateToSave);

      if (!expectedUpdatedAt) {
        const latestBoard = await db.getDesignBoard(id);
        if (latestBoard?.updated_at) {
          const savedBoard = await db.updateDesignBoardIfFresh(
            id,
            stateToSave,
            latestBoard.updated_at,
            profile?.id,
          );
          if (savedBoard?.updated_at) {
            lastRemoteUpdatedAtRef.current = savedBoard.updated_at;
            return { savedBoard, savedJson: saveJson, savedState: stateToSave };
          }
        }

        try {
          const savedBoard = await db.insertDesignBoard(id, stateToSave, profile?.id);
          if (savedBoard?.updated_at) lastRemoteUpdatedAtRef.current = savedBoard.updated_at;
          return { savedBoard, savedJson: saveJson, savedState: stateToSave };
        } catch {
          const newestBoard = await db.getDesignBoard(id);
          if (newestBoard?.updated_at) {
            const savedBoard = await db.updateDesignBoardIfFresh(
              id,
              stateToSave,
              newestBoard.updated_at,
              profile?.id,
            );
            if (savedBoard?.updated_at) {
              lastRemoteUpdatedAtRef.current = savedBoard.updated_at;
              return { savedBoard, savedJson: saveJson, savedState: stateToSave };
            }
          }
          throw new Error("Design board save failed");
        }
      }

      const savedBoard = await db.updateDesignBoardIfFresh(
        id,
        stateToSave,
        expectedUpdatedAt,
        profile?.id,
      );
      if (savedBoard?.updated_at) {
        lastRemoteUpdatedAtRef.current = savedBoard.updated_at;
        return { savedBoard, savedJson: saveJson, savedState: stateToSave };
      }

      const latestBoard = await db.getDesignBoard(id);
      if (latestBoard?.board_state) {
        const latestJson = JSON.stringify(prepareBoardStateForSave(latestBoard.board_state));
        if (latestJson === saveJson) {
          markRemoteBoardApplied(saveJson, latestBoard.updated_at);
          return { savedBoard: latestBoard, savedJson: saveJson, savedState: stateToSave };
        }
      }

      if (latestBoard?.updated_at) {
        const retrySavedBoard = await db.updateDesignBoardIfFresh(
          id,
          stateToSave,
          latestBoard.updated_at,
          profile?.id,
        );
        if (retrySavedBoard?.updated_at) {
          lastRemoteUpdatedAtRef.current = retrySavedBoard.updated_at;
          return { savedBoard: retrySavedBoard, savedJson: saveJson, savedState: stateToSave };
        }
      }
      throw new Error("Design board save failed");
    },
    [applySharedBoardSnapshot, id, profile?.id],
  );

  const applyLocalBoardUpdate = useCallback(
    (updater: BoardState | ((current: BoardState) => BoardState)) => {
      if (canEditDesignBoards && !remoteLoadedRef.current) {
        setSaveStatus("loading");
        return;
      }
      localEditShieldUntilRef.current = Date.now() + 2500;
      setBoardState((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        const normalized = normalizeBoardState(next);
        boardStateRef.current = normalized;
        return normalized;
      });
    },
    [canEditDesignBoards],
  );

  const saveBoardStateImmediately = useCallback(
    async (state: BoardState) => {
      if (!canEditDesignBoards) return;
      const stateToSave = prepareBoardStateForSave(state);
      const saveJson = JSON.stringify(stateToSave);
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
      pendingSaveJsonRef.current = saveJson;
      setSaveStatus("saving");
      try {
        const { savedState, savedJson } = await saveBoardStateSafely(stateToSave);
        pendingSaveJsonRef.current = null;
        lastSavedJsonRef.current = savedJson;
        lastGoodBoardStateRef.current = savedState;
        setSaveStatus("saved");
      } catch {
        pendingSaveJsonRef.current = null;
        setSaveStatus("error");
      }
    },
    [canEditDesignBoards, saveBoardStateSafely],
  );

  const undoLastChange = useCallback(() => {
    const previous = undoStackRef.current.at(-1);
    if (!previous) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    applyLocalBoardUpdate(previous);
    setSelectedId(null);
    setSelectedIds([]);
    setDragMode(null);
  }, [applyLocalBoardUpdate]);

  const applyRemotePatch = useCallback((patch: BoardPatch) => {
    applyingRemoteRef.current = true;
    setBoardState((current) => {
      const next = applyBoardPatchToState(current, patch);
      boardStateRef.current = next;
      return next;
    });
  }, []);

  const broadcastPatch = useCallback(
    (patch: BoardPatch, throttleKey?: string) => {
      const channel = realtimeChannelRef.current;
      if (!channel || !canEditDesignBoards) return;
      if (throttleKey) {
        const now = Date.now();
        if ((broadcastThrottleRef.current[throttleKey] ?? 0) > now - 45) return;
        broadcastThrottleRef.current[throttleKey] = now;
      }
      const payload: BoardRealtimeMessage = {
        patch,
        clientId: clientIdRef.current,
        userId: profile?.id ?? null,
        sentAt: Date.now(),
      };
      void channel.send({ type: "broadcast", event: "board-patch", payload });
    },
    [canEditDesignBoards, profile?.id],
  );

  const broadcastElementDiff = useCallback(
    (pageId: string, before: BoardElement[], after: BoardElement[]) => {
      if (applyingRemoteRef.current) return;
      const patches = diffBoardElements(before, after);
      for (const patch of patches) {
        const realtimePatch = { ...patch, pageId } as BoardPatch;
        const throttleKey =
          patch.kind === "patch-layer" &&
          ("x" in patch.patch ||
            "y" in patch.patch ||
            "width" in patch.patch ||
            "height" in patch.patch)
            ? `${pageId}:${patch.layerId}:geometry`
            : undefined;
        broadcastPatch(realtimePatch, throttleKey);
      }
    },
    [broadcastPatch],
  );

  const setElementsForPage = useCallback(
    (pageId: string, updater: BoardElement[] | ((current: BoardElement[]) => BoardElement[])) => {
      applyLocalBoardUpdate((current) => {
        const safePages = current.pages.length ? current.pages : defaultPages();
        const safeSelectedPageId = safePages.some((page) => page.id === current.selectedPageId)
          ? current.selectedPageId
          : safePages[0].id;
        const currentPage = safePages.find((page) => page.id === pageId);
        const beforeElements = currentPage?.elements ?? [];
        const afterElements = typeof updater === "function" ? updater(beforeElements) : updater;
        if (!applyingRemoteRef.current) broadcastElementDiff(pageId, beforeElements, afterElements);
        return {
          ...current,
          selectedPageId: safeSelectedPageId,
          pages: safePages.map((page) =>
            page.id === pageId ? { ...page, elements: afterElements } : page,
          ),
        };
      });
    },
    [applyLocalBoardUpdate, broadcastElementDiff],
  );

  const setElements = useCallback(
    (updater: BoardElement[] | ((current: BoardElement[]) => BoardElement[])) => {
      setElementsForPage(selectedPageId, updater);
    },
    [selectedPageId, setElementsForPage],
  );

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setSelectedIds([]);
  }, []);

  const selectOnly = useCallback((elementId: string | null) => {
    setSelectedId(elementId);
    setSelectedIds(elementId ? [elementId] : []);
  }, []);

  const selectMany = useCallback((elementIds: string[], primaryId = elementIds[0] ?? null) => {
    const uniqueIds = Array.from(new Set(elementIds));
    setSelectedIds(uniqueIds);
    setSelectedId(primaryId && uniqueIds.includes(primaryId) ? primaryId : (uniqueIds[0] ?? null));
  }, []);

  const toggleSelectedElement = useCallback((elementId: string) => {
    setSelectedIds((current) => {
      const next = current.includes(elementId)
        ? current.filter((id) => id !== elementId)
        : [...current, elementId];
      setSelectedId(next.includes(elementId) ? elementId : (next[0] ?? null));
      return next;
    });
  }, []);

  useEffect(() => {
    const emptyState = defaultBoardState();
    if (typeof window !== "undefined") window.localStorage.removeItem(storageKey(id));
    boardStateRef.current = emptyState;
    setBoardState(emptyState);
    setSelectedId(null);
    setSelectedIds([]);
    setCommentDraft("");
    setCommentTagIds([]);
    setToolsPinned(false);
    setSelectionMarquee(null);
    undoStackRef.current = [];
    remoteLoadedRef.current = false;
    lastSavedJsonRef.current = "";
    lastRemoteUpdatedAtRef.current = "";
    pendingSaveJsonRef.current = null;
    localEditShieldUntilRef.current = 0;
    removingBackgroundRef.current = false;
    applyingRemoteRef.current = false;
    lastGoodBoardStateRef.current = emptyState;
    lastVersionAtRef.current = 0;
    setActiveUsers([]);
    setSaveStatus("loading");
  }, [id]);

  useEffect(() => {
    if (!canEditDesignBoards || loadingProfile || !profile?.id) return;
    const channel = supabase.channel(`design-board:${id}`, {
      config: {
        broadcast: { self: false },
        presence: { key: clientIdRef.current },
      },
    });

    realtimeChannelRef.current = channel;

    channel
      .on("broadcast", { event: "board-patch" }, ({ payload }) => {
        const message = payload as BoardRealtimeMessage;
        if (!message?.patch || message.clientId === clientIdRef.current) return;
        applyRemotePatch(message.patch);
      })
      .on("presence", { event: "sync" }, () => {
        const presenceState = channel.presenceState<ActiveBoardUser>();
        const users = Object.values(presenceState)
          .flat()
          .filter((user) => user.clientId !== clientIdRef.current)
          .sort((a, b) => a.name.localeCompare(b.name));
        setActiveUsers(users);
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        await channel.track({
          clientId: clientIdRef.current,
          userId: profile.id,
          name: profile.full_name || profile.email || "MERAV teammate",
          email: profile.email,
          color: userPresenceColor(profile.id),
          selectedPageId: null,
          selectedLayerId: null,
          selectedAt: null,
          onlineAt: new Date().toISOString(),
        } satisfies ActiveBoardUser);
      });

    return () => {
      realtimeChannelRef.current = null;
      setActiveUsers([]);
      void supabase.removeChannel(channel);
    };
  }, [
    applyRemotePatch,
    canEditDesignBoards,
    id,
    loadingProfile,
    profile?.email,
    profile?.full_name,
    profile?.id,
  ]);

  useEffect(() => {
    const channel = realtimeChannelRef.current;
    if (!channel || !canEditDesignBoards || !profile?.id) return;
    const now = new Date().toISOString();
    void channel.track({
      clientId: clientIdRef.current,
      userId: profile.id,
      name: profile.full_name || profile.email || "MERAV teammate",
      email: profile.email,
      color: userPresenceColor(profile.id),
      selectedPageId,
      selectedLayerId: selectedId,
      selectedAt: selectedId ? now : null,
      onlineAt: now,
    } satisfies ActiveBoardUser);
  }, [
    canEditDesignBoards,
    profile?.email,
    profile?.full_name,
    profile?.id,
    selectedId,
    selectedPageId,
  ]);

  useEffect(() => {
    if (!activeUsers.some((user) => user.selectedLayerId)) return;
    const timer = window.setInterval(() => setPresenceNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [activeUsers]);

  useEffect(() => {
    if (!canEditDesignBoards || loadingProfile) return;

    const refetchLatestBoard = () => {
      if (pendingSaveJsonRef.current) return;
      setSaveStatus("loading");
      void queryClient.invalidateQueries({ queryKey: ["designBoard", id] });
      void refetchSharedBoard();
    };

    refetchLatestBoard();

    const handlePageActive = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      refetchLatestBoard();
    };

    window.addEventListener("focus", handlePageActive);
    window.addEventListener("pageshow", handlePageActive);
    document.addEventListener("visibilitychange", handlePageActive);

    return () => {
      window.removeEventListener("focus", handlePageActive);
      window.removeEventListener("pageshow", handlePageActive);
      document.removeEventListener("visibilitychange", handlePageActive);
    };
  }, [canEditDesignBoards, id, loadingProfile, queryClient, refetchSharedBoard]);

  useEffect(() => {
    boardStateRef.current = boardState;
  }, [boardState]);

  useEffect(() => {
    if (loadingProfile || loadingSharedBoard) return;
    if (!canEditDesignBoards) {
      remoteLoadedRef.current = false;
      setSaveStatus("local");
      return;
    }
    if (sharedBoard?.board_state) {
      const remoteUpdatedAt = sharedBoard.updated_at ?? "";
      const hasNewerRemoteBoard =
        !remoteLoadedRef.current || remoteUpdatedAt !== lastRemoteUpdatedAtRef.current;
      if (hasNewerRemoteBoard) {
        applySharedBoardSnapshot(sharedBoard, undefined, {
          preserveSelectedPage: remoteLoadedRef.current,
        });
      }
      else setSaveStatus((current) => (current === "loading" ? "ready" : current));
      return;
    }

    if (remoteLoadedRef.current) return;

    const emptyState = defaultBoardState();
    const emptyJson = JSON.stringify(emptyState);
    applyingRemoteRef.current = true;
    boardStateRef.current = emptyState;
    lastGoodBoardStateRef.current = emptyState;
    setBoardState(emptyState);
    remoteLoadedRef.current = true;
    lastSavedJsonRef.current = emptyJson;
    pendingSaveJsonRef.current = null;
    setSaveStatus("ready");
  }, [
    applySharedBoardSnapshot,
    canEditDesignBoards,
    loadingProfile,
    loadingSharedBoard,
    sharedBoard,
  ]);

  useEffect(() => {
    if (!canEditDesignBoards || !remoteLoadedRef.current) return;
    if (applyingRemoteRef.current) {
      applyingRemoteRef.current = false;
      return;
    }

    const nextJson = JSON.stringify(prepareBoardStateForSave(boardState));
    if (nextJson === lastSavedJsonRef.current) return;
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    pendingSaveJsonRef.current = nextJson;
    setSaveStatus("saving");
    saveTimeoutRef.current = window.setTimeout(() => {
      let latestState = boardStateRef.current;
      const now = Date.now();
      if (
        hasMeaningfulBoardState(latestState) &&
        now - lastVersionAtRef.current > VERSION_SNAPSHOT_INTERVAL_MS
      ) {
        latestState = addBoardVersion(
          latestState,
          profile?.full_name || profile?.email || "MERAV teammate",
          profile?.id,
        );
        lastVersionAtRef.current = now;
        boardStateRef.current = latestState;
        setBoardState(latestState);
      }
      const latestJson = JSON.stringify(prepareBoardStateForSave(latestState));
      pendingSaveJsonRef.current = latestJson;
      void saveBoardStateSafely(latestState).then(
        ({ savedState, savedJson }) => {
          pendingSaveJsonRef.current = null;
          lastSavedJsonRef.current = savedJson;
          lastGoodBoardStateRef.current = savedState;
          setSaveStatus("saved");
        },
        () => {
          pendingSaveJsonRef.current = null;
          setSaveStatus("error");
        },
      );
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [
    boardState,
    canEditDesignBoards,
    profile?.email,
    profile?.full_name,
    profile?.id,
    saveBoardStateSafely,
  ]);

  useEffect(() => {
    const updateScale = () => {
      const width = boardStripRef.current?.clientWidth ?? BOARD_WIDTH;
      if (!hasCustomZoomRef.current)
        setBoardScale(Math.min(1, Math.max(MIN_ZOOM, (width - 24) / BOARD_WIDTH)));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (selectionMarquee) {
        setSelectionMarquee((current) =>
          current
            ? {
                ...current,
                currentX: clamp((event.clientX - current.boardLeft) / boardScale, 0, BOARD_WIDTH),
                currentY: clamp((event.clientY - current.boardTop) / boardScale, 0, BOARD_HEIGHT),
              }
            : current,
        );
        return;
      }
      if (!dragMode) return;
      const dx = (event.clientX - dragMode.startX) / boardScale;
      const dy = (event.clientY - dragMode.startY) / boardScale;
      setElementsForPage(dragMode.pageId, (current) =>
        current.map((element) => {
          if (dragMode.kind === "move") {
            const original = dragMode.originalPositions[element.id];
            if (!original) return element;
            return {
              ...element,
              x: clamp(original.x + dx, -element.width + 40, BOARD_WIDTH - 40),
              y: clamp(original.y + dy, -element.height + 40, BOARD_HEIGHT - 40),
            };
          }
          if (dragMode.kind === "resize-group") {
            const original = dragMode.originalElements[element.id];
            if (!original) return element;
            const nextWidth = Math.max(40, dragMode.originalBounds.width + dx);
            const nextHeight = Math.max(40, dragMode.originalBounds.height + dy);
            const scaleX = nextWidth / Math.max(1, dragMode.originalBounds.width);
            const scaleY = nextHeight / Math.max(1, dragMode.originalBounds.height);
            return {
              ...element,
              x: dragMode.originalBounds.x + (original.x - dragMode.originalBounds.x) * scaleX,
              y: dragMode.originalBounds.y + (original.y - dragMode.originalBounds.y) * scaleY,
              width: Math.max(20, original.width * scaleX),
              height: Math.max(20, original.height * scaleY),
            };
          }
          if (element.id !== dragMode.id) return element;
          return {
            ...element,
            width: Math.max(40, dragMode.originalWidth + dx),
            height: Math.max(40, dragMode.originalHeight + dy),
          };
        }),
      );
    };
    const onPointerUp = () => {
      if (selectionMarquee) {
        const marqueeRect = rectFromPoints(
          selectionMarquee.startX,
          selectionMarquee.startY,
          selectionMarquee.currentX,
          selectionMarquee.currentY,
        );
        const selectedFromBox = elements
          .filter((element) => rectsIntersect(elementToRect(element), marqueeRect))
          .map((element) => element.id);
        selectMany(selectedFromBox);
        setSelectionMarquee(null);
      }
      setDragMode(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [boardScale, dragMode, elements, selectMany, selectionMarquee, setElementsForPage]);

  const updateElement = (
    elementId: string,
    patch: Partial<BoardElement>,
    pageId = selectedPageId,
  ) => {
    pushUndo();
    setElementsForPage(pageId, (current) =>
      current.map((element) => (element.id === elementId ? { ...element, ...patch } : element)),
    );
  };

  const sendElementToMaterials = async (
    element: BoardElement,
    page: BoardPage,
    sortOrderOverride?: number,
    quantityOverride?: number,
  ): Promise<SendMaterialResult> => {
    if (element.type !== "image") return { status: "skipped" };
    if (element.materialInfoNotNeeded) return { status: "skipped" };
    const room = resolveMaterialRoom(element, page);
    if (!room) {
      return { status: "skipped" };
    }

    const missingInfo = imageMaterialIssues(element);
    if (missingInfo.length) {
      return { status: "skipped" };
    }
    const itemLabel = imageMaterialLabel(element);

    const linkedProduct = element.productId
      ? products.find((product) => product.id === element.productId)
      : null;
    const productUrl = element.link?.trim() ? normalizeExternalUrl(element.link) : null;
    const linkedProductUrl = linkedProduct?.product_url
      ? normalizeExternalUrl(linkedProduct.product_url)
      : null;
    const inferredMaterialCategory = inferMaterialCategory(itemLabel, productUrl);
    const materialCategory = element.materialCategory || inferredMaterialCategory;
    let category: ProductCategory =
      linkedProduct?.category || toProductCategory(element.materialCategory || inferredMaterialCategory);
    const finish = element.materialFinish || element.finish || null;
    const quantity =
      quantityOverride && quantityOverride > 0
        ? quantityOverride
        : element.materialQuantity && element.materialQuantity > 0
          ? element.materialQuantity
          : 1;

    let product =
      linkedProduct && (!productUrl || !linkedProductUrl || linkedProductUrl === productUrl)
        ? linkedProduct
        : null;
    if (productUrl && (!product || linkedProductUrl !== productUrl)) {
      product = await db.findProductByUrl(productUrl);
    }
    if (!product) {
      product = await db.createProduct({
        name: itemLabel,
        category,
        product_url: productUrl,
        image_url: element.src || null,
        finish,
        notes: element.notes || null,
      });
    } else {
      category = product.category || category;
      const productPatch: Partial<Product> = {};
      if (!product.image_url && element.src) productPatch.image_url = element.src;
      if (!product.product_url && productUrl) productPatch.product_url = productUrl;
      if (!product.finish && finish) productPatch.finish = finish;
      if (Object.keys(productPatch).length) {
        product = await db.updateProduct(product.id, productPatch);
      }
    }
    if (!product) throw new Error("Could not create catalog product.");

    const matchingMaterial = materialItems.find((item) => {
      if (item.room_id !== room.id) return false;
      if (element.materialItemId && item.id === element.materialItemId) return true;
      if (item.product_id && item.product_id === product.id) return true;
      if (productUrl && item.product_url && normalizeExternalUrl(item.product_url) === productUrl) {
        return true;
      }
      return (
        item.item_label.trim().toLowerCase() === itemLabel.toLowerCase() &&
        item.category?.toLowerCase() === materialCategory.toLowerCase()
      );
    });
    const existingMaterialId = element.materialItemId || matchingMaterial?.id || null;
    const existingMaterial = existingMaterialId
      ? materialItems.find((item) => item.id === existingMaterialId) || matchingMaterial || null
      : null;
    const sortOrder =
      existingMaterial?.sort_order ??
      sortOrderOverride ??
      Math.max(
        0,
        ...materialItems.filter((item) => item.room_id === room.id).map((item) => item.sort_order),
      ) + 1;
    const materialPatch: Omit<MaterialItem, "id" | "created_at" | "updated_at" | "product"> = {
      room_id: room.id,
      project_id: id,
      item_label: itemLabel,
      client_product_name: buildClientProductName(room.name, itemLabel),
      category: materialCategory,
      is_required: false,
      sort_order: sortOrder,
      cad_label: null,
      product_url: productUrl,
      quantity,
      color: finish,
      notes: element.notes || null,
      not_needed: false,
      product_id: product.id,
      scrape_status: "scraped",
      scrape_error: null,
    };

    let materialItem = existingMaterial ?? null;
    if (existingMaterialId) {
      await db.updateMaterialItem(existingMaterialId, materialPatch);
      materialItem = {
        ...(existingMaterial ?? { id: existingMaterialId }),
        ...materialPatch,
        product,
      } as MaterialItem;
    } else {
      const { data, error } = await supabase
        .from("material_items")
        .insert(materialPatch)
        .select("*, product:products(*)")
        .single();
      if (error) throw error;
      materialItem = data as MaterialItem | null;
    }

    const roomProducts = (await db.listRoomProducts(room.id)) ?? [];
    if (!roomProducts.some((roomProduct) => roomProduct.product_id === product.id)) {
      await db.addRoomProduct({
        room_id: room.id,
        product_id: product.id,
        is_key_selection: false,
      });
    }

    setElementsForPage(page.id, (current) =>
      current.map((candidate) =>
        candidate.id === element.id
          ? {
              ...candidate,
              productId: product.id,
              productName: product.name,
              vendor: product.vendor,
              price: product.price,
              finish: product.finish,
              link: product.product_url || element.link || "",
              materialItemId: materialItem?.id ?? element.materialItemId ?? null,
              materialRoomId: room.id,
              materialCategory: category,
              materialQuantity: quantity,
              materialFinish: finish,
            }
          : candidate,
      ),
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["materialItems", id] }),
      queryClient.invalidateQueries({ queryKey: ["roomProducts", room.id] }),
      queryClient.invalidateQueries({ queryKey: ["catalog"] }),
    ]);
    return {
      status: "sent",
      materialItemId: materialItem?.id ?? element.materialItemId ?? null,
      productId: product.id,
      roomId: room.id,
      quantity,
    };
  };

  const sendSelectedToMaterials = async () => {
    if (!selected || selected.type !== "image") return;
    if (selected.materialInfoNotNeeded) {
      toast.error("This image is marked as not needing material info.");
      return;
    }
    const room = resolveMaterialRoom(selected, activePage);
    if (!room) {
      toast.error("Choose a room before sending this to Materials.");
      return;
    }

    const missingInfo = imageMaterialReadinessIssues(selected, activePage);
    if (missingInfo.length) {
      toast.error(`Add ${joinMissingInfo(missingInfo)} before sending this to Materials.`);
      return;
    }

    setSendingMaterialId(selected.id);
    try {
      await sendElementToMaterials(selected, activePage);
      toast.success(
        selected.materialItemId ? "Updated this material item." : "Sent to project materials.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send this to Materials.");
    } finally {
      setSendingMaterialId(null);
    }
  };

  const sendMaterialsForPages = async (targetPages: BoardPage[], scope: "page" | "board") => {
    setBulkMaterialScope(scope);
    try {
      let sent = 0;
      let skipped = 0;
      const skippedReasons = { label: 0, link: 0, room: 0 };
      const nextSortOrderByRoom = new Map<string, number>();
      const groups = new Map<
        string,
        {
          page: BoardPage;
          primary: BoardElement;
          elements: Array<{ page: BoardPage; element: BoardElement }>;
          quantity: number;
          roomId: string;
        }
      >();

      for (const page of targetPages) {
        for (const element of page.elements) {
          if (element.type !== "image") continue;
          if (element.materialInfoNotNeeded) continue;
          const room = resolveMaterialRoom(element, page);
          const linkedProduct = element.productId
            ? products.find((product) => product.id === element.productId)
            : null;
          const missingInfo = imageMaterialReadinessIssues(element, page);
          if (!room || missingInfo.length) {
            for (const issue of missingInfo) {
              if (issue === "label" || issue === "link" || issue === "room") {
                skippedReasons[issue] += 1;
              }
            }
            skipped += 1;
            continue;
          }
          const itemLabel = imageMaterialLabel(element);
          const productUrl = element.link?.trim() ? normalizeExternalUrl(element.link) : "";
          const category =
            element.materialCategory ||
            linkedProduct?.category ||
            inferMaterialCategory(itemLabel, productUrl);
          const finish = (element.materialFinish || element.finish || "").trim();
          const identity = element.productId || productUrl || element.src || itemLabel;
          const key = [
            room.id,
            identity.trim().toLowerCase(),
            itemLabel.toLowerCase(),
            category.toLowerCase(),
            finish.toLowerCase(),
          ].join("::");
          const quantity =
            element.materialQuantity && element.materialQuantity > 0 ? element.materialQuantity : 1;
          const existing = groups.get(key);
          if (existing) {
            existing.elements.push({ page, element });
            existing.quantity += quantity;
          } else {
            groups.set(key, {
              page,
              primary: element,
              elements: [{ page, element }],
              quantity,
              roomId: room.id,
            });
          }
        }
      }

      for (const group of groups.values()) {
        const primaryMaterialId =
          group.primary.materialItemId ||
          group.elements.find(({ element }) => element.materialItemId)?.element.materialItemId ||
          null;
        const primaryElement = primaryMaterialId
          ? { ...group.primary, materialItemId: primaryMaterialId }
          : { ...group.primary, materialRoomId: group.roomId };
        let sortOrderOverride: number | undefined;
        if (!primaryMaterialId) {
          const nextSortOrder =
            nextSortOrderByRoom.get(group.roomId) ??
            Math.max(
              0,
              ...materialItems
                .filter((item) => item.room_id === group.roomId)
                .map((item) => item.sort_order),
            ) + 1;
          sortOrderOverride = nextSortOrder;
          nextSortOrderByRoom.set(group.roomId, nextSortOrder + 1);
        }
        const result = await sendElementToMaterials(
          primaryElement,
          group.page,
          sortOrderOverride,
          group.quantity,
        );
        if (result.status === "sent") {
          sent += 1;
          const duplicateMaterialIds = Array.from(
            new Set(
              group.elements
                .map(({ element }) => element.materialItemId)
                .filter((materialItemId): materialItemId is string =>
                  Boolean(materialItemId && materialItemId !== result.materialItemId),
                ),
            ),
          );
          for (const materialItemId of duplicateMaterialIds) {
            await db.deleteMaterialItem(materialItemId);
          }
          for (const { page, element } of group.elements) {
            setElementsForPage(page.id, (current) =>
              current.map((candidate) =>
                candidate.id === element.id
                  ? {
                      ...candidate,
                      productId: result.productId,
                      materialItemId: result.materialItemId,
                      materialRoomId: result.roomId,
                      materialQuantity: group.quantity,
                    }
                  : candidate,
              ),
            );
          }
        } else {
          skipped += group.elements.length;
        }
      }
      if (sent) {
        const skippedReasonText = formatSkippedMaterialReasons(skippedReasons);
        toast.success(
          `Synced ${sent} ${sent === 1 ? "item" : "items"} to Materials${
            skipped ? ` and skipped ${skipped}${skippedReasonText}.` : "."
          }`,
        );
      } else {
        const skippedReasonText = formatSkippedMaterialReasons(skippedReasons);
        toast.error(
          `No image items were ready${skippedReasonText}. Add the missing info and try again.`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send materials.");
    } finally {
      setBulkMaterialScope(null);
    }
  };

  const sendCurrentPageToMaterials = () => {
    void sendMaterialsForPages([activePage], "page");
  };

  const sendFullBoardToMaterials = () => {
    void sendMaterialsForPages(pages, "board");
  };

  const toggleBoardDetails = () => {
    const shouldHide = !allBoardDetailsHidden;
    pushUndo();
    setElements((current) =>
      current.map((element) =>
        element.type === "image" ? { ...element, hideDetails: shouldHide } : element,
      ),
    );
  };

  const addComment = () => {
    if (!selected) {
      toast.error("Select an image or text box before adding a comment.");
      return;
    }
    const body = commentDraft.trim();
    if (!body) {
      toast.error("Write a comment first.");
      return;
    }
    const comment: BoardComment = {
      id: crypto.randomUUID(),
      targetType: commentTarget.targetType,
      targetId: commentTarget.targetId,
      pageId: commentTarget.pageId,
      body,
      taggedUserIds: commentTagIds,
      createdById: profile?.id ?? null,
      createdByName: profile?.full_name || profile?.email || "MERAV teammate",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    pushUndo();
    applyLocalBoardUpdate((current) => ({
      ...current,
      comments: [comment, ...(current.comments ?? [])],
    }));
    broadcastPatch({ kind: "upsert-comment", comment });
    setCommentDraft("");
    setCommentTagIds([]);
    toast.success("Comment added.");
  };

  const deleteComment = (commentId: string) => {
    pushUndo();
    applyLocalBoardUpdate((current) => ({
      ...current,
      comments: (current.comments ?? []).filter((comment) => comment.id !== commentId),
    }));
    broadcastPatch({ kind: "delete-comment", commentId });
  };

  const quickCommentElement = (element: BoardElement, pageId: string) => {
    selectPage(pageId, false, false);
    selectOnly(element.id);
    setToolsPinned(true);
  };

  const quickEditElementLabel = (element: BoardElement, pageId: string) => {
    const nextLabel = window.prompt(
      "Label for this item",
      element.label || element.productName || "",
    );
    if (nextLabel === null) return;
    updateElement(element.id, { label: nextLabel.trim() }, pageId);
  };

  const quickEditElementLink = (element: BoardElement, pageId: string) => {
    const nextLink = window.prompt("Product link", element.link || "");
    if (nextLink === null) return;
    updateElement(element.id, { link: nextLink.trim() }, pageId);
  };

  const quickEditElementFinish = (element: BoardElement, pageId: string) => {
    const nextFinish = window.prompt(
      "Color / finish",
      element.materialFinish || element.finish || "",
    );
    if (nextFinish === null) return;
    updateElement(element.id, { materialFinish: nextFinish.trim() }, pageId);
  };

  const quickDeleteElement = (element: BoardElement, pageId: string) => {
    pushUndo();
    setElementsForPage(pageId, (current) =>
      current.filter((candidate) => candidate.id !== element.id),
    );
    const removedCommentIds = comments
      .filter((comment) => comment.targetType === "element" && comment.targetId === element.id)
      .map((comment) => comment.id);
    if (removedCommentIds.length) {
      applyLocalBoardUpdate((current) => ({
        ...current,
        comments: (current.comments ?? []).filter(
          (comment) => !removedCommentIds.includes(comment.id),
        ),
      }));
      removedCommentIds.forEach((commentId) =>
        broadcastPatch({ kind: "delete-comment", commentId }),
      );
    }
    clearSelection();
  };

  const addElement = useCallback(
    (element: Omit<BoardElement, "id" | "zIndex">, pageId = selectedPageId) => {
      const pageElements = pages.find((page) => page.id === pageId)?.elements ?? elements;
      const next: BoardElement = {
        ...element,
        id: crypto.randomUUID(),
        zIndex: nextZIndex(pageElements),
      };
      pushUndo();
      setElementsForPage(pageId, (current) => [...current, next]);
      applyLocalBoardUpdate((current) => ({ ...current, selectedPageId: pageId }));
      selectOnly(next.id);
    },
    [
      applyLocalBoardUpdate,
      elements,
      pages,
      pushUndo,
      selectedPageId,
      selectOnly,
      setElementsForPage,
    ],
  );

  const addPage = (afterPageId = selectedPageId) => {
    const nextPage: BoardPage = {
      id: crypto.randomUUID(),
      title: `Board ${pages.length + 1}`,
      roomId: null,
      elements: [],
    };
    const current = normalizeBoardState(boardStateRef.current);
    const safePages = current.pages.length ? current.pages : defaultPages();
    const insertAfterIndex = safePages.findIndex((page) => page.id === afterPageId);
    const insertAt = insertAfterIndex >= 0 ? insertAfterIndex + 1 : safePages.length;
    const nextState = normalizeBoardState({
      ...current,
      selectedPageId: nextPage.id,
      pages: [
        ...safePages.slice(0, insertAt),
        nextPage,
        ...safePages.slice(insertAt),
      ],
    });
    pushUndo();
    applyLocalBoardUpdate(nextState);
    broadcastPatch({ kind: "upsert-page", page: nextPage, afterPageId });
    pendingPageFocusRef.current = nextPage.id;
    clearSelection();
    void saveBoardStateImmediately(nextState);
  };

  const updateZoom = (zoomPercent: number) => {
    hasCustomZoomRef.current = true;
    setBoardScale(clamp(zoomPercent / 100, MIN_ZOOM, MAX_ZOOM));
  };

  const scrollThumbnailStripToPage = (pageId: string) => {
    if (!virtualizeThumbnails) return;
    const pageIndex = pages.findIndex((page) => page.id === pageId);
    const strip = thumbnailStripRef.current;
    if (!strip || pageIndex < 0) return;
    strip.scrollTo({
      left: Math.max(
        0,
        pageIndex * PAGE_THUMBNAIL_SLOT_WIDTH - strip.clientWidth / 2 + PAGE_THUMBNAIL_SLOT_WIDTH / 2,
      ),
      behavior: "smooth",
    });
  };

  const selectPage = (pageId: string, scrollToPage = true, clearCurrentSelection = true) => {
    applyLocalBoardUpdate((current) => ({ ...current, selectedPageId: pageId }));
    if (clearCurrentSelection) clearSelection();
    if (scrollToPage) {
      requestAnimationFrame(() => {
        pageRefs.current[pageId]?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
        scrollThumbnailStripToPage(pageId);
      });
    }
  };

  useEffect(() => {
    const pageId = pendingPageFocusRef.current;
    if (!pageId || selectedPageId !== pageId) return;
    const pageExists = pages.some((page) => page.id === pageId);
    if (!pageExists) return;

    requestAnimationFrame(() => {
      pageRefs.current[pageId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
      scrollThumbnailStripToPage(pageId);
      pendingPageFocusRef.current = null;
    });
  }, [pages, selectedPageId]);

  const updateActivePage = (patch: Partial<BoardPage>) => {
    pushUndo();
    applyLocalBoardUpdate((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === selectedPageId ? { ...page, ...patch } : page,
      ),
    }));
    broadcastPatch({ kind: "patch-page", pageId: selectedPageId, patch });
  };

  const restoreVersion = (version: BoardVersion) => {
    const restored = normalizeBoardState(version.state);
    pushUndo();
    applyLocalBoardUpdate(restored);
    broadcastPatch({ kind: "restore-state", state: restored });
    clearSelection();
  };

  const addFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const src = await uploadDesignBoardImage(await fileToDataUrl(file), id, file.name);
      addElement({
        type: "image",
        src,
        label: "",
        x: 480,
        y: 250,
        width: 340,
        height: 260,
      });
    },
    [addElement, id],
  );

  const duplicateSelected = () => {
    const targets = selectedElements.length ? selectedElements : selected ? [selected] : [];
    if (!targets.length) return;
    let nextZ = nextZIndex(elements);
    const copies = targets.map((target) => ({
      ...target,
      id: crypto.randomUUID(),
      x: target.x + 32,
      y: target.y + 32,
      zIndex: nextZ++,
    }));
    pushUndo();
    setElements((current) => [...current, ...copies]);
    selectMany(copies.map((copy) => copy.id));
  };

  const moveLayer = (direction: "front" | "back") => {
    const targetIds = selectedElements.length
      ? new Set(selectedElements.map((element) => element.id))
      : selected
        ? new Set([selected.id])
        : null;
    if (!targetIds) return;
    const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
    const targets = sorted.filter((element) => targetIds.has(element.id));
    const nextSorted = sorted.filter((element) => !targetIds.has(element.id));
    if (direction === "front") nextSorted.push(...targets);
    else nextSorted.unshift(...targets);
    const normalizedZ = new Map(nextSorted.map((element, index) => [element.id, (index + 1) * 10]));
    pushUndo();
    setElements((current) =>
      current.map((element) => ({
        ...element,
        zIndex: normalizedZ.get(element.id) ?? element.zIndex,
      })),
    );
  };

  const removeSelected = useCallback(() => {
    const idsToRemove = selectedIds.length ? selectedIds : selectedId ? [selectedId] : [];
    if (!idsToRemove.length) return;
    const idSet = new Set(idsToRemove);
    pushUndo();
    setElements((current) => current.filter((element) => !idSet.has(element.id)));
    clearSelection();
  }, [clearSelection, pushUndo, selectedId, selectedIds, setElements]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingText =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isEditingText) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith("image/"),
      );
      if (file) {
        event.preventDefault();
        void addFile(file);
        return;
      }
      const copiedElements = copiedElementsRef.current;
      if (!copiedElements.length) return;
      event.preventDefault();
      pushUndo();
      let nextZ = nextZIndex(elements);
      const copyItems = copiedElements.map((copiedElement) => ({
        ...copiedElement,
        id: crypto.randomUUID(),
        x: copiedElement.x + 32,
        y: copiedElement.y + 32,
        zIndex: nextZ++,
      }));
      setElements((current) => [...current, ...copyItems]);
      selectMany(copyItems.map((copyItem) => copyItem.id));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFile, elements, pushUndo, selectMany, setElements]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingText =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isEditingText) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastChange();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        const copiedElements = copiedElementsRef.current;
        if (!copiedElements.length) return;
        event.preventDefault();
        pushUndo();
        let nextZ = nextZIndex(elements);
        const copyItems = copiedElements.map((copiedElement) => ({
          ...copiedElement,
          id: crypto.randomUUID(),
          x: copiedElement.x + 32,
          y: copiedElement.y + 32,
          zIndex: nextZ++,
        }));
        setElements((current) => [...current, ...copyItems]);
        selectMany(copyItems.map((copyItem) => copyItem.id));
        return;
      }
      if (!selectedId && !selectedIds.length) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && selected) {
        event.preventDefault();
        copiedElementsRef.current = selectedElements.length
          ? cloneBoardElements(selectedElements)
          : [selected];
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    pushUndo,
    removeSelected,
    elements,
    selectMany,
    selected,
    selectedElements,
    selectedId,
    selectedIds.length,
    setElements,
    undoLastChange,
  ]);

  const removeSelectedBackground = async () => {
    if (!selected || selected.type !== "image" || !selected.src) return;
    const targetId = selected.id;
    const targetPageId = selectedPageId;
    const originalSrc = selected.originalSrc || selected.src;
    pushUndo();
    removingBackgroundRef.current = true;
    localEditShieldUntilRef.current = Date.now() + 6000;
    setRemovingBackground(true);
    try {
      const source = await imageSourceForCanvas(originalSrc);
      const cutout = await removeFlatImageBackground(source);
      const uploadedCutout = await uploadDesignBoardImage(
        cutout,
        id,
        `${selected.label || "cutout"}.png`,
      );
      localEditShieldUntilRef.current = Date.now() + 6000;
      setElementsForPage(targetPageId, (current) =>
        current.map((element) =>
          element.id === targetId ? { ...element, originalSrc, src: uploadedCutout } : element,
        ),
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not remove background.");
    } finally {
      window.setTimeout(() => {
        removingBackgroundRef.current = false;
      }, 1500);
      setRemovingBackground(false);
    }
  };

  const restoreSelectedOriginal = () => {
    if (!selected || selected.type !== "image" || !selected.originalSrc) return;
    const targetId = selected.id;
    pushUndo();
    setElements((current) =>
      current.map((element) =>
        element.id === targetId
          ? { ...element, src: element.originalSrc, originalSrc: undefined }
          : element,
      ),
    );
  };

  const handleBoardDrop = async (
    event: ReactDragEvent<HTMLDivElement>,
    pageId = selectedPageId,
  ) => {
    event.preventDefault();
    const productJson = event.dataTransfer.getData("application/x-merav-product");
    const materialJson = event.dataTransfer.getData("application/x-merav-material-item");
    const imageJson = event.dataTransfer.getData("application/x-merav-room-image");
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect ? (event.clientX - rect.left) / boardScale : 500;
    const y = rect ? (event.clientY - rect.top) / boardScale : 260;

    if (productJson) {
      const product = JSON.parse(productJson) as Product;
      addElement(productToBoardElement(product, x - 130, y - 115), pageId);
      return;
    }

    if (materialJson) {
      const item = JSON.parse(materialJson) as BoardMaterialTrayItem;
      addElement(materialItemToBoardElement(item, x - 130, y - 115), pageId);
      return;
    }

    if (imageJson) {
      const image = JSON.parse(imageJson) as { url: string; caption?: string | null };
      addElement(
        {
          type: "image",
          src: image.url,
          label: image.caption || "Project image",
          x: x - 160,
          y: y - 115,
          width: 320,
          height: 230,
        },
        pageId,
      );
      return;
    }

    const file = Array.from(event.dataTransfer.files ?? []).find((item) =>
      item.type.startsWith("image/"),
    );
    if (file) {
      const src = await uploadDesignBoardImage(await fileToDataUrl(file), id, file.name);
      addElement(
        {
          type: "image",
          src,
          label: "",
          x: x - 170,
          y: y - 130,
          width: 340,
          height: 260,
        },
        pageId,
      );
    }
  };

  const handleBoardStripScroll = () => {
    if (scrollSelectionRef.current) window.clearTimeout(scrollSelectionRef.current);
    scrollSelectionRef.current = window.setTimeout(() => {
      const strip = boardStripRef.current;
      if (!strip) return;
      const stripRect = strip.getBoundingClientRect();
      const stripCenter = stripRect.left + stripRect.width / 2;
      let closestPageId = selectedPageId;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const page of pages) {
        const node = pageRefs.current[page.id];
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const distance = Math.abs(rect.left + rect.width / 2 - stripCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPageId = page.id;
        }
      }
      if (closestPageId !== selectedPageId) {
        applyLocalBoardUpdate((current) => ({ ...current, selectedPageId: closestPageId }));
        scrollThumbnailStripToPage(closestPageId);
        clearSelection();
      }
    }, 80);
  };

  useEffect(() => {
    const strip = thumbnailStripRef.current;
    if (!strip) return;
    const updateViewport = () =>
      setThumbnailViewport({ scrollLeft: strip.scrollLeft, width: strip.clientWidth });
    updateViewport();
    strip.addEventListener("scroll", updateViewport, { passive: true });
    window.addEventListener("resize", updateViewport);
    return () => {
      strip.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [virtualizeThumbnails]);

  if (!project) {
    return (
      <AppShell>
        <div className="p-16 text-muted-foreground">Loading design boards...</div>
      </AppShell>
    );
  }

  if (!loadingProfile && !canEditDesignBoards) {
    return (
      <AppShell>
        <div className="p-16">
          <div className="eyebrow">Design Boards</div>
          <h1 className="mt-3 font-display text-5xl">Employee access only</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
            Design boards are currently available to MERAV admins and employees only. Client and
            contractor sharing can be added later when we define what they should see.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="min-h-screen bg-[#f4f1ec] text-ink">
        <div className="border-b border-stone-200 bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-4 px-5 py-5">
            <div>
              <Link
                to="/projects/$id"
                params={{ id }}
                className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> {project.name}
              </Link>
              <div className="eyebrow">Studio Design Boards</div>
              <h1 className="font-display text-4xl leading-tight">{activePage.title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-stone-600">
                Build the board here so product links, labels, vendor info, pricing, and finish
                details stay connected instead of being trapped inside a PDF.
              </p>
              <div className="mt-3 text-xs uppercase tracking-[0.18em] text-stone-500">
                {saveStatus === "loading" && "Loading shared board"}
                {saveStatus === "ready" && "Shared board ready"}
                {saveStatus === "saving" && "Saving shared board"}
                {saveStatus === "saved" && "Shared board saved"}
                {saveStatus === "error" && "Could not save shared board"}
                {saveStatus === "local" && "Local-only view"}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-600">
                  {onlineUsers.length ? `${onlineUsers.length} online` : "Live editing ready"}
                </div>
                <label className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-700">
                  <span className="font-medium uppercase tracking-[0.14em] text-stone-500">
                    Jump to
                  </span>
                  <select
                    value={selectedPageId}
                    onChange={(event) => selectPage(event.target.value)}
                    className="max-w-[220px] bg-transparent font-medium text-ink outline-none"
                    aria-label="Jump to design board page"
                  >
                    {pages.map((page, index) => (
                      <option key={page.id} value={page.id}>
                        {index + 1}. {page.title || `Board ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                {boardMissingInfoCount > 0 && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {boardMissingInfoCount} need material info
                  </div>
                )}
                {onlineUsers.slice(0, 8).map((user) => (
                  <div
                    key={user.userId || user.email || user.clientId}
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-700"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: user.color }}
                    />
                    <span>{user.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToolbarButton
                onClick={() =>
                  addElement({
                    type: "text",
                    text: "Add text",
                    x: 540,
                    y: 90,
                    width: 300,
                    height: 56,
                    color: DEFAULT_BOARD_TEXT_COLOR,
                    fontSize: 30,
                    fontFamily: DEFAULT_BOARD_TEXT_FONT,
                    letterSpacing: 2,
                  })
                }
              >
                <Type className="h-4 w-4" /> Text
              </ToolbarButton>
              {selected?.type === "text" && selectedCount <= 1 && (
                <div className="inline-flex items-center gap-2 border border-stone-300 bg-white px-3 py-2 text-sm">
                  <select
                    aria-label="Text font"
                    value={selected.fontFamily ?? DEFAULT_BOARD_TEXT_FONT}
                    onChange={(event) =>
                      updateElement(selected.id, { fontFamily: event.target.value })
                    }
                    className="w-32 bg-white text-sm outline-none"
                  >
                    {BOARD_FONT_OPTIONS.map((font) => (
                      <option key={font.value} value={font.value}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Text font size"
                    type="number"
                    min={8}
                    max={220}
                    value={selected.fontSize ?? 24}
                    onChange={(event) =>
                      updateElement(selected.id, {
                        fontSize: clampNumber(Number(event.target.value) || 24, 8, 220),
                      })
                    }
                    className="w-16 border-l border-stone-200 pl-2 text-sm outline-none"
                  />
                  <label className="flex items-center gap-2 border-l border-stone-200 pl-2 text-xs uppercase tracking-[0.16em] text-stone-500">
                    Color
                    <div className="flex items-center gap-1">
                      {BOARD_TEXT_COLOR_OPTIONS.map((colorOption) => {
                        const isActive =
                          (selected.color ?? DEFAULT_BOARD_TEXT_COLOR).toLowerCase() ===
                          colorOption.value;
                        return (
                          <button
                            key={colorOption.value}
                            type="button"
                            aria-label={`Set text color to ${colorOption.label}`}
                            title={colorOption.label}
                            onClick={() => updateElement(selected.id, { color: colorOption.value })}
                            className={cn(
                              "h-6 w-6 rounded-full border transition",
                              isActive ? "border-ink ring-2 ring-ink/20" : "border-stone-300",
                            )}
                            style={{ backgroundColor: colorOption.value }}
                          />
                        );
                      })}
                      <label className="ml-1 inline-flex cursor-pointer items-center border-l border-stone-200 pl-2 text-[10px] text-stone-500 hover:text-ink">
                        Custom
                        <input
                          aria-label="Custom text color"
                          type="color"
                          value={selected.color ?? DEFAULT_BOARD_TEXT_COLOR}
                          onChange={(event) =>
                            updateElement(selected.id, { color: event.target.value })
                          }
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </label>
                </div>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 border border-stone-300 bg-white px-4 py-2 text-sm transition hover:border-ink">
                <Upload className="h-4 w-4" />
                Upload
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void addFile(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <ToolbarButton onClick={() => addPage(selectedPageId)}>
                <Plus className="h-4 w-4" /> New Page
              </ToolbarButton>
              <ToolbarButton onClick={duplicateSelected} disabled={!selectedCount}>
                <Copy className="h-4 w-4" /> Duplicate
              </ToolbarButton>
              <ToolbarButton onClick={() => moveLayer("front")} disabled={!selectedCount}>
                <ArrowUp className="h-4 w-4" /> Front
              </ToolbarButton>
              <ToolbarButton onClick={() => moveLayer("back")} disabled={!selectedCount}>
                <ArrowDown className="h-4 w-4" /> Back
              </ToolbarButton>
              <ToolbarButton
                onClick={removeSelectedBackground}
                disabled={
                  !selected ||
                  selectedCount !== 1 ||
                  selected.type !== "image" ||
                  removingBackground
                }
              >
                <Scissors className="h-4 w-4" /> {removingBackground ? "Cutting..." : "Remove BG"}
              </ToolbarButton>
              <ToolbarButton
                onClick={restoreSelectedOriginal}
                disabled={
                  !selected ||
                  selectedCount !== 1 ||
                  selected.type !== "image" ||
                  !selected.originalSrc
                }
              >
                Restore Original
              </ToolbarButton>
              <ToolbarButton onClick={toggleBoardDetails} disabled={!imageElements.length}>
                {allBoardDetailsHidden ? "Show Text / Links" : "Hide Text / Links"}
              </ToolbarButton>
              <ToolbarButton
                onClick={() => {
                  setToolsPinned(true);
                }}
                disabled={!selected}
              >
                <MessageSquare className="h-4 w-4" /> Comment
              </ToolbarButton>
              <ToolbarButton
                onClick={sendCurrentPageToMaterials}
                disabled={!imageElements.length || bulkMaterialScope !== null}
              >
                <Plus className="h-4 w-4" />
                {bulkMaterialScope === "page" ? "Sending Page..." : "Send Page to Materials"}
              </ToolbarButton>
              <ToolbarButton onClick={removeSelected} disabled={!selectedCount} destructive>
                <Trash2 className="h-4 w-4" /> Delete
              </ToolbarButton>
            </div>
          </div>
        </div>

        <main className="relative mx-auto max-w-[1680px] px-5 py-5 pb-32 pr-16">
          <section
            ref={boardStripRef}
            className="overflow-x-auto overflow-y-hidden rounded-xl border border-stone-200 bg-white/70 p-3 shadow-sm"
            onScroll={handleBoardStripScroll}
          >
            <div
              className="flex items-start gap-10"
              style={{
                width:
                  pages.length * BOARD_WIDTH * boardScale +
                  Math.max(0, pages.length - 1) * MAIN_PAGE_GAP,
                minHeight: BOARD_HEIGHT * boardScale,
              }}
            >
              {pages.map((page, pageIndex) => {
                const pageElements = page.elements;
                const sortedPageElements = [...pageElements].sort((a, b) => a.zIndex - b.zIndex);
                const isActivePage = page.id === selectedPageId;
                const isNearbyPage = editablePageIds.has(page.id);

                return (
                  <div
                    key={page.id}
                    ref={(node) => {
                      pageRefs.current[page.id] = node;
                    }}
                    className="shrink-0"
                    style={{ width: BOARD_WIDTH * boardScale, height: BOARD_HEIGHT * boardScale }}
                  >
                    <div
                      className={cn(
                        "relative origin-top-left overflow-hidden bg-[#fbfaf7] shadow-[0_24px_80px_rgba(40,34,25,0.13)] transition",
                        isActivePage && "ring-2 ring-[#6d4cff]",
                      )}
                      style={{
                        width: BOARD_WIDTH,
                        height: BOARD_HEIGHT,
                        transform: `scale(${boardScale})`,
                      }}
                      onDrop={(event) => handleBoardDrop(event, page.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onPointerDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        selectPage(page.id, false, false);
                        clearSelection();
                        const rect = event.currentTarget.getBoundingClientRect();
                        const pointX = clamp(
                          (event.clientX - rect.left) / boardScale,
                          0,
                          BOARD_WIDTH,
                        );
                        const pointY = clamp(
                          (event.clientY - rect.top) / boardScale,
                          0,
                          BOARD_HEIGHT,
                        );
                        setSelectionMarquee({
                          pageId: page.id,
                          boardLeft: rect.left,
                          boardTop: rect.top,
                          startX: pointX,
                          startY: pointY,
                          currentX: pointX,
                          currentY: pointY,
                        });
                      }}
                    >
                      {!isActivePage && !isNearbyPage && (
                        <LightweightPagePlaceholder page={page} pageNumber={pageIndex + 1} />
                      )}

                      {!isActivePage && isNearbyPage && (
                        <LightweightPagePreview page={page} pageNumber={pageIndex + 1} />
                      )}

                      {isActivePage && pageElements.length === 0 && (
                        <div className="pointer-events-none absolute inset-8 flex items-center justify-center border border-dashed border-stone-200 text-center text-stone-300">
                          <div>
                            <div className="font-display text-4xl">Blank board</div>
                            <div className="mt-2 text-xs uppercase tracking-[0.28em]">
                              Page {pageIndex + 1} · drag products, project images, or uploads here
                            </div>
                          </div>
                        </div>
                      )}

                      {isActivePage &&
                        sortedPageElements.map((element) => (
                          <BoardObject
                            key={element.id}
                            element={element}
                            selected={selectedIdSet.has(element.id)}
                            showResizeHandle={selectedCount <= 1}
                            remoteUsers={remoteSelections.get(`${page.id}:${element.id}`) ?? []}
                            commentCount={
                              commentCountsByElement.get(`${page.id}:${element.id}`) ?? 0
                            }
                            onQuickComment={() => quickCommentElement(element, page.id)}
                            onQuickLink={() => quickEditElementLink(element, page.id)}
                            onQuickLabel={() => quickEditElementLabel(element, page.id)}
                            onQuickFinish={() => quickEditElementFinish(element, page.id)}
                            onQuickDelete={() => quickDeleteElement(element, page.id)}
                            onSelect={(event) => {
                              selectPage(page.id, false, false);
                              if (event.shiftKey || event.metaKey) {
                                toggleSelectedElement(element.id);
                              } else if (selectedCount > 1 && selectedIdSet.has(element.id)) {
                                setSelectedId(element.id);
                              } else {
                                selectOnly(element.id);
                              }
                            }}
                            onChange={(patch) => updateElement(element.id, patch, page.id)}
                            onStartMove={(event) => {
                              pushUndo();
                              event.currentTarget.setPointerCapture(event.pointerId);
                              selectPage(page.id, false, false);
                              const isPartOfGroup = selectedIdSet.has(element.id);
                              const moveTargets =
                                isPartOfGroup && selectedElements.length > 1
                                  ? selectedElements
                                  : [element];
                              if (!isPartOfGroup) selectOnly(element.id);
                              else setSelectedId(element.id);
                              setDragMode({
                                kind: "move",
                                pageId: page.id,
                                id: element.id,
                                startX: event.clientX,
                                startY: event.clientY,
                                originalPositions: Object.fromEntries(
                                  moveTargets.map((target) => [
                                    target.id,
                                    { x: target.x, y: target.y },
                                  ]),
                                ),
                              });
                            }}
                            onStartResize={(event) => {
                              event.stopPropagation();
                              pushUndo();
                              event.currentTarget.setPointerCapture(event.pointerId);
                              selectPage(page.id, false, false);
                              selectOnly(element.id);
                              setDragMode({
                                kind: "resize",
                                pageId: page.id,
                                id: element.id,
                                startX: event.clientX,
                                startY: event.clientY,
                                originalWidth: element.width,
                                originalHeight: element.height,
                              });
                            }}
                          />
                        ))}

                      {isActivePage && selectedBounds && selectedCount > 1 && (
                        <div
                          className="pointer-events-none absolute border-2 border-[#1f4e5f]"
                          style={{
                            left: selectedBounds.x,
                            top: selectedBounds.y,
                            width: selectedBounds.width,
                            height: selectedBounds.height,
                            zIndex: 999_998,
                          }}
                        >
                          <div className="absolute -top-8 left-0 whitespace-nowrap bg-[#1f4e5f] px-2 py-1 font-[var(--font-montserrat)] text-[10px] uppercase tracking-[0.14em] text-white shadow-sm">
                            {selectedCount} selected
                          </div>
                          <button
                            type="button"
                            aria-label="Resize selected group"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              pushUndo();
                              event.currentTarget.setPointerCapture(event.pointerId);
                              setDragMode({
                                kind: "resize-group",
                                pageId: page.id,
                                startX: event.clientX,
                                startY: event.clientY,
                                originalBounds: selectedBounds,
                                originalElements: makeOriginalElementRects(selectedElements),
                              });
                            }}
                            className="pointer-events-auto absolute -bottom-2 -right-2 h-5 w-5 border border-[#1f4e5f] bg-white shadow-sm"
                          />
                        </div>
                      )}

                      {selectionMarquee?.pageId === page.id && (
                        <div
                          className="pointer-events-none absolute border border-[#6d4cff] bg-[#6d4cff]/10"
                          style={marqueeStyleFromPoints(
                            selectionMarquee.startX,
                            selectionMarquee.startY,
                            selectionMarquee.currentX,
                            selectionMarquee.currentY,
                          )}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-stone-200 bg-[#f6f4f0]/95 shadow-[0_-12px_36px_rgba(40,34,25,0.1)] backdrop-blur print:hidden">
            <div className="flex items-center gap-3 px-4 py-2">
              <div
                ref={thumbnailStripRef}
                className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5"
              >
                {virtualizeThumbnails && (
                  <div
                    aria-hidden="true"
                    className="shrink-0"
                    style={{ width: thumbnailWindow.before }}
                  />
                )}
                {pages.slice(thumbnailWindow.start, thumbnailWindow.end).map((page, offset) => {
                  const index = thumbnailWindow.start + offset;
                  const isNearSelected = Math.abs(index - selectedPageIndex) <= 6;
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => selectPage(page.id)}
                      className={cn(
                        "group shrink-0 rounded-lg border bg-white p-0.5 text-left shadow-sm transition",
                        page.id === selectedPageId
                          ? "border-[#6d4cff] ring-2 ring-[#6d4cff]"
                          : "border-stone-200 hover:border-ink",
                      )}
                    >
                      <PageThumbnail
                        page={page}
                        pageNumber={index + 1}
                        renderImages={!virtualizeThumbnails || isNearSelected}
                      />
                    </button>
                  );
                })}
                {virtualizeThumbnails && (
                  <div
                    aria-hidden="true"
                    className="shrink-0"
                    style={{ width: thumbnailWindow.after }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => addPage(selectedPageId)}
                  title="Add page after current page"
                  className="flex h-[64px] w-[112px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white text-xs text-ink transition hover:border-ink"
                >
                  <Plus className="h-3.5 w-3.5" /> After Current
                </button>
              </div>

              <div className="hidden shrink-0 items-center gap-2 md:flex">
                <input
                  type="range"
                  min={Math.round(MIN_ZOOM * 100)}
                  max={Math.round(MAX_ZOOM * 100)}
                  value={Math.round(boardScale * 100)}
                  onChange={(event) => updateZoom(Number(event.target.value))}
                  className="w-36 accent-ink"
                  aria-label="Board zoom"
                />
                <div className="w-10 text-right text-xs font-medium text-stone-600">
                  {Math.round(boardScale * 100)}%
                </div>
                <div className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700">
                  Pages
                </div>
                <div className="w-14 text-xs font-medium text-stone-600">
                  {pages.findIndex((page) => page.id === selectedPageId) + 1} / {pages.length}
                </div>
              </div>
            </div>
          </div>

          <aside
            className={cn(
              "group fixed right-0 top-0 z-50 flex h-screen transition-transform duration-200 hover:translate-x-0 focus-within:translate-x-0 print:hidden",
              toolsPinned ? "translate-x-0" : "translate-x-[360px]",
            )}
          >
            <div className="mt-32 flex h-32 w-12 items-center justify-center rounded-l-xl border border-r-0 border-stone-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setToolsPinned((current) => !current)}
                className="-rotate-90 whitespace-nowrap text-xs uppercase tracking-[0.22em] text-stone-500"
              >
                Board Tools
              </button>
            </div>
            <div className="h-full w-[360px] space-y-4 overflow-y-auto border-l border-stone-200 bg-white p-4 shadow-[-20px_0_60px_rgba(40,34,25,0.12)]">
              <div>
                <div className="eyebrow">Board Setup</div>
                <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-stone-500">
                  Page Title
                  <input
                    value={activePage.title}
                    onChange={(event) => updateActivePage({ title: event.target.value })}
                    className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
                  />
                </label>
                <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-stone-500">
                  Room
                  <select
                    value={activePage.roomId ?? ""}
                    onChange={(event) => updateActivePage({ roomId: event.target.value || null })}
                    className="mt-1 w-full border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                  >
                    <option value="">No room assigned</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="border border-stone-200 p-3">
                    <div className="font-display text-2xl">{elements.length}</div>
                    <div className="eyebrow mt-1">Items</div>
                  </div>
                  <div className="border border-stone-200 p-3">
                    <div className="font-display text-2xl">{linkedProductCount}</div>
                    <div className="eyebrow mt-1">Linked</div>
                  </div>
                </div>
                {activePageMissingInfoCount > 0 && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {activePageMissingInfoCount} image
                      {activePageMissingInfoCount === 1 ? " needs" : "s need"} material info
                    </div>
                    <p className="mt-1 text-amber-800">
                      Add label, link, and room before sending to Materials so specs and
                      presentations stay clean.
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={sendFullBoardToMaterials}
                  disabled={
                    bulkMaterialScope !== null ||
                    !pages.some((page) => page.elements.some((element) => element.type === "image"))
                  }
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {bulkMaterialScope === "board"
                    ? "Sending Full Board..."
                    : "Send Full Board to Materials"}
                </button>
              </div>

              <CommentsPanel
                comments={activePageComments}
                selectedComments={selectedTargetComments}
                target={commentTarget}
                selected={selected}
                users={taggableUsers}
                selectedTagIds={commentTagIds}
                draft={commentDraft}
                onDraftChange={setCommentDraft}
                onAddTag={(userId) =>
                  setCommentTagIds((current) =>
                    current.includes(userId) ? current : [...current, userId],
                  )
                }
                onRemoveTag={(userId) =>
                  setCommentTagIds((current) => current.filter((id) => id !== userId))
                }
                onAddComment={addComment}
                onDeleteComment={deleteComment}
              />

              {selected && selectedCount <= 1 && (
                <SelectedPanel
                  selected={selected}
                  rooms={rooms}
                  products={products}
                  activePageRoomId={activePage.roomId}
                  onUpdate={(patch) => updateElement(selected.id, patch)}
                  onSendToMaterials={sendSelectedToMaterials}
                  sendingToMaterials={sendingMaterialId === selected.id}
                  allBoardDetailsHidden={allBoardDetailsHidden}
                  onToggleBoardDetails={toggleBoardDetails}
                  onRemoveBackground={removeSelectedBackground}
                  removingBackground={removingBackground}
                />
              )}

              <div className="border-t border-stone-200 pt-4">
                <div className="eyebrow mb-3">Product Catalog</div>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search products"
                    className="w-full border border-stone-200 py-2 pl-9 pr-3 text-sm"
                  />
                </div>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as ItemCategory | "All")}
                  className="mb-3 w-full border border-stone-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="All">All categories</option>
                  {ALL_CATEGORIES.map((productCategory) => (
                    <option key={productCategory} value={productCategory}>
                      {productCategory}
                    </option>
                  ))}
                </select>
                {filteredProjectMaterials.length > 0 && (
                  <div className="mb-4 border-b border-stone-200 pb-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500">
                        Project Materials
                      </div>
                      <div className="text-[10px] text-stone-400">
                        {filteredProjectMaterials.length}
                      </div>
                    </div>
                    <div className="max-h-[240px] space-y-3 overflow-y-auto pr-1">
                      {filteredProjectMaterials.slice(0, 60).map((item) => (
                        <MaterialTrayItem key={item.id} item={item} />
                      ))}
                    </div>
                  </div>
                )}
                <div className="max-h-[430px] space-y-3 overflow-y-auto pr-1">
                  {filteredProducts.slice(0, 80).map((product) => (
                    <ProductTrayItem key={product.id} product={product} />
                  ))}
                </div>
              </div>

              {roomImages.length > 0 && (
                <div className="border-t border-stone-200 pt-4">
                  <div className="eyebrow mb-3">Project Images</div>
                  <div className="grid grid-cols-2 gap-3">
                    {roomImages.slice(0, 24).map((image) => (
                      <div
                        key={image.id}
                        draggable
                        onDragStart={(event) =>
                          event.dataTransfer.setData(
                            "application/x-merav-room-image",
                            JSON.stringify({ url: image.url, caption: image.caption }),
                          )
                        }
                        className="cursor-grab rounded-lg border border-stone-200 bg-[#faf9f5] p-2 active:cursor-grabbing"
                      >
                        <div className="flex aspect-square items-center justify-center overflow-hidden bg-white">
                          <OptimizedBoardImage
                            src={image.url}
                            alt={image.caption ?? ""}
                            kind="thumbnail"
                            className="max-h-full max-w-full object-contain"
                            loading="lazy"
                          />
                        </div>
                        <div className="mt-1 truncate text-[11px] text-stone-500">
                          {image.caption || image.kind}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>
    </AppShell>
  );
}

function LightweightPagePlaceholder({
  page,
  pageNumber,
}: {
  page: BoardPage;
  pageNumber: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-8 flex items-center justify-center border border-dashed border-stone-200 bg-[#fbfaf7] text-center text-stone-300">
      <div>
        <div className="font-display text-7xl">{pageNumber}</div>
        <div className="mt-3 max-w-[520px] truncate font-[var(--font-montserrat)] text-xs uppercase tracking-[0.26em] text-stone-400">
          {page.title || `Board ${pageNumber}`}
        </div>
      </div>
    </div>
  );
}

function LightweightPagePreview({ page, pageNumber }: { page: BoardPage; pageNumber: number }) {
  const sortedElements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <>
      {sortedElements.length === 0 && (
        <LightweightPagePlaceholder page={page} pageNumber={pageNumber} />
      )}
      {sortedElements.map((element) => (
        <LightweightPageElement key={element.id} element={element} />
      ))}
    </>
  );
}

function LightweightPageElement({ element }: { element: BoardElement }) {
  if (element.visible === false) return null;

  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.zIndex,
        transform: `rotate(${element.rotation ?? 0}deg)`,
      }}
    >
      {element.type === "image" && element.src && (
        <OptimizedBoardImage
          src={element.src}
          alt=""
          kind="thumbnail"
          className="h-full w-full object-contain"
          draggable={false}
          loading="lazy"
        />
      )}
      {element.type === "shape" && (
        <div className="h-full w-full" style={{ background: element.background ?? "#dcd9ce" }} />
      )}
      {element.type === "text" && (
        <div
          className="flex h-full w-full items-center justify-center overflow-hidden whitespace-pre-wrap text-center uppercase leading-tight"
          style={{
            color: element.color ?? DEFAULT_BOARD_TEXT_COLOR,
            fontSize: element.fontSize ?? 24,
            letterSpacing: element.letterSpacing ?? 1,
            fontFamily: element.fontFamily ?? DEFAULT_BOARD_TEXT_FONT,
          }}
        >
          {element.text}
        </div>
      )}
    </div>
  );
}

function PageThumbnail({
  page,
  pageNumber,
  renderImages = true,
}: {
  page: BoardPage;
  pageNumber: number;
  renderImages?: boolean;
}) {
  const scale = 0.058;
  const sortedElements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="flex items-end gap-1.5">
      <div className="relative h-[52px] w-[82px] overflow-hidden rounded-md border border-stone-100 bg-[#fbfaf7]">
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT, transform: `scale(${scale})` }}
        >
          {sortedElements.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center font-display text-[72px] text-stone-200">
              {pageNumber}
            </div>
          )}
          {sortedElements.map((element) => (
            <div
              key={element.id}
              className="absolute overflow-hidden"
              style={{
                left: element.x,
                top: element.y,
                width: element.width,
                height: element.height,
                zIndex: element.zIndex,
              }}
            >
              {element.type === "image" && element.src && renderImages && (
                <OptimizedBoardImage
                  src={element.src}
                  alt=""
                  kind="thumbnail"
                  className="h-full w-full object-contain"
                  draggable={false}
                  loading="lazy"
                />
              )}
              {element.type === "shape" && (
                <div
                  className="h-full w-full"
                  style={{ background: element.background ?? "#dcd9ce" }}
                />
              )}
              {element.type === "text" && (
                <div
                  className="flex h-full w-full items-center justify-center overflow-hidden text-center uppercase leading-tight"
                  style={{
                    color: element.color ?? DEFAULT_BOARD_TEXT_COLOR,
                    fontSize: element.fontSize ?? 24,
                    letterSpacing: element.letterSpacing ?? 1,
                    fontFamily: element.fontFamily ?? DEFAULT_BOARD_TEXT_FONT,
                  }}
                >
                  {element.text}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="max-w-[60px] pb-0.5">
        <div className="text-xs font-medium text-ink">{pageNumber}</div>
        <div className="truncate text-[10px] text-stone-500">
          {page.title || `Board ${pageNumber}`}
        </div>
      </div>
    </div>
  );
}

function BoardObject({
  element,
  selected,
  showResizeHandle,
  remoteUsers,
  commentCount,
  onQuickComment,
  onQuickLink,
  onQuickLabel,
  onQuickFinish,
  onQuickDelete,
  onSelect,
  onChange,
  onStartMove,
  onStartResize,
}: {
  element: BoardElement;
  selected: boolean;
  showResizeHandle: boolean;
  remoteUsers: ActiveBoardUser[];
  commentCount: number;
  onQuickComment: () => void;
  onQuickLink: () => void;
  onQuickLabel: () => void;
  onQuickFinish: () => void;
  onQuickDelete: () => void;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onChange: (patch: Partial<BoardElement>) => void;
  onStartMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const isLocked = element.locked === true;
  const isHidden = element.visible === false;
  const remoteUser = remoteUsers[0];
  const materialIssues = element.type === "image" ? imageMaterialIssues(element) : [];

  return (
    <div
      data-board-object="editable"
      className={cn(
        "absolute select-none",
        selected && "outline outline-2 outline-offset-2 outline-[#1f4e5f]",
        remoteUser && !selected && "outline outline-2 outline-offset-2",
        element.type !== "text" && !isLocked && "cursor-move",
        isLocked && "cursor-default",
      )}
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.zIndex,
        transform: `rotate(${element.rotation ?? 0}deg)`,
        opacity: isHidden ? 0.22 : 1,
        outlineColor: remoteUser?.color,
      }}
      onPointerDown={(event) => {
        if (isLocked) return;
        onStartMove(event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
    >
      {remoteUser && (
        <div
          className="pointer-events-none absolute -top-7 left-0 z-20 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-medium text-white shadow-sm"
          style={{ backgroundColor: remoteUser.color }}
        >
          {remoteUser.name}
        </div>
      )}
      {commentCount > 0 && (
        <div
          data-comment-badge="true"
          className="pointer-events-none absolute right-2 top-2 z-30 flex h-9 min-w-9 items-center justify-center rounded-full border-2 border-white bg-white px-2 text-[#1f4e5f] shadow-[0_8px_22px_rgba(40,34,25,0.22)]"
          title={`${commentCount} comment${commentCount === 1 ? "" : "s"}`}
        >
          <MessageSquare className="h-4 w-4" />
          {commentCount > 1 && (
            <span className="ml-1 font-[var(--font-montserrat)] text-[10px] font-semibold">
              {commentCount}
            </span>
          )}
        </div>
      )}
      {selected && showResizeHandle && (
        <div
          className="absolute left-1/2 top-0 z-50 flex -translate-x-1/2 -translate-y-[calc(100%+14px)] items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-2 shadow-[0_10px_30px_rgba(31,29,27,0.18)]"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {element.link && (
            <a
              href={normalizeExternalUrl(element.link)}
              target="_blank"
              rel="noreferrer"
              className="max-w-52 truncate px-2 font-[var(--font-montserrat)] text-sm text-blue-600 underline-offset-4 hover:underline"
              title={element.link}
            >
              {element.link}
            </a>
          )}
          <QuickActionButton label="Comment" onClick={onQuickComment}>
            <MessageSquare className="h-5 w-5" />
          </QuickActionButton>
          <QuickActionButton label="Link" onClick={onQuickLink}>
            <ExternalLink className="h-5 w-5" />
          </QuickActionButton>
          <QuickActionButton label="Label" onClick={onQuickLabel}>
            <Type className="h-5 w-5" />
          </QuickActionButton>
          {element.type === "image" && (
            <QuickActionButton label="Color / Finish" onClick={onQuickFinish}>
              <span className="font-[var(--font-montserrat)] text-[10px] font-semibold tracking-[0.14em]">
                CLR
              </span>
            </QuickActionButton>
          )}
          <QuickActionButton label="Delete" onClick={onQuickDelete} destructive>
            <Trash2 className="h-5 w-5" />
          </QuickActionButton>
        </div>
      )}
      {element.type === "image" && (
        <>
          {element.src ? (
            <OptimizedBoardImage
              src={element.src}
              alt={element.label ?? ""}
              kind="preview"
              className="h-full w-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center border border-dashed border-stone-300 bg-[#faf9f5] p-4 text-center font-display text-2xl text-stone-400">
              {element.label || element.productName || "Image"}
            </div>
          )}
          {!element.hideDetails &&
            (element.label || element.productName) &&
            (element.link ? (
              <a
                href={normalizeExternalUrl(element.link)}
                target="_blank"
                rel="noreferrer"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap bg-white/90 px-2 py-1 text-center font-[var(--font-montserrat)] text-[12px] uppercase tracking-[0.12em] text-stone-700 underline decoration-stone-400 underline-offset-4 shadow-sm"
              >
                {element.label || element.productName}
              </a>
            ) : (
              <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap bg-white/90 px-2 py-1 text-center font-[var(--font-montserrat)] text-[12px] uppercase tracking-[0.12em] text-stone-700 shadow-sm">
                {element.label || element.productName}
              </div>
            ))}
          {!element.hideDetails && element.productId && (
            <div className="pointer-events-none absolute left-1 top-1 rounded-full bg-[#1f4e5f] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white shadow-sm">
              Product
            </div>
          )}
          {materialIssues.length > 0 && (
            <div className="pointer-events-none absolute right-1 top-1 z-10 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 font-[var(--font-montserrat)] text-[10px] uppercase tracking-[0.12em] text-amber-900 shadow-sm">
              <AlertTriangle className="h-3 w-3" />
              Needs {materialIssues.join(" + ")}
            </div>
          )}
        </>
      )}
      {element.type === "shape" && (
        <div className="h-full w-full" style={{ background: element.background ?? "#dcd9ce" }} />
      )}
      {element.type === "text" && (
        <>
          {selected && (
            <div
              onPointerDown={(event) => {
                event.stopPropagation();
                if (isLocked) return;
                onStartMove(event);
              }}
              className="absolute -top-8 left-0 z-10 cursor-move border border-[#1f4e5f] bg-white px-2 py-1 font-[var(--font-montserrat)] text-[10px] uppercase tracking-[0.14em] text-[#1f4e5f] shadow-sm"
            >
              Drag text
            </div>
          )}
          <textarea
            value={element.text ?? ""}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => onSelect(event)}
            onChange={(event) => onChange({ text: event.target.value })}
            className="h-full w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-center uppercase leading-tight outline-none"
            style={{
              color: element.color ?? DEFAULT_BOARD_TEXT_COLOR,
              fontSize: element.fontSize ?? 24,
              letterSpacing: element.letterSpacing ?? 1,
              fontFamily: element.fontFamily ?? DEFAULT_BOARD_TEXT_FONT,
            }}
          />
        </>
      )}
      {selected && showResizeHandle && (
        <button
          type="button"
          aria-label="Resize selected item"
          onPointerDown={(event) => {
            if (isLocked) return;
            onStartResize(event);
          }}
          disabled={isLocked}
          className="absolute -bottom-2 -right-2 h-5 w-5 border border-[#1f4e5f] bg-white shadow-sm"
        />
      )}
    </div>
  );
}

function QuickActionButton({
  label,
  children,
  onClick,
  destructive,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-full text-ink transition hover:bg-stone-100",
        destructive && "text-red-700 hover:bg-red-50",
      )}
    >
      {children}
    </button>
  );
}

function CommentsPanel({
  comments,
  selectedComments,
  target,
  selected,
  users,
  selectedTagIds,
  draft,
  onDraftChange,
  onAddTag,
  onRemoveTag,
  onAddComment,
  onDeleteComment,
}: {
  comments: BoardComment[];
  selectedComments: BoardComment[];
  target: {
    targetType: BoardCommentTargetType;
    targetId: string;
    pageId: string;
    label: string;
  };
  selected: BoardElement | null;
  users: UserProfile[];
  selectedTagIds: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAddTag: (userId: string) => void;
  onRemoveTag: (userId: string) => void;
  onAddComment: () => void;
  onDeleteComment: (commentId: string) => void;
}) {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const taggedUsers = selectedTagIds
    .map((userId) => usersById.get(userId))
    .filter((user): user is UserProfile => Boolean(user));
  const unselectedUsers = users.filter((user) => !selectedTagIds.includes(user.id));
  const sortedComments = [...comments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const selectedCommentIds = new Set(selectedComments.map((comment) => comment.id));

  return (
    <div className="border-t border-stone-200 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Comments</div>
          <p className="mt-1 text-xs text-stone-500">
            {comments.length} on this page
            {selectedComments.length ? ` · ${selectedComments.length} on selected item` : ""}
          </p>
        </div>
        <MessageSquare className="h-4 w-4 text-stone-400" />
      </div>

      <div className="rounded-lg border border-stone-200 bg-[#faf9f5] p-3">
        <div className="rounded border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">
          Target: <span className="font-medium text-ink">{target.label}</span>
        </div>
        {!selected && (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            Select an image or text box on the board to add a comment.
          </div>
        )}
        <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-stone-500">
          Comment
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Add a note, question, or task..."
            disabled={!selected}
            className="mt-1 min-h-20 w-full resize-y border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400"
          />
        </label>
        <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-stone-500">
          Tag Admin / Employee
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) onAddTag(event.target.value);
            }}
            disabled={!selected}
            className="mt-1 w-full border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400"
          >
            <option value="">Choose person to tag</option>
            {unselectedUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name || user.email} · {user.role}
              </option>
            ))}
          </select>
        </label>
        {taggedUsers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {taggedUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => onRemoveTag(user.id)}
                className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-700 transition hover:border-red-300 hover:text-red-700"
                title="Remove tag"
              >
                @{user.full_name || user.email} ×
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onAddComment}
          disabled={!selected}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MessageSquare className="h-4 w-4" /> Add Comment
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {sortedComments.map((comment) => {
          const tagged = comment.taggedUserIds
            .map((userId) => usersById.get(userId))
            .filter((user): user is UserProfile => Boolean(user));
          return (
            <div
              key={comment.id}
              className={cn(
                "rounded-lg border bg-white p-3 text-sm",
                selectedCommentIds.has(comment.id) ? "border-[#1f4e5f]" : "border-stone-200",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-stone-500">
                    {comment.targetType === "page" ? "Page" : "Item"} Comment
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500">
                    {comment.createdByName || "MERAV teammate"} ·{" "}
                    {new Date(comment.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteComment(comment.id)}
                  className="text-stone-400 transition hover:text-red-700"
                  aria-label="Delete comment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-3 whitespace-pre-wrap leading-6 text-stone-700">{comment.body}</p>
              {tagged.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tagged.map((user) => (
                    <span
                      key={user.id}
                      className="rounded-full bg-[#e9f1ef] px-2.5 py-1 text-xs text-[#1f4e5f]"
                    >
                      @{user.full_name || user.email}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!sortedComments.length && (
          <p className="rounded-lg border border-dashed border-stone-200 p-4 text-xs leading-relaxed text-stone-500">
            No comments on this page yet. Add one for the page, or select an image/text box and
            comment directly on that item.
          </p>
        )}
      </div>
    </div>
  );
}

function SelectedPanel({
  selected,
  rooms,
  products,
  activePageRoomId,
  onUpdate,
  onSendToMaterials,
  sendingToMaterials,
  allBoardDetailsHidden,
  onToggleBoardDetails,
  onRemoveBackground,
  removingBackground,
}: {
  selected: BoardElement;
  rooms: Room[];
  products: Product[];
  activePageRoomId: string | null;
  onUpdate: (patch: Partial<BoardElement>) => void;
  onSendToMaterials: () => void;
  sendingToMaterials: boolean;
  allBoardDetailsHidden: boolean;
  onToggleBoardDetails: () => void;
  onRemoveBackground: () => void;
  removingBackground: boolean;
}) {
  const linkedProduct = selected.productId
    ? products.find((product) => product.id === selected.productId)
    : null;
  const selectedMaterialIssues = selected.type === "image" ? imageMaterialIssues(selected) : [];

  return (
    <div className="border-t border-stone-200 pt-4">
      <div className="eyebrow mb-3">Selected Item</div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => onUpdate({ locked: !selected.locked })}
          className={cn(
            "border px-2 py-2 text-xs transition",
            selected.locked
              ? "border-ink bg-ink text-white"
              : "border-stone-300 bg-white hover:border-ink",
          )}
        >
          {selected.locked ? "Locked" : "Unlocked"}
        </button>
        <button
          type="button"
          onClick={() => onUpdate({ visible: selected.visible === false })}
          className={cn(
            "border px-2 py-2 text-xs transition",
            selected.visible === false
              ? "border-amber-500 bg-amber-50 text-amber-900"
              : "border-stone-300 bg-white hover:border-ink",
          )}
        >
          {selected.visible === false ? "Hidden" : "Visible"}
        </button>
        <label className="block text-[10px] uppercase tracking-[0.12em] text-stone-500">
          Rotate
          <input
            type="number"
            value={selected.rotation ?? 0}
            onChange={(event) => onUpdate({ rotation: Number(event.target.value) || 0 })}
            className="mt-1 w-full border border-stone-200 px-2 py-1 text-xs normal-case tracking-normal"
          />
        </label>
      </div>
      {selected.type === "text" && (
        <div className="space-y-3">
          <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
            Text
            <textarea
              value={selected.text ?? ""}
              onChange={(event) => onUpdate({ text: event.target.value })}
              className="mt-1 min-h-20 w-full resize-y border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
            Font size
            <input
              type="number"
              min={8}
              max={220}
              value={selected.fontSize ?? 24}
              onChange={(event) =>
                onUpdate({ fontSize: clampNumber(Number(event.target.value) || 24, 8, 220) })
              }
              className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
            Font color
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {BOARD_TEXT_COLOR_OPTIONS.map((colorOption) => {
                const isActive =
                  (selected.color ?? DEFAULT_BOARD_TEXT_COLOR).toLowerCase() === colorOption.value;
                return (
                  <button
                    key={colorOption.value}
                    type="button"
                    onClick={() => onUpdate({ color: colorOption.value })}
                    className={cn(
                      "inline-flex items-center gap-2 border px-3 py-2 text-xs normal-case tracking-normal transition",
                      isActive ? "border-ink bg-stone-100" : "border-stone-200 hover:border-ink",
                    )}
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-stone-300"
                      style={{ backgroundColor: colorOption.value }}
                    />
                    {colorOption.label}
                  </button>
                );
              })}
            </div>
            <details className="mt-2 rounded border border-stone-200 px-3 py-2 normal-case tracking-normal">
              <summary className="cursor-pointer text-sm text-stone-600">Custom color</summary>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="color"
                  value={selected.color ?? DEFAULT_BOARD_TEXT_COLOR}
                  onChange={(event) => onUpdate({ color: event.target.value })}
                  className="h-10 w-12 cursor-pointer border border-stone-200 bg-white p-1"
                />
                <input
                  type="text"
                  value={selected.color ?? DEFAULT_BOARD_TEXT_COLOR}
                  onChange={(event) => onUpdate({ color: event.target.value })}
                  className="min-w-0 flex-1 border border-stone-200 px-3 py-2 text-sm"
                />
              </div>
            </details>
          </label>
          <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
            Font
            <select
              value={selected.fontFamily ?? DEFAULT_BOARD_TEXT_FONT}
              onChange={(event) => onUpdate({ fontFamily: event.target.value })}
              className="mt-1 w-full border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal"
            >
              {BOARD_FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {selected.type === "shape" && (
        <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
          Color
          <input
            type="color"
            value={selected.background ?? "#dcd9ce"}
            onChange={(event) => onUpdate({ background: event.target.value })}
            className="mt-1 h-10 w-full border border-stone-200 bg-white"
          />
        </label>
      )}
      {selected.type === "image" && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => onUpdate({ materialInfoNotNeeded: !selected.materialInfoNotNeeded })}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 border px-4 py-2 text-sm transition",
              selected.materialInfoNotNeeded
                ? "border-[#1f4e5f] bg-[#e9f1ef] text-[#1f4e5f]"
                : "border-stone-300 bg-white hover:border-ink",
            )}
          >
            {selected.materialInfoNotNeeded ? "No Label / Link Needed" : "Requires Label + Link"}
          </button>
          {selected.materialInfoNotNeeded && (
            <div className="rounded-lg border border-[#c8d9d4] bg-[#f3f7f5] px-3 py-2 text-xs leading-relaxed text-[#1f4e5f]">
              This image will not be flagged and will be skipped when sending items to Materials.
            </div>
          )}
          {selectedMaterialIssues.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                Needs {joinMissingInfo(selectedMaterialIssues)}
              </div>
              <p className="mt-1 text-amber-800">Add this before sending the image to Materials.</p>
            </div>
          )}
          <button
            type="button"
            onClick={onRemoveBackground}
            disabled={removingBackground}
            className="inline-flex w-full items-center justify-center gap-2 border border-stone-300 bg-white px-4 py-2 text-sm transition hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Scissors className="h-4 w-4" />{" "}
            {removingBackground ? "Removing background..." : "Remove Background"}
          </button>
          <p className="text-xs leading-relaxed text-stone-500">
            Best for product images on white or solid backgrounds. Messy lifestyle photos may still
            need manual cleanup later.
          </p>
          <button
            type="button"
            onClick={onToggleBoardDetails}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 border px-4 py-2 text-sm transition",
              allBoardDetailsHidden
                ? "border-ink bg-ink text-white"
                : "border-stone-300 bg-white hover:border-ink",
            )}
          >
            {allBoardDetailsHidden
              ? "Show All Text / Links on Board"
              : "Hide All Text / Links on Board"}
          </button>
          <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
            Image Label
            <input
              value={selected.label ?? ""}
              onChange={(event) => onUpdate({ label: event.target.value })}
              placeholder="Primary bath mirror"
              className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
            Link
            <input
              value={selected.link ?? ""}
              onChange={(event) => onUpdate({ link: event.target.value })}
              placeholder="https://..."
              className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
            Notes
            <textarea
              value={selected.notes ?? ""}
              onChange={(event) => onUpdate({ notes: event.target.value })}
              placeholder="Internal note, vendor detail, or install reminder"
              className="mt-1 min-h-20 w-full resize-y border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
            />
          </label>
          <div className="border border-stone-200 bg-[#faf9f5] p-3">
            <div className="eyebrow mb-3">Materials</div>
            <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
              Room
              <select
                value={selected.materialRoomId || activePageRoomId || ""}
                onChange={(event) => onUpdate({ materialRoomId: event.target.value || null })}
                className="mt-1 w-full border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal"
              >
                <option value="">Choose room</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-stone-500">
              Category
              <select
                value={
                  selected.materialCategory ||
                  inferMaterialCategory(imageMaterialLabel(selected), selected.link) ||
                  linkedProduct?.category ||
                  "Other"
                }
                onChange={(event) => onUpdate({ materialCategory: event.target.value })}
                className="mt-1 w-full border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal"
              >
                {ALL_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                Qty
                <input
                  type="number"
                  min={1}
                  value={selected.materialQuantity ?? 1}
                  onChange={(event) =>
                    onUpdate({ materialQuantity: Math.max(1, Number(event.target.value) || 1) })
                  }
                  className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
                />
              </label>
              <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                Finish
                <input
                  value={selected.materialFinish ?? selected.finish ?? ""}
                  onChange={(event) => onUpdate({ materialFinish: event.target.value })}
                  placeholder="Color / finish"
                  className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={onSendToMaterials}
              disabled={sendingToMaterials || selected.materialInfoNotNeeded}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {sendingToMaterials
                ? "Sending..."
                : selected.materialItemId
                  ? "Update Material Item"
                  : "Send to Materials"}
            </button>
          </div>
          {linkedProduct && (
            <div className="rounded-lg border border-stone-200 bg-[#faf9f5] p-3 text-sm text-stone-600">
              <div className="eyebrow mb-2">Connected Catalog Product</div>
              <div className="font-medium text-ink">{linkedProduct.name}</div>
              {linkedProduct.vendor && <div>{linkedProduct.vendor}</div>}
              {linkedProduct.finish && <div>Finish: {linkedProduct.finish}</div>}
              {linkedProduct.price && <div>Client price: {linkedProduct.price}</div>}
              {linkedProduct.product_url && (
                <a
                  href={linkedProduct.product_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs underline"
                >
                  Open product link <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProductTrayItem({ product }: { product: Product }) {
  return (
    <div
      draggable
      onDragStart={(event) =>
        event.dataTransfer.setData("application/x-merav-product", JSON.stringify(product))
      }
      className="group cursor-grab rounded-lg border border-stone-200 bg-[#faf9f5] p-3 active:cursor-grabbing"
    >
      <div className="flex gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden bg-white">
          {product.image_url ? (
            <OptimizedBoardImage
              src={product.image_url}
              alt={product.name}
              kind="thumbnail"
              className="max-h-full max-w-full object-contain transition group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-stone-300" />
          )}
        </div>
        <div className="min-w-0 text-sm">
          <div className="line-clamp-2 font-medium leading-tight text-ink">{product.name}</div>
          <div className="mt-1 text-xs text-stone-500">{product.vendor || product.category}</div>
          {product.finish && <div className="text-xs text-stone-500">{product.finish}</div>}
          {product.price && <div className="text-xs text-stone-500">{product.price}</div>}
        </div>
      </div>
    </div>
  );
}

function MaterialTrayItem({ item }: { item: BoardMaterialTrayItem }) {
  const imageUrl = item.product?.image_url ?? null;
  const label = materialTrayLabel(item);
  const category = normalizedMaterialItemCategory(item);
  return (
    <div
      draggable
      onDragStart={(event) =>
        event.dataTransfer.setData("application/x-merav-material-item", JSON.stringify(item))
      }
      className="group cursor-grab rounded-lg border border-stone-200 bg-white p-3 active:cursor-grabbing"
    >
      <div className="flex gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden bg-[#faf9f5]">
          {imageUrl ? (
            <OptimizedBoardImage
              src={imageUrl}
              alt={label}
              kind="thumbnail"
              className="max-h-full max-w-full object-contain transition group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-stone-300" />
          )}
        </div>
        <div className="min-w-0 text-sm">
          <div className="line-clamp-2 font-medium leading-tight text-ink">{label}</div>
          <div className="mt-1 text-xs text-stone-500">
            {[item.room?.name, category].filter(Boolean).join(" · ")}
          </div>
          {item.color && <div className="text-xs text-stone-500">{item.color}</div>}
          {item.product?.vendor && <div className="text-xs text-stone-500">{item.product.vendor}</div>}
        </div>
      </div>
    </div>
  );
}

function OptimizedBoardImage({
  src,
  alt,
  kind,
  className,
  draggable,
  loading,
}: OptimizedBoardImageProps) {
  const [failedVariant, setFailedVariant] = useState<string | null>(null);
  const displaySrc = imageVariantUrl(src, kind);
  const finalSrc = failedVariant === displaySrc ? src : displaySrc;

  useEffect(() => {
    setFailedVariant(null);
  }, [src, kind]);

  return (
    <img
      src={finalSrc}
      alt={alt}
      className={className}
      draggable={draggable}
      loading={loading}
      decoding="async"
      data-original-src={src}
      onError={() => {
        if (finalSrc !== src) setFailedVariant(finalSrc);
      }}
    />
  );
}

function imageVariantUrl(src: string, kind: ImageVariantKind) {
  if (kind === "original") return src;
  const transform =
    kind === "thumbnail"
      ? { width: 240, height: 240, quality: 72 }
      : { width: BOARD_WIDTH, height: BOARD_HEIGHT, quality: 82 };
  return supabaseImageTransformUrl(src, transform) ?? src;
}

function supabaseImageTransformUrl(
  src: string,
  transform: { width: number; height: number; quality: number },
) {
  if (!src || src.startsWith("data:image/")) return null;
  try {
    const url = new URL(src);
    const marker = "/storage/v1/object/public/";
    const index = url.pathname.indexOf(marker);
    if (index === -1) return null;
    url.pathname =
      url.pathname.slice(0, index) +
      "/storage/v1/render/image/public/" +
      url.pathname.slice(index + marker.length);
    url.search = "";
    url.searchParams.set("width", String(transform.width));
    url.searchParams.set("height", String(transform.height));
    url.searchParams.set("resize", "contain");
    url.searchParams.set("quality", String(transform.quality));
    return url.toString();
  } catch {
    return null;
  }
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  destructive,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-35",
        destructive
          ? "border-red-200 bg-white text-red-700 hover:border-red-400"
          : "border-stone-300 bg-white text-ink hover:border-ink",
      )}
    >
      {children}
    </button>
  );
}

function productToBoardElement(
  product: Product,
  x: number,
  y: number,
): Omit<BoardElement, "id" | "zIndex"> {
  return {
    type: "image",
    src: product.image_url || undefined,
    label: product.name,
    link: product.product_url || "",
    productId: product.id,
    productName: product.name,
    vendor: product.vendor,
    price: product.price,
    finish: product.finish,
    materialCategory: product.category,
    materialFinish: product.finish,
    x,
    y,
    width: 260,
    height: 230,
  };
}

function materialItemToBoardElement(
  item: BoardMaterialTrayItem,
  x: number,
  y: number,
): Omit<BoardElement, "id" | "zIndex"> {
  const label = materialTrayLabel(item);
  const product = item.product ?? null;
  const src = product?.image_url || undefined;
  const link = item.product_url || product?.product_url || "";
  const materialCategory = normalizedMaterialItemCategory(item);
  return {
    type: "image",
    src,
    label,
    link,
    productId: item.product_id ?? product?.id ?? null,
    productName: product?.name ?? label,
    vendor: product?.vendor ?? null,
    price: product?.price ?? null,
    finish: item.color ?? product?.finish ?? null,
    notes: item.notes ?? product?.notes ?? "",
    materialItemId: item.id,
    materialRoomId: item.room_id,
    materialCategory,
    materialQuantity: item.quantity ?? 1,
    materialFinish: item.color ?? product?.finish ?? null,
    x,
    y,
    width: 260,
    height: 230,
  };
}

function materialTrayLabel(item: MaterialItem) {
  return (item.client_product_name || item.item_label || item.product?.name || "Material").trim();
}

function imageMaterialLabel(element: BoardElement) {
  return (element.label || element.productName || "").trim();
}

function imageMaterialIssues(element: BoardElement) {
  if (element.type !== "image" || element.materialInfoNotNeeded) return [];
  const issues: string[] = [];
  if (!imageMaterialLabel(element)) issues.push("label");
  if (!element.link?.trim()) issues.push("link");
  return issues;
}

function inferRoomFromPageTitle(pageTitle: string, rooms: Room[]) {
  const normalizedTitle = normalizeRoomLookupText(pageTitle);
  if (!normalizedTitle) return null;
  return (
    [...rooms]
      .sort(
        (a, b) => normalizeRoomLookupText(b.name).length - normalizeRoomLookupText(a.name).length,
      )
      .find((room) => {
        const normalizedRoom = normalizeRoomLookupText(room.name);
        return (
          normalizedRoom &&
          (normalizedTitle === normalizedRoom ||
            normalizedTitle.includes(normalizedRoom) ||
            normalizedRoom.includes(normalizedTitle))
        );
      }) ?? null
  );
}

function normalizeRoomLookupText(value: string) {
  return value
    .toLowerCase()
    .replace(/\bbathrooms?\b/g, "bath")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatSkippedMaterialReasons(reasons: Record<"label" | "link" | "room", number>) {
  const parts = (["label", "link", "room"] as const)
    .filter((key) => reasons[key] > 0)
    .map((key) => `${reasons[key]} missing ${key}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function joinMissingInfo(issues: string[]) {
  if (issues.length <= 1) return issues[0] ?? "required info";
  return `${issues.slice(0, -1).join(", ")} and ${issues.at(-1)}`;
}

async function imageSourceForCanvas(src: string) {
  if (src.startsWith("data:image/")) return src;
  const res = await fetch("/api/image-data-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl: src }),
  });
  const body = await res.json();
  if (!res.ok || !body?.image) throw new Error(body?.error || "Could not prepare image.");
  return body.image as string;
}

async function removeFlatImageBackground(src: string) {
  const { removeBackground } = await import("@imgly/background-removal");
  const cutout = await removeBackground(src, {
    device: "cpu",
    model: "isnet_fp16",
    output: {
      format: "image/png",
      quality: 1,
      type: "foreground",
    },
  });
  return rescueForegroundDetails(src, await blobToDataUrl(cutout));
}

async function rescueForegroundDetails(originalSrc: string, cutoutSrc: string) {
  const [original, cutout] = await Promise.all([
    loadImageElement(originalSrc),
    loadImageElement(cutoutSrc),
  ]);
  const width = original.naturalWidth || cutout.naturalWidth;
  const height = original.naturalHeight || cutout.naturalHeight;
  if (!width || !height) return cutoutSrc;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return cutoutSrc;

  ctx.drawImage(original, 0, 0, width, height);
  const originalPixels = ctx.getImageData(0, 0, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(cutout, 0, 0, width, height);
  const cutoutPixels = ctx.getImageData(0, 0, width, height);

  for (let index = 0; index < cutoutPixels.data.length; index += 4) {
    const alpha = cutoutPixels.data[index + 3];
    if (alpha > 20) continue;
    const red = originalPixels.data[index];
    const green = originalPixels.data[index + 1];
    const blue = originalPixels.data[index + 2];
    const originalAlpha = originalPixels.data[index + 3];
    if (!isStrongForegroundPixel(red, green, blue, originalAlpha)) continue;

    cutoutPixels.data[index] = red;
    cutoutPixels.data[index + 1] = green;
    cutoutPixels.data[index + 2] = blue;
    cutoutPixels.data[index + 3] = originalAlpha;
  }

  ctx.putImageData(cutoutPixels, 0, 0);
  return canvas.toDataURL("image/png");
}

function isStrongForegroundPixel(red: number, green: number, blue: number, alpha: number) {
  if (alpha < 20) return false;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;
  const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;

  // Rescue only confident product/detail pixels so plain white backgrounds stay transparent.
  return luma < 214 || (luma < 238 && chroma > 28);
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not inspect background-removed image."));
    image.src = src;
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read background-removed image."));
    reader.readAsDataURL(blob);
  });
}

async function uploadDesignBoardImage(dataUrl: string, projectId: string, fileName: string) {
  const res = await fetch("/api/upload-design-board-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, projectId, fileName }),
  });
  const body = await res.json();
  if (!res.ok || !body?.url) throw new Error(body?.error || "Could not upload image.");
  return body.url as string;
}

function applyBoardPatchToState(state: BoardState, patch: BoardPatch): BoardState {
  const current = normalizeBoardState(state);
  if (patch.kind === "restore-state") return normalizeBoardState(patch.state);
  if (patch.kind === "select-page")
    return normalizeBoardState({ ...current, selectedPageId: patch.pageId });
  if (patch.kind === "upsert-page") {
    const exists = current.pages.some((page) => page.id === patch.page.id);
    const insertAfterIndex = current.pages.findIndex((page) => page.id === patch.afterPageId);
    const insertAt = insertAfterIndex >= 0 ? insertAfterIndex + 1 : current.pages.length;
    return normalizeBoardState({
      ...current,
      selectedPageId: exists ? current.selectedPageId : patch.page.id,
      pages: exists
        ? current.pages.map((page) =>
            page.id === patch.page.id
              ? (normalizeBoardPage({ ...page, ...patch.page }, 0) ?? page)
              : page,
          )
        : [
            ...current.pages.slice(0, insertAt),
            patch.page,
            ...current.pages.slice(insertAt),
          ],
    });
  }
  if (patch.kind === "patch-page") {
    return normalizeBoardState({
      ...current,
      pages: current.pages.map((page) =>
        page.id === patch.pageId ? { ...page, ...patch.patch } : page,
      ),
    });
  }
  if (patch.kind === "upsert-comment") {
    const exists = (current.comments ?? []).some((comment) => comment.id === patch.comment.id);
    return normalizeBoardState({
      ...current,
      comments: exists
        ? (current.comments ?? []).map((comment) =>
            comment.id === patch.comment.id ? patch.comment : comment,
          )
        : [patch.comment, ...(current.comments ?? [])],
    });
  }
  if (patch.kind === "delete-comment") {
    return normalizeBoardState({
      ...current,
      comments: (current.comments ?? []).filter((comment) => comment.id !== patch.commentId),
    });
  }

  return normalizeBoardState({
    ...current,
    pages: current.pages.map((page) => {
      if (page.id !== patch.pageId) return page;
      if (patch.kind === "upsert-layer") {
        const exists = page.elements.some((element) => element.id === patch.layer.id);
        return {
          ...page,
          elements: exists
            ? page.elements.map((element) =>
                element.id === patch.layer.id
                  ? (normalizeBoardElement({ ...element, ...patch.layer }) ?? element)
                  : element,
              )
            : [...page.elements, patch.layer],
        };
      }
      if (patch.kind === "patch-layer") {
        return {
          ...page,
          elements: page.elements.map((element) =>
            element.id === patch.layerId
              ? (normalizeBoardElement({ ...element, ...patch.patch }) ?? element)
              : element,
          ),
        };
      }
      if (patch.kind === "delete-layer") {
        return {
          ...page,
          elements: page.elements.filter((element) => element.id !== patch.layerId),
        };
      }
      if (patch.kind === "bulk-patch-layers") {
        const patchesById = new Map(patch.patches.map((item) => [item.layerId, item.patch]));
        return {
          ...page,
          elements: page.elements.map((element) => {
            const layerPatch = patchesById.get(element.id);
            return layerPatch
              ? (normalizeBoardElement({ ...element, ...layerPatch }) ?? element)
              : element;
          }),
        };
      }
      return page;
    }),
  });
}

function diffBoardElements(before: BoardElement[], after: BoardElement[]) {
  const beforeById = new Map(before.map((element) => [element.id, element]));
  const afterById = new Map(after.map((element) => [element.id, element]));
  const patches: Array<
    | { kind: "upsert-layer"; layer: BoardElement }
    | { kind: "patch-layer"; layerId: string; patch: Partial<BoardElement> }
    | { kind: "delete-layer"; layerId: string }
  > = [];

  for (const element of after) {
    const previous = beforeById.get(element.id);
    if (!previous) {
      patches.push({ kind: "upsert-layer", layer: element });
      continue;
    }
    const patch = diffBoardElement(previous, element);
    if (Object.keys(patch).length)
      patches.push({ kind: "patch-layer", layerId: element.id, patch });
  }

  for (const element of before) {
    if (!afterById.has(element.id)) patches.push({ kind: "delete-layer", layerId: element.id });
  }

  return patches;
}

function diffBoardElement(before: BoardElement, after: BoardElement): Partial<BoardElement> {
  const patch: Partial<BoardElement> = {};
  const keys: Array<keyof BoardElement> = [
    "type",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "zIndex",
    "src",
    "originalSrc",
    "label",
    "notes",
    "text",
    "background",
    "color",
    "fontSize",
    "fontFamily",
    "letterSpacing",
    "link",
    "locked",
    "visible",
    "hideDetails",
    "productId",
    "productName",
    "vendor",
    "price",
    "finish",
    "materialItemId",
    "materialRoomId",
    "materialCategory",
    "materialQuantity",
    "materialFinish",
    "materialInfoNotNeeded",
  ];
  for (const key of keys) {
    if (before[key] !== after[key]) {
      const nextPatch = patch as Record<string, unknown>;
      nextPatch[key] = after[key];
    }
  }
  return patch;
}

function prepareBoardStateForSave(state: BoardState): BoardState {
  const normalized = normalizeBoardState(state);
  return {
    ...normalized,
    selectedPageId: normalized.pages[0]?.id ?? defaultBoardState().selectedPageId,
    pages: normalized.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) => stripLargeInlineImageData(element)),
    })),
    comments: normalized.comments ?? [],
    versions: (normalized.versions ?? []).slice(0, 12).map((version) => ({
      ...version,
      state: stripVersionsFromState(version.state),
    })),
  };
}

function stripLargeInlineImageData(element: BoardElement): BoardElement {
  if (!element.src?.startsWith("data:image/")) return element;
  return {
    ...element,
    src: undefined,
    originalSrc: element.originalSrc?.startsWith("data:image/") ? undefined : element.originalSrc,
  };
}

function stripVersionsFromState(state: BoardState): BoardState {
  const normalized = normalizeBoardState(state);
  return {
    pages: normalized.pages,
    selectedPageId: normalized.pages[0]?.id ?? defaultBoardState().selectedPageId,
    comments: normalized.comments ?? [],
  };
}

function openBoardStateOnFirstPage(state: BoardState): BoardState {
  const normalized = normalizeBoardState(state);
  return {
    ...normalized,
    selectedPageId: normalized.pages[0]?.id ?? defaultBoardState().selectedPageId,
  };
}

function preserveBoardSelectedPage(state: BoardState, selectedPageId?: string | null): BoardState {
  const normalized = normalizeBoardState(state);
  const selectedPageStillExists =
    typeof selectedPageId === "string" &&
    normalized.pages.some((page) => page.id === selectedPageId);
  return {
    ...normalized,
    selectedPageId: selectedPageStillExists
      ? selectedPageId
      : normalized.pages[0]?.id ?? defaultBoardState().selectedPageId,
  };
}

function addBoardVersion(state: BoardState, createdBy: string, userId?: string | null): BoardState {
  const normalized = normalizeBoardState(state);
  const version: BoardVersion = {
    id: crypto.randomUUID(),
    label: `Autosave by ${createdBy}`,
    createdAt: new Date().toISOString(),
    createdBy: userId ?? null,
    state: stripVersionsFromState(normalized),
  };
  return {
    ...normalized,
    versions: [version, ...(normalized.versions ?? [])].slice(0, 12),
  };
}

function userPresenceColor(seed: string) {
  const colors = ["#1f4e5f", "#9a5f35", "#7a6b2f", "#6d4cff", "#b34d62", "#3f7d55"];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1)
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return colors[hash % colors.length];
}

function normalizeBoardState(value: unknown): BoardState {
  if (!value || typeof value !== "object") return defaultBoardState();
  const candidate = value as Partial<BoardState>;
  if (!Array.isArray(candidate.pages) || candidate.pages.length === 0) return defaultBoardState();

  const pages = candidate.pages
    .map((page, pageIndex) => normalizeBoardPage(page, pageIndex))
    .filter((page): page is BoardPage => Boolean(page));
  if (!pages.length) return defaultBoardState();

  const selectedPageId =
    typeof candidate.selectedPageId === "string" &&
    pages.some((page) => page.id === candidate.selectedPageId)
      ? candidate.selectedPageId
      : pages[0].id;

  const versions = Array.isArray(candidate.versions)
    ? candidate.versions
        .map(normalizeBoardVersion)
        .filter((version): version is BoardVersion => Boolean(version))
        .slice(0, 12)
    : [];

  const comments = Array.isArray(candidate.comments)
    ? candidate.comments
        .map(normalizeBoardComment)
        .filter((comment): comment is BoardComment => Boolean(comment))
    : [];

  return { pages, selectedPageId, comments, versions };
}

function normalizeBoardComment(value: unknown): BoardComment | null {
  if (!value || typeof value !== "object") return null;
  const comment = value as Partial<BoardComment>;
  if (comment.targetType !== "page" && comment.targetType !== "element") return null;
  if (typeof comment.targetId !== "string" || !comment.targetId) return null;
  if (typeof comment.pageId !== "string" || !comment.pageId) return null;
  const body = typeof comment.body === "string" ? comment.body.trim() : "";
  if (!body) return null;
  return {
    id: typeof comment.id === "string" && comment.id ? comment.id : crypto.randomUUID(),
    targetType: comment.targetType,
    targetId: comment.targetId,
    pageId: comment.pageId,
    body,
    taggedUserIds: Array.isArray(comment.taggedUserIds)
      ? comment.taggedUserIds.filter((id): id is string => typeof id === "string" && Boolean(id))
      : [],
    createdById: typeof comment.createdById === "string" ? comment.createdById : null,
    createdByName: typeof comment.createdByName === "string" ? comment.createdByName : null,
    createdAt:
      typeof comment.createdAt === "string" && comment.createdAt
        ? comment.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof comment.updatedAt === "string" && comment.updatedAt
        ? comment.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeBoardVersion(value: unknown): BoardVersion | null {
  if (!value || typeof value !== "object") return null;
  const version = value as Partial<BoardVersion>;
  if (!version.state || typeof version.state !== "object") return null;
  return {
    id: typeof version.id === "string" && version.id ? version.id : crypto.randomUUID(),
    label: typeof version.label === "string" && version.label ? version.label : "Autosave",
    createdAt:
      typeof version.createdAt === "string" && version.createdAt
        ? version.createdAt
        : new Date().toISOString(),
    createdBy: typeof version.createdBy === "string" ? version.createdBy : null,
    state: stripVersionsFromState(version.state as BoardState),
  };
}

function normalizeBoardPage(value: unknown, pageIndex: number): BoardPage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Partial<BoardPage>;
  const id = typeof page.id === "string" && page.id ? page.id : crypto.randomUUID();
  const title =
    typeof page.title === "string" && page.title.trim()
      ? page.title
      : `Design Board ${pageIndex + 1}`;
  const roomId = typeof page.roomId === "string" && page.roomId ? page.roomId : null;
  const elements = Array.isArray(page.elements)
    ? page.elements
        .map(normalizeBoardElement)
        .filter((element): element is BoardElement => Boolean(element))
    : [];
  return { id, title, roomId, elements };
}

function normalizeBoardElement(value: unknown): BoardElement | null {
  if (!value || typeof value !== "object") return null;
  const element = value as Partial<BoardElement>;
  if (element.type !== "image" && element.type !== "text" && element.type !== "shape") return null;
  return {
    ...element,
    id: typeof element.id === "string" && element.id ? element.id : crypto.randomUUID(),
    type: element.type,
    x: typeof element.x === "number" ? element.x : 100,
    y: typeof element.y === "number" ? element.y : 100,
    width: typeof element.width === "number" ? element.width : 240,
    height: typeof element.height === "number" ? element.height : 180,
    rotation: typeof element.rotation === "number" ? element.rotation : 0,
    zIndex: typeof element.zIndex === "number" ? element.zIndex : 10,
    visible: element.visible === false ? false : true,
  };
}

function hasMeaningfulBoardState(state: BoardState) {
  return state.pages.some((page) => page.elements.length > 0);
}

function defaultBoardState(): BoardState {
  const pages = defaultPages();
  return { pages, selectedPageId: pages[0].id, comments: [] };
}

function defaultPages(): BoardPage[] {
  return [
    {
      id: "board-1",
      title: "Design Board 1",
      roomId: null,
      elements: [],
    },
  ];
}

function storageKey(projectId: string) {
  return `merav-studio-design-boards-v2-${projectId}`;
}

function cloneBoardState(state: BoardState): BoardState {
  return JSON.parse(JSON.stringify(state)) as BoardState;
}

function normalizeExternalUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "#";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function nextZIndex(elements: BoardElement[]) {
  return Math.max(0, ...elements.map((element) => element.zIndex)) + 1;
}

function cloneBoardElements(elements: BoardElement[]) {
  return JSON.parse(JSON.stringify(elements)) as BoardElement[];
}

function elementToRect(element: BoardElement): BoardRect {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

function rectFromPoints(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): BoardRect {
  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  return {
    x,
    y,
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}

function marqueeStyleFromPoints(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
) {
  const rect = rectFromPoints(startX, startY, currentX, currentY);
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    zIndex: 999_999,
  };
}

function rectsIntersect(a: BoardRect, b: BoardRect) {
  if (b.width < 4 && b.height < 4) return false;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function getElementsBounds(elements: BoardElement[]): BoardRect | null {
  if (!elements.length) return null;
  const left = Math.min(...elements.map((element) => element.x));
  const top = Math.min(...elements.map((element) => element.y));
  const right = Math.max(...elements.map((element) => element.x + element.width));
  const bottom = Math.max(...elements.map((element) => element.y + element.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function makeOriginalElementRects(elements: BoardElement[]) {
  return Object.fromEntries(elements.map((element) => [element.id, elementToRect(element)]));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
