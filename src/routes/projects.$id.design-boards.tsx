import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Plus,
  Search,
  Scissors,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { db, PRODUCT_CATEGORIES, type Product, type ProductCategory } from "@/lib/db";
import { cn } from "@/lib/utils";

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
};

type BoardPage = {
  id: string;
  title: string;
  roomId: string | null;
  elements: BoardElement[];
};

type BoardState = {
  pages: BoardPage[];
  selectedPageId: string;
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
  | { kind: "upsert-page"; page: BoardPage }
  | { kind: "patch-page"; pageId: string; patch: Partial<Omit<BoardPage, "id" | "elements">> }
  | { kind: "upsert-layer"; pageId: string; layer: BoardElement }
  | { kind: "patch-layer"; pageId: string; layerId: string; patch: Partial<BoardElement> }
  | { kind: "delete-layer"; pageId: string; layerId: string }
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

const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.25;
const AUTOSAVE_DELAY_MS = 700;
const VERSION_SNAPSHOT_INTERVAL_MS = 45_000;
const REMOTE_SELECTION_STALE_MS = 1500;

function ProjectDesignBoardsPage() {
  const { id } = Route.useParams();
  const boardStripRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const copiedElementsRef = useRef<BoardElement[]>([]);
  const undoStackRef = useRef<BoardState[]>([]);
  const hasCustomZoomRef = useRef(false);
  const scrollSelectionRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const broadcastThrottleRef = useRef<Record<string, number>>({});
  const remoteLoadedRef = useRef(false);
  const boardStateRef = useRef<BoardState>(loadBoardState(id));
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
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee>(null);
  const [boardScale, setBoardScale] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ProductCategory | "All">("All");
  const [removingBackground, setRemovingBackground] = useState(false);
  const [activeUsers, setActiveUsers] = useState<ActiveBoardUser[]>([]);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [saveStatus, setSaveStatus] = useState<"local" | "loading" | "saving" | "saved" | "error">(
    "loading",
  );

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
  const { data: sharedBoard, isLoading: loadingSharedBoard } = useQuery({
    queryKey: ["designBoard", id],
    queryFn: () => db.getDesignBoard(id),
    enabled: canEditDesignBoards,
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

  const pages = boardState.pages.length ? boardState.pages : defaultPages();
  const selectedPageId = pages.some((page) => page.id === boardState.selectedPageId)
    ? boardState.selectedPageId
    : pages[0].id;
  const activePage = pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const elements = activePage.elements;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedElements = useMemo(
    () => elements.filter((element) => selectedIdSet.has(element.id)),
    [elements, selectedIdSet],
  );
  const selected =
    elements.find((element) => element.id === selectedId) ?? selectedElements[0] ?? null;
  const selectedBounds = useMemo(() => getElementsBounds(selectedElements), [selectedElements]);
  const selectedCount = selectedElements.length;
  const orderedElements = useMemo(
    () => [...elements].sort((a, b) => a.zIndex - b.zIndex),
    [elements],
  );
  const filteredProducts = useMemo(
    () =>
      category === "All" ? products : products.filter((product) => product.category === category),
    [category, products],
  );
  const linkedProductCount = elements.filter((element) => element.productId).length;
  const imageElements = elements.filter((element) => element.type === "image");
  const allBoardDetailsHidden =
    imageElements.length > 0 && imageElements.every((element) => element.hideDetails);
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

  const applyLocalBoardUpdate = useCallback(
    (updater: BoardState | ((current: BoardState) => BoardState)) => {
      localEditShieldUntilRef.current = Date.now() + 2500;
      setBoardState((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        const normalized = normalizeBoardState(next);
        boardStateRef.current = normalized;
        return normalized;
      });
    },
    [],
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
    const localState = loadBoardState(id);
    boardStateRef.current = localState;
    setBoardState(localState);
    setSelectedId(null);
    setSelectedIds([]);
    setSelectionMarquee(null);
    undoStackRef.current = [];
    remoteLoadedRef.current = false;
    lastSavedJsonRef.current = "";
    lastRemoteUpdatedAtRef.current = "";
    pendingSaveJsonRef.current = null;
    localEditShieldUntilRef.current = 0;
    removingBackgroundRef.current = false;
    applyingRemoteRef.current = false;
    lastGoodBoardStateRef.current = localState;
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
    boardStateRef.current = boardState;
    window.localStorage.setItem(storageKey(id), JSON.stringify(boardState));
  }, [boardState, id]);

  useEffect(() => {
    if (loadingProfile || loadingSharedBoard) return;
    if (!canEditDesignBoards) {
      remoteLoadedRef.current = false;
      setSaveStatus("local");
      return;
    }
    if (remoteLoadedRef.current) return;

    if (sharedBoard?.board_state) {
      const remoteState = normalizeBoardState(sharedBoard.board_state);
      const localState = loadBoardState(id);
      if (!hasMeaningfulBoardState(remoteState) && hasMeaningfulBoardState(localState)) {
        const localJson = JSON.stringify(localState);
        applyingRemoteRef.current = true;
        boardStateRef.current = localState;
        setBoardState(localState);
        lastSavedJsonRef.current = localJson;
        remoteLoadedRef.current = true;
        pendingSaveJsonRef.current = localJson;
        setSaveStatus("saving");
        void db.upsertDesignBoard(id, prepareBoardStateForSave(localState), profile?.id).then(
          (savedBoard) => {
            pendingSaveJsonRef.current = null;
            if (savedBoard?.updated_at) lastRemoteUpdatedAtRef.current = savedBoard.updated_at;
            lastGoodBoardStateRef.current = localState;
            setSaveStatus("saved");
          },
          () => {
            pendingSaveJsonRef.current = null;
            boardStateRef.current = lastGoodBoardStateRef.current;
            setBoardState(lastGoodBoardStateRef.current);
            setSaveStatus("error");
          },
        );
        return;
      }
      applyingRemoteRef.current = true;
      boardStateRef.current = remoteState;
      lastGoodBoardStateRef.current = remoteState;
      setBoardState(remoteState);
      markRemoteBoardApplied(JSON.stringify(remoteState), sharedBoard.updated_at);
      remoteLoadedRef.current = true;
      setSaveStatus("saved");
      return;
    }

    const localState = loadBoardState(id);
    remoteLoadedRef.current = true;
    if (!hasMeaningfulBoardState(localState)) {
      setSaveStatus("saved");
      return;
    }

    const seedJson = JSON.stringify(localState);
    lastSavedJsonRef.current = seedJson;
    pendingSaveJsonRef.current = seedJson;
    setSaveStatus("saving");
    void db.upsertDesignBoard(id, prepareBoardStateForSave(localState), profile?.id).then(
      (savedBoard) => {
        pendingSaveJsonRef.current = null;
        if (savedBoard?.updated_at) lastRemoteUpdatedAtRef.current = savedBoard.updated_at;
        lastGoodBoardStateRef.current = localState;
        setSaveStatus("saved");
      },
      () => {
        pendingSaveJsonRef.current = null;
        boardStateRef.current = lastGoodBoardStateRef.current;
        setBoardState(lastGoodBoardStateRef.current);
        setSaveStatus("error");
      },
    );
  }, [canEditDesignBoards, id, loadingProfile, loadingSharedBoard, profile?.id, sharedBoard]);

  useEffect(() => {
    if (!canEditDesignBoards || !remoteLoadedRef.current) return;
    if (applyingRemoteRef.current) {
      applyingRemoteRef.current = false;
      return;
    }

    const nextJson = JSON.stringify(boardState);
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
      const latestJson = JSON.stringify(latestState);
      pendingSaveJsonRef.current = latestJson;
      void db.upsertDesignBoard(id, prepareBoardStateForSave(latestState), profile?.id).then(
        (savedBoard) => {
          pendingSaveJsonRef.current = null;
          lastSavedJsonRef.current = latestJson;
          if (savedBoard?.updated_at) lastRemoteUpdatedAtRef.current = savedBoard.updated_at;
          lastGoodBoardStateRef.current = latestState;
          setSaveStatus("saved");
        },
        () => {
          pendingSaveJsonRef.current = null;
          boardStateRef.current = lastGoodBoardStateRef.current;
          setBoardState(lastGoodBoardStateRef.current);
          setSaveStatus("error");
        },
      );
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [boardState, canEditDesignBoards, id, profile?.email, profile?.full_name, profile?.id]);

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

  const toggleBoardDetails = () => {
    const shouldHide = !allBoardDetailsHidden;
    pushUndo();
    setElements((current) =>
      current.map((element) =>
        element.type === "image" ? { ...element, hideDetails: shouldHide } : element,
      ),
    );
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

  const addPage = () => {
    const nextPage: BoardPage = {
      id: crypto.randomUUID(),
      title: `Board ${pages.length + 1}`,
      roomId: null,
      elements: [],
    };
    pushUndo();
    applyLocalBoardUpdate((current) => ({
      selectedPageId: nextPage.id,
      pages: [...(current.pages.length ? current.pages : defaultPages()), nextPage],
    }));
    broadcastPatch({ kind: "upsert-page", page: nextPage });
    clearSelection();
  };

  const updateZoom = (zoomPercent: number) => {
    hasCustomZoomRef.current = true;
    setBoardScale(clamp(zoomPercent / 100, MIN_ZOOM, MAX_ZOOM));
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
      });
    }
  };

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
    const imageJson = event.dataTransfer.getData("application/x-merav-room-image");
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect ? (event.clientX - rect.left) / boardScale : 500;
    const y = rect ? (event.clientY - rect.top) / boardScale : 260;

    if (productJson) {
      const product = JSON.parse(productJson) as Product;
      addElement(productToBoardElement(product, x - 130, y - 115), pageId);
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
        clearSelection();
      }
    }, 80);
  };

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
                {saveStatus === "saving" && "Saving shared board"}
                {saveStatus === "saved" && "Shared board saved"}
                {saveStatus === "error" && "Could not save shared board"}
                {saveStatus === "local" && "Local-only view"}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-600">
                  Live editing{" "}
                  {activeUsers.length
                    ? `with ${activeUsers.length} other${activeUsers.length === 1 ? "" : "s"}`
                    : "ready"}
                </div>
                {activeUsers.slice(0, 6).map((user) => (
                  <div
                    key={user.clientId}
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-700"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: user.color }}
                    />
                    <span>{user.name}</span>
                    {user.selectedLayerId && <span className="text-stone-400">selecting</span>}
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
                    color: "#1f1d1b",
                    fontSize: 30,
                    letterSpacing: 2,
                  })
                }
              >
                <Type className="h-4 w-4" /> Text
              </ToolbarButton>
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
              <ToolbarButton onClick={addPage}>
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
                width: pages.length * BOARD_WIDTH * boardScale + Math.max(0, pages.length - 1) * 40,
                minHeight: BOARD_HEIGHT * boardScale,
              }}
            >
              {pages.map((page, pageIndex) => {
                const pageElements = page.elements;
                const sortedPageElements = [...pageElements].sort((a, b) => a.zIndex - b.zIndex);
                const isActivePage = page.id === selectedPageId;

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
                      {pageElements.length === 0 && (
                        <div className="pointer-events-none absolute inset-8 flex items-center justify-center border border-dashed border-stone-200 text-center text-stone-300">
                          <div>
                            <div className="font-display text-4xl">Blank board</div>
                            <div className="mt-2 text-xs uppercase tracking-[0.28em]">
                              Page {pageIndex + 1} · drag products, project images, or uploads here
                            </div>
                          </div>
                        </div>
                      )}

                      {sortedPageElements.map((element) => (
                        <BoardObject
                          key={element.id}
                          element={element}
                          selected={isActivePage && selectedIdSet.has(element.id)}
                          showResizeHandle={isActivePage && selectedCount <= 1}
                          remoteUsers={remoteSelections.get(`${page.id}:${element.id}`) ?? []}
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
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5">
                {pages.map((page, index) => (
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
                    <PageThumbnail page={page} pageNumber={index + 1} />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addPage}
                  className="flex h-[64px] w-[112px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white text-xs text-ink transition hover:border-ink"
                >
                  <Plus className="h-3.5 w-3.5" /> Page
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

          <aside className="group fixed right-0 top-0 z-50 flex h-screen translate-x-[360px] transition-transform duration-200 hover:translate-x-0 focus-within:translate-x-0 print:hidden">
            <div className="mt-32 flex h-32 w-12 items-center justify-center rounded-l-xl border border-r-0 border-stone-200 bg-white shadow-sm">
              <div className="-rotate-90 whitespace-nowrap text-xs uppercase tracking-[0.22em] text-stone-500">
                Board Tools
              </div>
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
                <div className="mt-4 border-t border-stone-200 pt-4">
                  <div className="eyebrow mb-2">Version History</div>
                  <div className="space-y-2">
                    {(boardState.versions ?? []).slice(0, 5).map((version) => (
                      <button
                        key={version.id}
                        type="button"
                        onClick={() => restoreVersion(version)}
                        className="w-full border border-stone-200 bg-[#faf9f5] px-3 py-2 text-left text-xs transition hover:border-ink"
                      >
                        <div className="font-medium text-ink">{version.label}</div>
                        <div className="mt-0.5 text-stone-500">
                          {new Date(version.createdAt).toLocaleString()}
                        </div>
                      </button>
                    ))}
                    {!(boardState.versions ?? []).length && (
                      <p className="text-xs leading-relaxed text-stone-500">
                        Recent autosave versions will appear here as the board changes.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {selected && selectedCount <= 1 && (
                <SelectedPanel
                  selected={selected}
                  products={products}
                  onUpdate={(patch) => updateElement(selected.id, patch)}
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
                  onChange={(event) => setCategory(event.target.value as ProductCategory | "All")}
                  className="mb-3 w-full border border-stone-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="All">All categories</option>
                  {PRODUCT_CATEGORIES.map((productCategory) => (
                    <option key={productCategory} value={productCategory}>
                      {productCategory}
                    </option>
                  ))}
                </select>
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
                          <img
                            src={image.url}
                            alt={image.caption ?? ""}
                            className="max-h-full max-w-full object-contain"
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

function PageThumbnail({ page, pageNumber }: { page: BoardPage; pageNumber: number }) {
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
              {element.type === "image" && element.src && (
                <img
                  src={element.src}
                  alt=""
                  className="h-full w-full object-contain"
                  draggable={false}
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
                    color: element.color ?? "#1f1d1b",
                    fontSize: element.fontSize ?? 24,
                    letterSpacing: element.letterSpacing ?? 1,
                    fontFamily: "var(--font-montserrat)",
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
  onSelect,
  onChange,
  onStartMove,
  onStartResize,
}: {
  element: BoardElement;
  selected: boolean;
  showResizeHandle: boolean;
  remoteUsers: ActiveBoardUser[];
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onChange: (patch: Partial<BoardElement>) => void;
  onStartMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const isLocked = element.locked === true;
  const isHidden = element.visible === false;
  const remoteUser = remoteUsers[0];

  return (
    <div
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
      {element.type === "image" && (
        <>
          {element.src ? (
            <img
              src={element.src}
              alt={element.label ?? ""}
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
              color: element.color ?? "#1f1d1b",
              fontSize: element.fontSize ?? 24,
              letterSpacing: element.letterSpacing ?? 1,
              fontFamily: "var(--font-montserrat)",
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

function SelectedPanel({
  selected,
  products,
  onUpdate,
  allBoardDetailsHidden,
  onToggleBoardDetails,
  onRemoveBackground,
  removingBackground,
}: {
  selected: BoardElement;
  products: Product[];
  onUpdate: (patch: Partial<BoardElement>) => void;
  allBoardDetailsHidden: boolean;
  onToggleBoardDetails: () => void;
  onRemoveBackground: () => void;
  removingBackground: boolean;
}) {
  const linkedProduct = selected.productId
    ? products.find((product) => product.id === selected.productId)
    : null;

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
              value={selected.fontSize ?? 24}
              onChange={(event) => onUpdate({ fontSize: Number(event.target.value) || 24 })}
              className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
            />
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
            <img
              src={product.image_url}
              alt={product.name}
              className="max-h-full max-w-full object-contain transition group-hover:scale-105"
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
    x,
    y,
    width: 260,
    height: 230,
  };
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
    return normalizeBoardState({
      ...current,
      selectedPageId: exists ? current.selectedPageId : patch.page.id,
      pages: exists
        ? current.pages.map((page) =>
            page.id === patch.page.id
              ? (normalizeBoardPage({ ...page, ...patch.page }, 0) ?? page)
              : page,
          )
        : [...current.pages, patch.page],
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
    pages: normalized.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) => stripLargeInlineImageData(element)),
    })),
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
  return { pages: normalized.pages, selectedPageId: normalized.selectedPageId };
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

  return { pages, selectedPageId, versions };
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

function loadBoardState(projectId: string): BoardState {
  if (typeof window === "undefined") return defaultBoardState();
  const stored = window.localStorage.getItem(storageKey(projectId));
  if (!stored) return defaultBoardState();

  try {
    return normalizeBoardState(JSON.parse(stored));
  } catch {
    window.localStorage.removeItem(storageKey(projectId));
  }

  return defaultBoardState();
}

function defaultBoardState(): BoardState {
  const pages = defaultPages();
  return { pages, selectedPageId: pages[0].id };
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
