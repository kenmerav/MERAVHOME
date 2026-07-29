import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DragEvent as ReactDragEvent,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Crop,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  LayoutTemplate,
  MessageSquare,
  Plus,
  RotateCw,
  Search,
  Scissors,
  Trash2,
  Type,
  Upload,
  WandSparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  db,
  type DesignBoardVersionMeta,
  type MaterialItem,
  type Product,
  type ProductCategory,
  type Room,
  type UserProfile,
} from "@/lib/db";
import { buildClientProductName } from "@/lib/clientProductName";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { materialImageUrl } from "@/lib/materialImages";
import { inferVendorFromUrl } from "@/lib/vendorInference";
import {
  ALL_CATEGORIES,
  inferMaterialCategory,
  normalizeItemCategory,
  toProductCategory,
  type ItemCategory,
} from "@/lib/roomTemplates";
import {
  canDownloadDesignBoardPdf,
  canViewProjectSurface,
  isContractorRole,
  isStudioTeamRole,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ImglyBackgroundModel = "isnet_fp16" | "isnet";

export const Route = createFileRoute("/projects/$id/design-boards")({
  head: () => ({ meta: [{ title: "Design Boards — MERAV Studio" }] }),
  component: ProjectDesignBoardsPage,
});

function sortRoomsAlphabetically(rooms: Room[]) {
  return [...rooms].sort((a, b) =>
    a.name
      .trim()
      .toLocaleLowerCase()
      .localeCompare(b.name.trim().toLocaleLowerCase(), undefined, { numeric: true }),
  );
}

function formatLastUpdated(value: string | null | undefined) {
  if (!value) return "Not updated yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not updated yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

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
  backgroundRemovedUrl?: string | null;
  autoRemoveBackground?: boolean;
  fastBackgroundRemovalTried?: boolean;
  bestFreeBackgroundRemovalTried?: boolean;
  backgroundRemovalStatus?: "pending" | "processing" | "complete" | "failed";
  label?: string;
  notes?: string;
  text?: string;
  background?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  letterSpacing?: number;
  link?: string;
  materialLinkCleared?: boolean;
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
  materialDimensions?: string | null;
  materialInfoNotNeeded?: boolean;
  materialInfoSkipApproved?: boolean;
  materialExcludeFromMaterials?: boolean;
  imageBrightness?: number | null;
  imageContrast?: number | null;
  imageSaturation?: number | null;
  imageWarmth?: number | null;
  imageCropZoom?: number | null;
  imageCropX?: number | null;
  imageCropY?: number | null;
};

type PageMaterialsSyncImageSnapshot = {
  id: string;
  src: string | null;
  label: string | null;
  notes: string | null;
  link: string | null;
  materialLinkCleared: boolean;
  productId: string | null;
  productName: string | null;
  finish: string | null;
  materialRoomId: string | null;
  materialCategory: string | null;
  materialQuantity: number | null;
  materialFinish: string | null;
  materialDimensions: string | null;
  materialInfoNotNeeded: boolean;
  materialInfoSkipApproved: boolean;
  materialExcludeFromMaterials: boolean;
};

type PageMaterialsSyncSnapshot = {
  version: 1;
  title: string;
  roomId: string | null;
  hidden: boolean;
  roomApprovalStatus: "approved" | "declined" | null;
  materialImages: PageMaterialsSyncImageSnapshot[];
};

type BoardPage = {
  id: string;
  title: string;
  roomId: string | null;
  hidden?: boolean;
  roomApprovalStatus?: "approved" | "declined";
  declinedMaterialItems?: Array<Record<string, unknown>>;
  presentationVisible?: boolean;
  materialsSyncFingerprint?: string;
  materialsSyncSnapshot?: PageMaterialsSyncSnapshot;
  materialsSyncedAt?: string;
  elements: BoardElement[];
};

type MissingMaterialInfoItem = {
  pageId: string;
  pageTitle: string;
  pageNumber: number;
  element: BoardElement;
  issues: string[];
  roomName: string;
};

type PresentationExtraPageSlot = {
  id: string;
  afterSlideKey: string;
  boardPageId: string | null;
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
  presentationExtraPages?: PresentationExtraPageSlot[];
  presentationSlideOrder?: string[];
  presentationHiddenSlideKeys?: string[];
  presentationRenderingOverrides?: Record<string, string>;
  presentationHiddenSections?: Record<string, string[]>;
  presentationSlidePicks?: Record<string, unknown>;
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
  | { kind: "move-page"; pageId: string; direction: "left" | "right" }
  | { kind: "delete-page"; pageId: string }
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
  style?: CSSProperties;
};

const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const BOARD_EXPORT_PIXEL_RATIO = 2;
const MAIN_PAGE_GAP = 40;
const ACTIVE_PAGE_PRELOAD_RADIUS = 1;
const PAGE_STRIP_VIRTUALIZE_AFTER = 40;
const PAGE_THUMBNAIL_SLOT_WIDTH = 124;
const PAGE_THUMBNAIL_OVERSCAN = 4;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.25;
const AUTOSAVE_DELAY_MS = 700;
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
  "Cabinetry",
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
  const itemCategory = normalizeItemCategory(item.category);
  if (itemCategory) return itemCategory;
  return inferredMaterialItemCategory(item);
}

type PageMaterialsSyncStatus = "not-applicable" | "not-tracked" | "current" | "changed";

function hashMaterialsSnapshot(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function createPageMaterialsSyncSnapshot(page: BoardPage): PageMaterialsSyncSnapshot {
  const materialImages: PageMaterialsSyncImageSnapshot[] = page.elements
    .filter((element) => element.type === "image")
    .map((element) => ({
      id: element.id,
      src: element.src ?? null,
      label: element.label ?? null,
      notes: element.notes ?? null,
      link: element.link ?? null,
      materialLinkCleared: element.materialLinkCleared === true,
      productId: element.productId ?? null,
      productName: element.productName ?? null,
      finish: element.finish ?? null,
      materialRoomId: element.materialRoomId ?? null,
      materialCategory: element.materialCategory ?? null,
      materialQuantity: element.materialQuantity ?? null,
      materialFinish: element.materialFinish ?? null,
      materialDimensions: element.materialDimensions ?? null,
      materialInfoNotNeeded: element.materialInfoNotNeeded === true,
      materialInfoSkipApproved: element.materialInfoSkipApproved === true,
      materialExcludeFromMaterials: element.materialExcludeFromMaterials === true,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    version: 1,
    title: page.title,
    roomId: page.roomId,
    hidden: page.hidden === true,
    roomApprovalStatus: page.roomApprovalStatus ?? null,
    materialImages,
  };
}

function materialsSyncSnapshotFingerprint(snapshot: PageMaterialsSyncSnapshot) {
  return `v1:${hashMaterialsSnapshot(
    JSON.stringify({
      title: snapshot.title,
      roomId: snapshot.roomId,
      hidden: snapshot.hidden,
      roomApprovalStatus: snapshot.roomApprovalStatus,
      materialImages: snapshot.materialImages,
    }),
  )}`;
}

function pageMaterialsSyncFingerprint(page: BoardPage) {
  return materialsSyncSnapshotFingerprint(createPageMaterialsSyncSnapshot(page));
}

function pageMaterialsSyncStatus(page: BoardPage): PageMaterialsSyncStatus {
  const hasMaterialImages = page.elements.some(
    (element) => element.type === "image" && !element.materialExcludeFromMaterials,
  );
  if (!hasMaterialImages) return "not-applicable";
  if (!page.materialsSyncFingerprint) return "not-tracked";
  return page.materialsSyncFingerprint === pageMaterialsSyncFingerprint(page)
    ? "current"
    : "changed";
}

function describePageMaterialsChanges(
  previous: PageMaterialsSyncSnapshot | undefined,
  current: PageMaterialsSyncSnapshot,
  roomNameForId: (roomId: string | null) => string,
) {
  if (!previous) return [];
  const changes: string[] = [];
  const value = (entry: string | number | null) =>
    entry === null || entry === "" ? "Not set" : String(entry);

  if (previous.title !== current.title) {
    changes.push(`Page title changed from "${previous.title}" to "${current.title}".`);
  }
  if (previous.roomId !== current.roomId) {
    changes.push(
      `Page room changed from ${roomNameForId(previous.roomId)} to ${roomNameForId(current.roomId)}.`,
    );
  }
  if (previous.hidden !== current.hidden) {
    changes.push(
      current.hidden
        ? "Page was hidden and should be removed from project Materials."
        : "Page was restored and should be included in project Materials.",
    );
  }
  if (previous.roomApprovalStatus !== current.roomApprovalStatus) {
    changes.push(
      `Room option changed from ${value(previous.roomApprovalStatus)} to ${value(
        current.roomApprovalStatus,
      )}.`,
    );
  }

  const previousById = new Map(previous.materialImages.map((item) => [item.id, item] as const));
  const currentById = new Map(current.materialImages.map((item) => [item.id, item] as const));
  const itemName = (item: PageMaterialsSyncImageSnapshot) =>
    item.label || item.productName || "Unlabeled item";

  for (const item of current.materialImages) {
    const before = previousById.get(item.id);
    if (!before) {
      changes.push(`Added ${itemName(item)}.`);
      continue;
    }
    const beforeName = itemName(before);
    const afterName = itemName(item);
    const name = afterName || beforeName;
    const itemChanges: string[] = [];
    const addValueChange = (
      label: string,
      beforeValue: string | number | null,
      afterValue: string | number | null,
    ) => {
      if (beforeValue === afterValue) return;
      itemChanges.push(`${label} changed from ${value(beforeValue)} to ${value(afterValue)}`);
    };

    addValueChange("label", before.label, item.label);
    addValueChange("product", before.productName, item.productName);
    addValueChange("category", before.materialCategory, item.materialCategory);
    addValueChange("quantity", before.materialQuantity, item.materialQuantity);
    addValueChange(
      "finish",
      before.materialFinish || before.finish,
      item.materialFinish || item.finish,
    );
    addValueChange("dimensions", before.materialDimensions, item.materialDimensions);
    if (before.materialRoomId !== item.materialRoomId) {
      itemChanges.push(
        `room changed from ${roomNameForId(before.materialRoomId)} to ${roomNameForId(
          item.materialRoomId,
        )}`,
      );
    }
    if (before.src !== item.src) itemChanges.push("image changed");
    if (before.link !== item.link || before.materialLinkCleared !== item.materialLinkCleared) {
      itemChanges.push("product link changed");
    }
    if (before.notes !== item.notes) itemChanges.push("notes changed");
    if (before.materialExcludeFromMaterials !== item.materialExcludeFromMaterials) {
      itemChanges.push(
        item.materialExcludeFromMaterials
          ? "excluded from Materials"
          : "included in Materials",
      );
    }
    if (
      before.productId !== item.productId &&
      before.productName === item.productName
    ) {
      itemChanges.push("connected catalog product changed");
    }
    if (
      before.materialInfoNotNeeded !== item.materialInfoNotNeeded ||
      before.materialInfoSkipApproved !== item.materialInfoSkipApproved
    ) {
      itemChanges.push("material review setting changed");
    }
    if (!itemChanges.length && JSON.stringify(before) !== JSON.stringify(item)) {
      itemChanges.push("material details changed");
    }
    if (itemChanges.length) changes.push(`${name}: ${itemChanges.join("; ")}.`);
  }

  for (const item of previous.materialImages) {
    if (!currentById.has(item.id)) changes.push(`Removed ${itemName(item)}.`);
  }

  return changes;
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
  const pendingSaveJsonRef = useRef<string | null>(null);
  const localEditShieldUntilRef = useRef(0);
  const removingBackgroundRef = useRef(false);
  const autoBackgroundRemovalIdsRef = useRef<Set<string>>(new Set());
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
  const [croppingElementId, setCroppingElementId] = useState<string | null>(null);
  const [toolsPinned, setToolsPinned] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentTagIds, setCommentTagIds] = useState<string[]>([]);
  const [contractorQuestionOpen, setContractorQuestionOpen] = useState(false);
  const [contractorQuestion, setContractorQuestion] = useState("");
  const [contractorQuestionSending, setContractorQuestionSending] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee>(null);
  const [boardScale, setBoardScale] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ItemCategory | "All">("All");
  const [removingBackground, setRemovingBackground] = useState(false);
  const [autoBackgroundRemovalPulse, setAutoBackgroundRemovalPulse] = useState(0);
  const [sendingMaterialId, setSendingMaterialId] = useState<string | null>(null);
  const [bulkMaterialScope, setBulkMaterialScope] = useState<"page" | "board" | null>(null);
  const [pendingMaterialSend, setPendingMaterialSend] = useState<{
    scope: "page" | "board";
    pageIds: string[];
  } | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [activeUsers, setActiveUsers] = useState<ActiveBoardUser[]>([]);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [saveStatus, setSaveStatus] = useState<
    "local" | "loading" | "ready" | "saving" | "saved" | "error"
  >("loading");
  const [thumbnailViewport, setThumbnailViewport] = useState({ scrollLeft: 0, width: 0 });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [missingInfoOpen, setMissingInfoOpen] = useState(false);
  const [materialsChangesOpen, setMaterialsChangesOpen] = useState(false);
  const [pageTransferOpen, setPageTransferOpen] = useState(false);
  const [pageTransferMode, setPageTransferMode] = useState<"duplicate" | "move">("duplicate");
  const [destinationProjectId, setDestinationProjectId] = useState("");
  const [destinationRoomId, setDestinationRoomId] = useState("");
  const [transferringPage, setTransferringPage] = useState(false);
  const [materialInfoReviewPageIds, setMaterialInfoReviewPageIds] = useState<string[] | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const deepLinkedCommentKeyRef = useRef("");

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const canEditDesignBoards =
    profile?.is_active === true && isStudioTeamRole(profile.role);
  const canRestoreDesignBoards = profile?.is_active === true && profile.role === "Admin";
  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.getProject(id),
  });
  const canViewDesignBoards =
    profile?.is_active === true &&
    project != null &&
    canViewProjectSurface(profile, project, "designBoards");
  const canAskDesignBoardQuestion =
    profile?.is_active === true && isContractorRole(profile.role) && canViewDesignBoards;
  const canDownloadBoardPdf = canDownloadDesignBoardPdf(profile, project);
  const {
    data: sharedBoard,
    isLoading: loadingSharedBoard,
    refetch: refetchSharedBoard,
  } = useQuery({
    queryKey: ["designBoard", id],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in first.");
      const response = await fetch(
        `/api/shared-design-board?projectId=${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const payload = (await response.json().catch(() => null)) as {
        board?: Awaited<ReturnType<typeof db.getDesignBoard>>;
        error?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not load design board.");
      return payload?.board ?? null;
    },
    enabled: canViewDesignBoards,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms", id],
    queryFn: async () => sortRoomsAlphabetically((await db.listRooms(id)) ?? []),
  });
  const { data: pageTransferProjects = [] } = useQuery({
    queryKey: ["designBoardTransferProjects"],
    queryFn: async () => (await db.listProjects()) ?? [],
    enabled: canEditDesignBoards && pageTransferOpen,
  });
  const { data: destinationRooms = [], isLoading: loadingDestinationRooms } = useQuery({
    queryKey: ["designBoardTransferRooms", destinationProjectId],
    queryFn: async () => sortRoomsAlphabetically((await db.listRooms(destinationProjectId)) ?? []),
    enabled: canEditDesignBoards && pageTransferOpen && Boolean(destinationProjectId),
  });
  const { data: products = [] } = useQuery({
    queryKey: ["catalog", search],
    queryFn: async () => (await db.listCatalog(search)) ?? [],
    enabled: canEditDesignBoards,
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
  const { data: designBoardVersions = [] } = useQuery({
    queryKey: ["designBoardVersions", id],
    queryFn: async () => (await db.listDesignBoardVersions(id)) ?? [],
    enabled: canRestoreDesignBoards && historyOpen,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
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
  const materialsSyncStatusByPageId = useMemo(
    () =>
      new Map(
        pages.map((page) => [page.id, pageMaterialsSyncStatus(page)] as const),
      ),
    [pages],
  );
  const activePageMaterialsSyncStatus =
    materialsSyncStatusByPageId.get(activePage.id) ?? "not-applicable";
  const changedMaterialsPages = useMemo(
    () =>
      pages.filter(
        (page) => materialsSyncStatusByPageId.get(page.id) === "changed",
      ),
    [materialsSyncStatusByPageId, pages],
  );
  const visiblePages = useMemo(() => pages.filter((page) => page.hidden !== true), [pages]);
  const hiddenPageCount = pages.length - visiblePages.length;
  const visiblePagesWithImages = useMemo(
    () => visiblePages.filter((page) => page.elements.some((element) => element.type === "image")),
    [visiblePages],
  );
  const [pageTitleDraft, setPageTitleDraft] = useState(activePage.title ?? "");
  const selectedVersionRecord = useMemo(
    () =>
      previewVersionId
        ? (designBoardVersions.find((version) => version.version_id === previewVersionId) ?? null)
        : (designBoardVersions[0] ?? null),
    [designBoardVersions, previewVersionId],
  );
  const { data: selectedVersionFull = null, isFetching: loadingVersionPreview } = useQuery({
    queryKey: ["designBoardVersion", selectedVersionRecord?.version_id],
    queryFn: async () =>
      selectedVersionRecord ? await db.getDesignBoardVersion(selectedVersionRecord.version_id) : null,
    enabled: canRestoreDesignBoards && historyOpen && Boolean(selectedVersionRecord?.version_id),
    staleTime: 30_000,
  });
  const selectedVersionPreview = useMemo(() => {
    if (!selectedVersionFull) return null;
    return normalizeBoardState(selectedVersionFull.board_state_snapshot);
  }, [selectedVersionFull]);
  const selectedVersionPreviewPage =
    selectedVersionPreview?.pages.find(
      (page) => page.id === selectedVersionPreview.selectedPageId,
    ) ??
    selectedVersionPreview?.pages[0] ??
    null;
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
  const selectedImageElements = useMemo(
    () => selectedElements.filter((element) => element.type === "image"),
    [selectedElements],
  );
  const selectedImageTargets = selectedImageElements.length
    ? selectedImageElements
    : selected?.type === "image"
      ? [selected]
      : [];
  const selectedImagesExcludedFromMaterials =
    selectedImageTargets.length > 0 &&
    selectedImageTargets.every((element) => element.materialExcludeFromMaterials);
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

  useEffect(() => {
    setPageTitleDraft(activePage.title ?? "");
  }, [activePage.id, activePage.title]);

  useEffect(() => {
    if (typeof window === "undefined" || !canEditDesignBoards || !activePage?.id) return;
    window.postMessage(
      {
        type: "MERAV_STUDIO_BOARD_DESTINATION",
        projectId: id,
        boardPageId: activePage.id,
        boardPageTitle: activePage.title,
      },
      window.location.origin,
    );
  }, [activePage?.id, activePage?.title, canEditDesignBoards, id]);

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
  const sortedRooms = useMemo(
    () => sortRoomsAlphabetically(rooms),
    [rooms],
  );
  const sortedPageTransferProjects = useMemo(
    () =>
      pageTransferProjects
        .filter((candidate) => candidate.id !== id)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
        ),
    [id, pageTransferProjects],
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product] as const)),
    [products],
  );
  const materialById = useMemo(
    () => new Map(materialItems.map((item) => [item.id, item] as const)),
    [materialItems],
  );
  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room] as const)), [rooms]);
  const activePageMaterialsChanges = useMemo(
    () =>
      describePageMaterialsChanges(
        activePage.materialsSyncSnapshot,
        createPageMaterialsSyncSnapshot(activePage),
        (roomId) => (roomId ? roomById.get(roomId)?.name || "Unknown room" : "No room"),
      ),
    [activePage, roomById],
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
      const hasStaleCopiedMaterialRoom =
        Boolean(page.roomId) &&
        Boolean(element.materialItemId) &&
        Boolean(element.materialRoomId) &&
        element.materialRoomId !== page.roomId;
      const assignedRoomId = hasStaleCopiedMaterialRoom
        ? page.roomId
        : element.materialRoomId || page.roomId;
      if (assignedRoomId) {
        return rooms.find((candidate) => candidate.id === assignedRoomId) ?? null;
      }
      return inferRoomFromPageTitle(page.title, rooms);
    },
    [rooms],
  );
  const imageMaterialReadinessIssues = useCallback(
    (element: BoardElement, page: BoardPage) => {
      if (element.type === "image" && element.materialExcludeFromMaterials) return [];
      const issues = imageMaterialIssues(
        element,
        element.productId ? productById.get(element.productId) : null,
      );
      if (
        element.type === "image" &&
        !resolveMaterialRoom(element, page)
      ) {
        issues.push("room");
      }
      return issues;
    },
    [productById, resolveMaterialRoom],
  );
  const activePageMissingInfoCount = imageElements.filter(
    (element) => imageMaterialReadinessIssues(element, activePage).length,
  ).length;
  const boardMissingInfoCount = visiblePages.reduce(
    (total, page) =>
      total +
      page.elements.filter(
        (element) => element.type === "image" && imageMaterialReadinessIssues(element, page).length,
      ).length,
    0,
  );
  const materialInfoItemsForPages = useCallback(
    (targetPages: BoardPage[]) =>
      targetPages.flatMap((page) => {
        const pageIndex = pages.findIndex((candidate) => candidate.id === page.id);
        const pageNumber = pageIndex >= 0 ? pageIndex + 1 : 1;
        return page.elements.flatMap((element) => {
          if (element.type !== "image") return [];
          const issues = imageMaterialReadinessIssues(element, page);
          if (!issues.length) return [];
          const room = resolveMaterialRoom(element, page);
          return [
            {
              pageId: page.id,
              pageTitle: page.title || `Board ${pageNumber}`,
              pageNumber,
              element,
              issues,
              roomName: room?.name ?? "No room assigned",
            },
          ];
        });
      }),
    [imageMaterialReadinessIssues, pages, resolveMaterialRoom],
  );
  const missingMaterialInfoItems = useMemo(
    () => materialInfoItemsForPages(visiblePages),
    [materialInfoItemsForPages, visiblePages],
  );
  const pendingMaterialSendPages = useMemo(() => {
    if (!pendingMaterialSend) return [];
    const pageIds = new Set(pendingMaterialSend.pageIds);
    return pages.filter((page) => pageIds.has(page.id));
  }, [pages, pendingMaterialSend]);
  const pendingMaterialIssues = useMemo(
    () => materialInfoItemsForPages(pendingMaterialSendPages),
    [materialInfoItemsForPages, pendingMaterialSendPages],
  );
  const materialInfoReviewItems = useMemo(() => {
    if (!materialInfoReviewPageIds) return missingMaterialInfoItems;
    const pageIds = new Set(materialInfoReviewPageIds);
    return materialInfoItemsForPages(pages.filter((page) => pageIds.has(page.id)));
  }, [materialInfoItemsForPages, materialInfoReviewPageIds, missingMaterialInfoItems, pages]);
  const pendingMaterialIssueCounts = useMemo(() => {
    const counts = { label: 0, link: 0, room: 0 };
    for (const item of pendingMaterialIssues) {
      for (const issue of item.issues) {
        if (issue === "label" || issue === "link" || issue === "room") {
          counts[issue] += 1;
        }
      }
    }
    return counts;
  }, [pendingMaterialIssues]);
  const allBoardDetailsHidden =
    imageElements.length > 0 && imageElements.every((element) => element.hideDetails);

  const exportBoardPdf = useCallback(async () => {
    if (exportingPdf) return;
    const exportPages = visiblePages.length ? visiblePages : [];
    if (!exportPages.length) {
      toast.error("No visible design board pages to export.");
      return;
    }
    setExportingPdf(true);
    try {
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "px",
        format: [BOARD_WIDTH, BOARD_HEIGHT],
        compress: true,
      });

      for (let index = 0; index < exportPages.length; index += 1) {
        if (index > 0) pdf.addPage([BOARD_WIDTH, BOARD_HEIGHT], "landscape");
        const pageDataUrl = await renderDesignBoardPageToDataUrl(
          exportPages[index],
          BOARD_EXPORT_PIXEL_RATIO,
        );
        pdf.addImage(pageDataUrl, "PNG", 0, 0, BOARD_WIDTH, BOARD_HEIGHT, undefined, "SLOW");
      }

      pdf.save(`${sanitizeFileName(project?.name || "design-board")}-design-boards.pdf`);
      toast.success(`Exported ${exportPages.length} design board page${exportPages.length === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("[Design Board] PDF export failed", error);
      toast.error(error instanceof Error ? error.message : "Could not export design board PDF.");
    } finally {
      setExportingPdf(false);
    }
  }, [exportingPdf, project?.name, visiblePages]);

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
        try {
          const savedBoard = await db.insertDesignBoard(id, stateToSave, profile?.id);
          if (savedBoard?.updated_at) lastRemoteUpdatedAtRef.current = savedBoard.updated_at;
          return { savedBoard, savedJson: saveJson, savedState: stateToSave };
        } catch {
          const newestBoard = await db.getDesignBoard(id);
          if (newestBoard?.board_state) {
            const newestJson = JSON.stringify(
              prepareBoardStateForSave(normalizeBoardState(newestBoard.board_state)),
            );
            if (newestJson === saveJson) {
              markRemoteBoardApplied(saveJson, newestBoard.updated_at);
              return { savedBoard: newestBoard, savedJson: saveJson, savedState: stateToSave };
            }
            applySharedBoardSnapshot(newestBoard, undefined, { preserveSelectedPage: true });
          }
          throw new Error("Design board changed in another tab before this save finished.");
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
        const latestState = normalizeBoardState(latestBoard.board_state);
        const latestBoardContentJson = JSON.stringify(stripPresentationStateForCompare(latestState));
        const lastGoodBoardContentJson = JSON.stringify(
          stripPresentationStateForCompare(lastGoodBoardStateRef.current),
        );
        if (latestBoard.updated_at && latestBoardContentJson === lastGoodBoardContentJson) {
          const mergedState = prepareBoardStateForSave(
            mergeLatestPresentationState(stateToSave, latestState),
          );
          const mergedJson = JSON.stringify(mergedState);
          const mergedBoard = await db.updateDesignBoardIfFresh(
            id,
            mergedState,
            latestBoard.updated_at,
            profile?.id,
          );
          if (mergedBoard?.updated_at) {
            lastRemoteUpdatedAtRef.current = mergedBoard.updated_at;
            return { savedBoard: mergedBoard, savedJson: mergedJson, savedState: mergedState };
          }
        }
        const latestJson = JSON.stringify(
          prepareBoardStateForSave(latestState),
        );
        if (latestJson === saveJson) {
          markRemoteBoardApplied(saveJson, latestBoard.updated_at);
          return { savedBoard: latestBoard, savedJson: saveJson, savedState: stateToSave };
        }
        applySharedBoardSnapshot(latestBoard, undefined, { preserveSelectedPage: true });
      }
      throw new Error("Design board changed in another tab before this save finished.");
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

  const markPagesMaterialsSynced = useCallback(
    (pageIds: string[]) => {
      const pageIdSet = new Set(pageIds);
      const materialsSyncedAt = new Date().toISOString();
      applyLocalBoardUpdate((current) => ({
        ...current,
        pages: current.pages.map((page) => {
          if (!pageIdSet.has(page.id)) return page;
          const materialsSyncSnapshot = createPageMaterialsSyncSnapshot(page);
          const patch = {
            materialsSyncFingerprint: materialsSyncSnapshotFingerprint(materialsSyncSnapshot),
            materialsSyncSnapshot,
            materialsSyncedAt,
          };
          if (!applyingRemoteRef.current) {
            broadcastPatch({ kind: "patch-page", pageId: page.id, patch });
          }
          return { ...page, ...patch };
        }),
      }));
    },
    [applyLocalBoardUpdate, broadcastPatch],
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
    setActiveUsers([]);
    setSaveStatus("loading");
    setHistoryOpen(false);
    setMissingInfoOpen(false);
    setMaterialInfoReviewPageIds(null);
    setPreviewVersionId(null);
    setFocusedCommentId(null);
    deepLinkedCommentKeyRef.current = "";
  }, [id]);

  useEffect(() => {
    if (!designBoardVersions.length) {
      setPreviewVersionId(null);
      return;
    }
    if (
      previewVersionId &&
      designBoardVersions.some((version) => version.version_id === previewVersionId)
    ) {
      return;
    }
    setPreviewVersionId(designBoardVersions[0].version_id);
  }, [designBoardVersions, previewVersionId]);

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
    if (!canViewDesignBoards || loadingProfile) return;

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
  }, [canViewDesignBoards, id, loadingProfile, queryClient, refetchSharedBoard]);

  useEffect(() => {
    boardStateRef.current = boardState;
  }, [boardState]);

  useEffect(() => {
    if (loadingProfile || loadingSharedBoard) return;
    if (sharedBoard?.board_state) {
      const remoteUpdatedAt = sharedBoard.updated_at ?? "";
      const hasNewerRemoteBoard =
        !remoteLoadedRef.current || remoteUpdatedAt !== lastRemoteUpdatedAtRef.current;
      if (hasNewerRemoteBoard) {
        applySharedBoardSnapshot(sharedBoard, undefined, {
          preserveSelectedPage: remoteLoadedRef.current,
        });
      } else setSaveStatus((current) => (current === "loading" ? "ready" : current));
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
    canViewDesignBoards,
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
      const latestState = boardStateRef.current;
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
  }, [boardState, canEditDesignBoards, saveBoardStateSafely]);

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

  const startImageCrop = (element: BoardElement, pageId = selectedPageId) => {
    if (element.type !== "image") return;
    selectPage(pageId, false, false);
    selectOnly(element.id);
    if (croppingElementId !== element.id) {
      pushUndo();
      setElementsForPage(pageId, (current) =>
        current.map((candidate) =>
          candidate.id === element.id
            ? {
                ...candidate,
                imageCropZoom: candidate.imageCropZoom ?? 1,
                imageCropX: candidate.imageCropX ?? 0,
                imageCropY: candidate.imageCropY ?? 0,
              }
            : candidate,
        ),
      );
    }
    setCroppingElementId(element.id);
  };

  const updateImageCrop = (
    elementId: string,
    patch: Partial<BoardElement>,
    pageId = selectedPageId,
  ) => {
    setElementsForPage(pageId, (current) =>
      current.map((element) => (element.id === elementId ? { ...element, ...patch } : element)),
    );
  };

  const sendElementToMaterials = async (
    element: BoardElement,
    page: BoardPage,
    sortOrderOverride?: number,
    quantityOverride?: number,
    options: { allowMissingInfo?: boolean } = {},
  ): Promise<SendMaterialResult> => {
    if (element.type !== "image") return { status: "skipped" };
    if (element.materialExcludeFromMaterials) return { status: "skipped" };
    const room = resolveMaterialRoom(element, page);
    if (!room) {
      return { status: "skipped" };
    }

    const linkedProduct = element.productId ? productById.get(element.productId) ?? null : null;
    const missingInfo = imageMaterialIssues(element, linkedProduct);
    if (missingInfo.length && !options.allowMissingInfo) {
      return { status: "skipped" };
    }
    const itemLabel = imageMaterialLabelForSend(element);

    const linkedProductUrl = linkedProduct?.product_url?.trim() || null;
    const productUrl = boardElementProductUrlForMaterialSync(element, linkedProduct);
    const inferredMaterialCategory = inferMaterialCategory(itemLabel, productUrl);
    const materialCategory = element.materialCategory || inferredMaterialCategory;
    let category: ProductCategory =
      linkedProduct?.category ||
      toProductCategory(element.materialCategory || inferredMaterialCategory);
    const finish = element.materialFinish || element.finish || null;
    const dimensions = element.materialDimensions || linkedProduct?.dimensions || null;
    const vendor = inferVendorFromUrl(productUrl) || linkedProduct?.vendor || null;
    // Use the exact image currently visible on the board. If a user restores the
    // original before sending to materials, the catalog should follow that choice
    // instead of keeping an older background-removed cutout.
    const productImageUrl = element.src || element.backgroundRemovedUrl || null;
    const quantity =
      quantityOverride && quantityOverride > 0
        ? quantityOverride
        : element.materialQuantity && element.materialQuantity > 0
          ? element.materialQuantity
          : 1;

    const actualProductName = element.productName?.trim() || itemLabel;
    const linkedProductNameMatches =
      linkedProduct &&
      normalizeMaterialIdentityText(linkedProduct.name) ===
        normalizeMaterialIdentityText(actualProductName);
    const productVariantMatches = (candidate?: Product | null) => {
      if (!candidate) return false;
      const candidateFinish = normalizeMaterialIdentityText(candidate.finish);
      const nextFinish = normalizeMaterialIdentityText(finish);
      if (nextFinish && candidateFinish && candidateFinish !== nextFinish) return false;

      const candidateDimensions = normalizeMaterialIdentityText(candidate.dimensions);
      const nextDimensions = normalizeMaterialIdentityText(dimensions);
      if (nextDimensions && candidateDimensions && candidateDimensions !== nextDimensions) {
        return false;
      }

      return true;
    };

    let product =
      linkedProduct &&
      linkedProductNameMatches &&
      (!productUrl || !linkedProductUrl || linkedProductUrl === productUrl) &&
      productVariantMatches(linkedProduct)
        ? linkedProduct
        : null;
    if (productUrl && !product) {
      const productCandidates =
        (await db.findProductsByUrlAndName(productUrl, actualProductName)) ?? [];
      product = productCandidates.find(productVariantMatches) ?? null;
    }

    if (!product) {
      product = await db.createProduct({
        name: actualProductName,
        category,
        vendor: vendor || null,
        product_url: productUrl,
        image_url: productImageUrl,
        finish,
        dimensions,
      });
    } else {
      category = product.category || category;
      const productPatch: Partial<Product> = {};
      if (!product.product_url && productUrl) productPatch.product_url = productUrl;
      if (vendor && product.vendor !== vendor) productPatch.vendor = vendor;
      if (!product.finish && finish) productPatch.finish = finish;
      if (dimensions && product.dimensions !== dimensions) productPatch.dimensions = dimensions;
      if (Object.keys(productPatch).length) {
        product = await db.updateProduct(product.id, productPatch);
      }
    }
    if (!product) throw new Error("Could not create catalog product.");

    const materialIdentity = buildBoardMaterialIdentity({
      roomId: room.id,
      label: itemLabel,
      productUrl,
      color: finish,
      dimensions,
    });
    const materialMatchesIdentity = (item: MaterialItem) =>
      buildBoardMaterialIdentity({
        roomId: item.room_id,
        label: item.item_label,
        productUrl: item.product_url,
        color: item.color,
        dimensions: item.product?.dimensions,
      }) === materialIdentity;
    const materialMatchesIdentityIgnoringUrl = (item: MaterialItem) =>
      item.room_id === room.id &&
      normalizeMaterialIdentityText(item.item_label) ===
        normalizeMaterialIdentityText(itemLabel) &&
      normalizeMaterialIdentityText(item.color) === normalizeMaterialIdentityText(finish) &&
      normalizeMaterialIdentityText(item.product?.dimensions) ===
        normalizeMaterialIdentityText(dimensions);
    const materialFromElementId = element.materialItemId
      ? materialItems.find((item) => item.id === element.materialItemId) ?? null
      : null;
    const matchingMaterial = materialItems.find(materialMatchesIdentity) ?? null;
    // Board layers can outlive/replace materials. If a layer points at a material
    // whose label/link/color no longer matches, ignore that stale id so a sink
    // cannot overwrite a countertop row (or vice versa).
    const existingMaterialId =
      materialFromElementId &&
      (materialMatchesIdentity(materialFromElementId) ||
        (element.materialLinkCleared && materialMatchesIdentityIgnoringUrl(materialFromElementId)))
        ? materialFromElementId.id
        : matchingMaterial?.id || null;
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
    const finalMaterialCategory = existingMaterial?.category || materialCategory;
    const materialPatch: Omit<MaterialItem, "id" | "created_at" | "updated_at" | "product"> = {
      room_id: room.id,
      project_id: id,
      item_label: itemLabel,
      client_product_name: buildClientProductName(room.name, itemLabel),
      category: finalMaterialCategory,
      is_required: false,
      sort_order: sortOrder,
      cad_label: null,
      product_url: productUrl,
      quantity,
      color: finish,
      image_url: productImageUrl,
      notes: element.notes || null,
      not_needed: false,
      product_id: product.id,
      source_board_id: sharedBoard?.project_id ?? null,
      source_board_page_id: page.id,
      source_board_element_id: element.id,
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
      let { data, error } = await supabase
        .from("material_items")
        .insert(materialPatch)
        .select("*, product:products(*)")
        .single();
      if (error?.code === "42703" && error.message?.includes("image_url")) {
        const { image_url: _imageUrl, ...legacyMaterialPatch } = materialPatch;
        ({ data, error } = await supabase
          .from("material_items")
          .insert(legacyMaterialPatch)
          .select("*, product:products(*)")
          .single());
      }
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
              link: element.materialLinkCleared ? "" : product.product_url || element.link || "",
              materialLinkCleared: element.materialLinkCleared,
              materialItemId: materialItem?.id ?? element.materialItemId ?? null,
              materialRoomId: room.id,
              materialCategory: finalMaterialCategory,
              materialQuantity: quantity,
              materialFinish: finish,
              materialDimensions: dimensions,
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
    if (selected.materialExcludeFromMaterials) {
      toast.error("This image is excluded from Materials.");
      return;
    }
    const room = resolveMaterialRoom(selected, activePage);
    if (!room) {
      toast.error("Choose a room before sending this to Materials.");
      return;
    }

    const missingInfo = imageMaterialReadinessIssues(selected, activePage);
    if (missingInfo.length) {
      toast.error(`Review ${joinMissingInfo(missingInfo)} before sending this to Materials.`);
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

  const sendMaterialsForPages = async (
    targetPages: BoardPage[],
    scope: "page" | "board",
    options: { proceedWithMissing?: boolean } = {},
  ) => {
    const unresolvedItems = materialInfoItemsForPages(targetPages);
    if (unresolvedItems.length && !options.proceedWithMissing) {
      setPendingMaterialSend({ scope, pageIds: targetPages.map((page) => page.id) });
      toast.error(
        `${unresolvedItems.length} item${unresolvedItems.length === 1 ? "" : "s"} need material review before final specs.`,
      );
      return;
    }
    setPendingMaterialSend(null);
    setBulkMaterialScope(scope);
    try {
      let sent = 0;
      let removed = 0;
      let skipped = 0;
      const skippedReasons = { label: 0, link: 0, room: 0 };
      const nextSortOrderByRoom = new Map<string, number>();
      const syncedMaterialIds = new Set<string>();
      const protectedMaterialIds = new Set<string>();
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
          if (element.materialExcludeFromMaterials) continue;
          if (element.materialItemId) protectedMaterialIds.add(element.materialItemId);
          const room = resolveMaterialRoom(element, page);
          const missingInfo = imageMaterialReadinessIssues(element, page);
          if (!room || (missingInfo.length && !options.proceedWithMissing)) {
            for (const issue of missingInfo) {
              if (issue === "label" || issue === "link" || issue === "room") {
                skippedReasons[issue] += 1;
              }
            }
            skipped += 1;
            continue;
          }
          const itemLabel = imageMaterialLabelForSend(element);
          const linkedProduct = element.productId
            ? productById.get(element.productId) ?? null
            : null;
          const productUrl = boardElementProductUrlForMaterialSync(element, linkedProduct) ?? "";
          const finish = (element.materialFinish || element.finish || "").trim();
          const dimensions = (
            element.materialDimensions ||
            linkedProduct?.dimensions ||
            ""
          ).trim();
          const key = [
            room.id,
            normalizeMaterialIdentityText(itemLabel),
            normalizeMaterialIdentityUrl(productUrl),
            normalizeMaterialIdentityText(finish),
            normalizeMaterialIdentityText(dimensions),
          ].join("::");
          const quantity =
            element.materialQuantity && element.materialQuantity > 0 ? element.materialQuantity : 1;
          const existing = groups.get(key);
          if (existing) {
            existing.elements.push({ page, element });
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
        // Repeated products across multiple pages for the same room are references, not extra qty.
        // Duplicates on the same page still count, but don't multiply by a prior synced total.
        const elementsByPage = new Map<string, BoardElement[]>();
        for (const { page, element } of group.elements) {
          elementsByPage.set(page.id, [...(elementsByPage.get(page.id) ?? []), element]);
        }
        const pageQuantities = Array.from(elementsByPage.values()).map((pageElements) => {
          if (pageElements.length > 1) return pageElements.length;
          const quantity = pageElements[0]?.materialQuantity;
          return quantity && quantity > 0 ? quantity : 1;
        });
        group.quantity = Math.max(1, ...pageQuantities);
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
          { allowMissingInfo: options.proceedWithMissing },
        );
        if (result.status === "sent") {
          sent += 1;
          if (result.materialItemId) syncedMaterialIds.add(result.materialItemId);
          const groupElementIds = new Set(group.elements.map(({ element }) => element.id));
          const duplicateMaterialIds = Array.from(
            new Set(
              group.elements
                .map(({ element }) => element.materialItemId)
                .filter((materialItemId): materialItemId is string =>
                  Boolean(materialItemId && materialItemId !== result.materialItemId),
                ),
            ),
          ).filter((materialItemId) => {
            const duplicateMaterial = materialItems.find((item) => item.id === materialItemId);
            return Boolean(
              duplicateMaterial?.source_board_element_id &&
                groupElementIds.has(duplicateMaterial.source_board_element_id),
            );
          });
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
                      materialDimensions: element.materialDimensions,
                    }
                  : candidate,
              ),
            );
          }
        } else {
          skipped += group.elements.length;
        }
      }
      const cleanupPageIds =
        scope === "board"
          ? new Set(pages.map((page) => page.id))
          : new Set(targetPages.map((page) => page.id));
      const staleMaterialItems = materialItems.filter(
        (item) =>
          item.source_board_page_id &&
          cleanupPageIds.has(item.source_board_page_id) &&
          !syncedMaterialIds.has(item.id) &&
          !protectedMaterialIds.has(item.id),
      );
      const staleMaterialIds = new Set(staleMaterialItems.map((item) => item.id));
      const roomProductIdsToRemove = new Set<string>();
      for (const item of staleMaterialItems) {
        await db.deleteMaterialItem(item.id);
        if (item.room_product?.id && item.product_id) {
          const stillUsed = materialItems.some(
            (candidate) =>
              candidate.id !== item.id &&
              !staleMaterialIds.has(candidate.id) &&
              candidate.room_id === item.room_id &&
              candidate.product_id === item.product_id,
          );
          if (!stillUsed) roomProductIdsToRemove.add(item.room_product.id);
        }
        removed += 1;
      }
      for (const roomProductId of roomProductIdsToRemove) {
        await db.removeRoomProduct(roomProductId);
      }
      if (skipped === 0) {
        markPagesMaterialsSynced(
          scope === "board" ? pages.map((page) => page.id) : targetPages.map((page) => page.id),
        );
      }
      if (removed) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["materialItems", id] }),
          queryClient.invalidateQueries({ queryKey: ["procurement"] }),
        ]);
      }
      if (sent || removed) {
        const skippedReasonText = formatSkippedMaterialReasons(skippedReasons);
        toast.success(
          `${sent ? `Synced ${sent} ${sent === 1 ? "item" : "items"}` : "Updated Materials"}${
            removed ? ` and removed ${removed} stale ${removed === 1 ? "item" : "items"}` : ""
          }${skipped ? `, skipped ${skipped}${skippedReasonText}.` : "."}`,
        );
      } else if (skipped === 0) {
        toast.success("Materials are up to date.");
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
    if (!visiblePagesWithImages.length) {
      toast.error("No visible design board pages with images to send.");
      return;
    }
    void sendMaterialsForPages(visiblePagesWithImages, "board");
  };

  const proceedWithPendingMaterialSend = () => {
    if (!pendingMaterialSend) return;
    setPendingMaterialSend(null);
    void sendMaterialsForPages(pendingMaterialSendPages, pendingMaterialSend.scope, {
      proceedWithMissing: true,
    });
  };

  const reviewPendingMaterialSend = () => {
    setMaterialInfoReviewPageIds(pendingMaterialSend?.pageIds ?? null);
    setPendingMaterialSend(null);
    setMissingInfoOpen(true);
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

  const createCommentTodos = async (comment: BoardComment, targetLabel: string) => {
    if (comment.taggedUserIds.length === 0) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in to assign comment to-dos.");

      const res = await fetch("/api/design-board-comment-todos", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: id,
          commentId: comment.id,
          pageId: comment.pageId,
          targetType: comment.targetType,
          targetId: comment.targetId,
          pageTitle: activePage.title,
          targetLabel,
          comment: comment.body,
          taggedUserIds: comment.taggedUserIds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not assign comment to-do.");
      queryClient.invalidateQueries({ queryKey: ["myAssignedTodos"] });
    } catch (error) {
      console.error("Assign design board comment to-do failed", error);
      toast.error("Comment saved, but the dashboard to-do could not be assigned.");
    }
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
    void createCommentTodos(comment, commentTarget.label);
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
    const linkedProduct = element.productId ? productById.get(element.productId) ?? null : null;
    const nextLink = window.prompt(
      "Product link",
      boardElementProductUrl(element, linkedProduct) || "",
    );
    if (nextLink === null) return;
    const trimmedLink = nextLink.trim();
    updateElement(element.id, { link: trimmedLink, materialLinkCleared: trimmedLink === "" }, pageId);
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
      pages: [...safePages.slice(0, insertAt), nextPage, ...safePages.slice(insertAt)],
    });
    pushUndo();
    applyLocalBoardUpdate(nextState);
    broadcastPatch({ kind: "upsert-page", page: nextPage, afterPageId });
    pendingPageFocusRef.current = nextPage.id;
    clearSelection();
    void saveBoardStateImmediately(nextState);
  };

  const movePage = (pageId: string, direction: "left" | "right") => {
    const current = normalizeBoardState(boardStateRef.current);
    const safePages = current.pages.length ? current.pages : defaultPages();
    const pageIndex = safePages.findIndex((page) => page.id === pageId);
    if (pageIndex < 0) return;
    const targetIndex = direction === "left" ? pageIndex - 1 : pageIndex + 1;
    if (targetIndex < 0 || targetIndex >= safePages.length) return;

    const reorderedPages = [...safePages];
    const [movedPage] = reorderedPages.splice(pageIndex, 1);
    reorderedPages.splice(targetIndex, 0, movedPage);

    const nextState = normalizeBoardState({
      ...current,
      pages: reorderedPages,
      selectedPageId: pageId,
    });

    pushUndo();
    applyLocalBoardUpdate(nextState);
    broadcastPatch({ kind: "move-page", pageId, direction });
    pendingPageFocusRef.current = pageId;
    void saveBoardStateImmediately(nextState);
  };

  const deletePage = (pageId: string) => {
    const current = normalizeBoardState(boardStateRef.current);
    const safePages = current.pages.length ? current.pages : defaultPages();
    const pageIndex = safePages.findIndex((page) => page.id === pageId);
    if (pageIndex < 0) return;
    if (safePages.length <= 1) {
      toast.error("A design board needs at least one page.");
      return;
    }

    const pageTitle = safePages[pageIndex]?.title || `Board ${pageIndex + 1}`;
    const confirmed = window.confirm(
      `Delete "${pageTitle}"? This removes the page and everything on it.`,
    );
    if (!confirmed) return;

    const nextPages = safePages.filter((page) => page.id !== pageId);
    const nextSelectedPageId =
      safePages[pageIndex - 1]?.id ?? safePages[pageIndex + 1]?.id ?? nextPages[0]?.id;
    const nextState = normalizeBoardState({
      ...current,
      pages: nextPages,
      selectedPageId: nextSelectedPageId ?? nextPages[0].id,
      comments: (current.comments ?? []).filter((comment) => comment.pageId !== pageId),
      presentationExtraPages: (current.presentationExtraPages ?? []).filter(
        (slot) => slot.boardPageId !== pageId,
      ),
    });

    pushUndo();
    clearSelection();
    applyLocalBoardUpdate(nextState);
    broadcastPatch({ kind: "delete-page", pageId });
    pendingPageFocusRef.current = nextState.selectedPageId;
    void saveBoardStateImmediately(nextState);
  };

  const transferActivePage = async () => {
    if (!canEditDesignBoards || !destinationProjectId || transferringPage) return;
    const sourcePageId = activePage.id;
    setTransferringPage(true);
    setSaveStatus("saving");

    try {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
      const sourceSnapshot = prepareBoardStateForSave(boardStateRef.current);
      const sourceSnapshotJson = JSON.stringify(sourceSnapshot);
      let savedSourceState = sourceSnapshot;
      if (sourceSnapshotJson !== lastSavedJsonRef.current) {
        const sourceSave = await saveBoardStateSafely(sourceSnapshot);
        savedSourceState = sourceSave.savedState;
        lastSavedJsonRef.current = sourceSave.savedJson;
        lastGoodBoardStateRef.current = sourceSave.savedState;
        if (sourceSave.savedBoard) {
          queryClient.setQueryData(["designBoard", id], sourceSave.savedBoard);
        }
      }

      const sourcePage = savedSourceState.pages.find((page) => page.id === sourcePageId);
      if (!sourcePage) throw new Error("That page changed before it could be transferred.");
      const transferredPage = createTransferredBoardPage(sourcePage, destinationRoomId || null);

      let destinationSaved = false;
      for (let attempt = 0; attempt < 3 && !destinationSaved; attempt += 1) {
        const destinationBoard = await db.getDesignBoard(destinationProjectId);
        if (!destinationBoard) {
          try {
            await db.insertDesignBoard(
              destinationProjectId,
              prepareBoardStateForSave({
                pages: [transferredPage],
                selectedPageId: transferredPage.id,
                presentationExtraPages: [],
                comments: [],
              }),
              profile?.id,
            );
            destinationSaved = true;
          } catch (error) {
            const boardCreatedElsewhere = await db.getDesignBoard(destinationProjectId);
            if (!boardCreatedElsewhere) throw error;
          }
          continue;
        }

        const destinationState = normalizeBoardState(destinationBoard.board_state);
        const replaceDefaultPage = isUntouchedDefaultBoard(destinationState);
        const nextDestinationState = prepareBoardStateForSave({
          ...destinationState,
          pages: replaceDefaultPage
            ? [transferredPage]
            : [...destinationState.pages, transferredPage],
          selectedPageId: replaceDefaultPage ? transferredPage.id : destinationState.selectedPageId,
        });
        destinationSaved = Boolean(
          await db.updateDesignBoardIfFresh(
            destinationProjectId,
            nextDestinationState,
            destinationBoard.updated_at,
            profile?.id,
          ),
        );
      }

      if (!destinationSaved) {
        throw new Error(
          "The destination board changed while this page was being added. Try again.",
        );
      }

      await queryClient.invalidateQueries({
        queryKey: ["designBoard", destinationProjectId],
      });

      if (pageTransferMode === "move") {
        const latestSource = normalizeBoardState(boardStateRef.current);
        const sourcePageIndex = latestSource.pages.findIndex((page) => page.id === sourcePageId);
        if (sourcePageIndex < 0) {
          throw new Error(
            "The page was copied, but it had already been removed from this project.",
          );
        }

        const remainingPages = latestSource.pages.filter((page) => page.id !== sourcePageId);
        const replacementPage: BoardPage | null = remainingPages.length
          ? null
          : {
              id: crypto.randomUUID(),
              title: "Design Board 1",
              roomId: null,
              elements: [],
            };
        const nextPages = replacementPage ? [replacementPage] : remainingPages;
        const nextSelectedPageId =
          latestSource.pages[sourcePageIndex - 1]?.id ??
          latestSource.pages[sourcePageIndex + 1]?.id ??
          nextPages[0].id;
        const nextSourceState = normalizeBoardState({
          ...latestSource,
          pages: nextPages,
          selectedPageId: nextSelectedPageId,
          comments: (latestSource.comments ?? []).filter(
            (comment) => comment.pageId !== sourcePageId,
          ),
          presentationExtraPages: (latestSource.presentationExtraPages ?? []).filter(
            (slot) => slot.boardPageId !== sourcePageId,
          ),
        });

        try {
          const sourceMoveSave = await saveBoardStateSafely(nextSourceState);
          pushUndo();
          applyLocalBoardUpdate(sourceMoveSave.savedState);
          boardStateRef.current = sourceMoveSave.savedState;
          lastGoodBoardStateRef.current = sourceMoveSave.savedState;
          markRemoteBoardApplied(sourceMoveSave.savedJson, sourceMoveSave.savedBoard?.updated_at);
          if (sourceMoveSave.savedBoard) {
            queryClient.setQueryData(["designBoard", id], sourceMoveSave.savedBoard);
          }
          broadcastPatch({ kind: "restore-state", state: sourceMoveSave.savedState });
          pendingPageFocusRef.current = sourceMoveSave.savedState.selectedPageId;
          clearSelection();
        } catch {
          setSaveStatus("error");
          toast.warning(
            "The page was duplicated to the other project, but could not be removed here. No source data was deleted.",
          );
          setPageTransferOpen(false);
          return;
        }
      }

      setSaveStatus("saved");
      const destinationProject = sortedPageTransferProjects.find(
        (candidate) => candidate.id === destinationProjectId,
      );
      toast.success(
        `Page ${pageTransferMode === "move" ? "moved" : "duplicated"} to ${destinationProject?.name ?? "the selected project"}.`,
      );
      setPageTransferOpen(false);
      setDestinationProjectId("");
      setDestinationRoomId("");
      setPageTransferMode("duplicate");
    } catch (error) {
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Could not transfer this page.");
    } finally {
      setTransferringPage(false);
    }
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
        pageIndex * PAGE_THUMBNAIL_SLOT_WIDTH -
          strip.clientWidth / 2 +
          PAGE_THUMBNAIL_SLOT_WIDTH / 2,
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
    if (typeof window === "undefined" || !canViewDesignBoards || loadingProfile) return;
    const params = new URLSearchParams(window.location.search);
    const pageId = params.get("page")?.trim();
    const elementId = params.get("element")?.trim();
    const commentId = params.get("comment")?.trim();
    if (!pageId || !commentId) return;
    const key = `${pageId}:${elementId ?? ""}:${commentId}`;
    if (deepLinkedCommentKeyRef.current === key) return;
    const targetPage = pages.find((page) => page.id === pageId);
    if (!targetPage) return;

    deepLinkedCommentKeyRef.current = key;
    setFocusedCommentId(commentId);
    setToolsPinned(true);
    setMissingInfoOpen(false);
    selectPage(pageId, true, false);

    const targetElement = elementId
      ? targetPage.elements.find((element) => element.id === elementId)
      : null;
    if (targetElement) {
      selectOnly(targetElement.id);
    } else {
      clearSelection();
    }

    window.setTimeout(() => {
      if (elementId) {
        document
          .querySelector(`[data-board-element-id="${CSS.escape(elementId)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
      document
        .getElementById(`board-comment-${commentId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }, [canViewDesignBoards, clearSelection, loadingProfile, pages, selectOnly, selectedPageId]);

  const reviewMissingMaterialInfoItem = (pageId: string, elementId: string) => {
    selectPage(pageId, true, false);
    selectOnly(elementId);
    setMissingInfoOpen(false);
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

  const updatePage = (pageId: string, patch: Partial<BoardPage>) => {
    const nextPatch = patch.hidden === true ? { ...patch, presentationVisible: false } : patch;
    pushUndo();
    applyLocalBoardUpdate((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === pageId ? { ...page, ...nextPatch } : page,
      ),
    }));
    broadcastPatch({ kind: "patch-page", pageId, patch: nextPatch });
  };

  const updateActivePage = (patch: Partial<BoardPage>) => {
    updatePage(selectedPageId, patch);
  };

  const updateActivePageRoom = (roomId: string) => {
    const selectedRoom = sortedRooms.find((room) => room.id === roomId);
    const patch: Partial<BoardPage> = selectedRoom
      ? { roomId: selectedRoom.id, title: selectedRoom.name }
      : { roomId: null };
    if (selectedRoom) setPageTitleDraft(selectedRoom.name);
    updateActivePage(patch);
  };

  const restoreVersion = useCallback(
    async (version: DesignBoardVersionMeta) => {
      if (!canRestoreDesignBoards) return;
      const fullVersion = await db.getDesignBoardVersion(version.version_id);
      if (!fullVersion) throw new Error("Could not load that version.");
      const restored = normalizeBoardState(fullVersion.board_state_snapshot);
      const savedBoard = await db.restoreDesignBoardVersion(fullVersion, profile?.id);
      if (!savedBoard) throw new Error("Could not restore that version.");
      pushUndo();
      applyLocalBoardUpdate(restored);
      boardStateRef.current = restored;
      lastGoodBoardStateRef.current = restored;
      const restoredJson = JSON.stringify(prepareBoardStateForSave(restored));
      markRemoteBoardApplied(restoredJson, savedBoard.updated_at);
      queryClient.setQueryData(["designBoard", id], savedBoard);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["designBoard", id] }),
        queryClient.invalidateQueries({ queryKey: ["designBoardVersions", id] }),
      ]);
      broadcastPatch({ kind: "restore-state", state: restored });
      clearSelection();
      setSaveStatus("saved");
      toast.success("Design board restored from version history.");
    },
    [
      applyLocalBoardUpdate,
      broadcastPatch,
      canRestoreDesignBoards,
      id,
      profile?.id,
      pushUndo,
      queryClient,
    ],
  );

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
      materialItemId: null,
      materialRoomId: null,
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

  const rotateSelectedImage = () => {
    if (!selected || selectedCount !== 1 || selected.type !== "image") return;
    const nextRotation = ((selected.rotation ?? 0) + 90) % 360;
    updateElement(selected.id, { rotation: nextRotation });
  };

  const toggleSelectedMaterialExclusion = () => {
    if (!selectedImageTargets.length) return;
    const targetIds = new Set(selectedImageTargets.map((element) => element.id));
    const nextValue = !selectedImagesExcludedFromMaterials;
    pushUndo();
    setElements((current) =>
      current.map((element) =>
        targetIds.has(element.id)
          ? { ...element, materialExcludeFromMaterials: nextValue }
          : element,
      ),
    );
    toast.success(
      nextValue
        ? `${selectedImageTargets.length} image${selectedImageTargets.length === 1 ? "" : "s"} excluded from Materials.`
        : `${selectedImageTargets.length} image${selectedImageTargets.length === 1 ? "" : "s"} included in Materials again.`,
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
    if (!canEditDesignBoards) return;
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
        materialItemId: null,
        materialRoomId: null,
      }));
      setElements((current) => [...current, ...copyItems]);
      selectMany(copyItems.map((copyItem) => copyItem.id));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFile, canEditDesignBoards, elements, pushUndo, selectMany, setElements]);

  useEffect(() => {
    if (!canEditDesignBoards) return;
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
          materialItemId: null,
          materialRoomId: null,
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
    canEditDesignBoards,
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
      const cutout = shouldUseLocalSmartBackgroundRemoval()
        ? await removeSmartProductBackground(source)
        : await removeFlatImageBackground(source);
      const uploadedCutout = await uploadDesignBoardImage(
        cutout,
        id,
        `${selected.label || "cutout"}.png`,
      );
      localEditShieldUntilRef.current = Date.now() + 6000;
      setElementsForPage(targetPageId, (current) =>
        current.map((element) =>
          element.id === targetId
            ? { ...element, originalSrc, src: uploadedCutout, fastBackgroundRemovalTried: true }
            : element,
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

  const removeSelectedBackgroundWithOpenAI = async () => {
    if (!selected || selected.type !== "image" || !selected.src) return;
    if (!selected.fastBackgroundRemovalTried) {
      window.alert("Try the free Remove BG first. AI Remove BG unlocks after that if the cutout needs help.");
      return;
    }
    if (!selected.bestFreeBackgroundRemovalTried) {
      window.alert(
        "Try Better Free BG before using paid AI credits. It uses a higher-quality free model from the original image.",
      );
      return;
    }
    if (
      !window.confirm(
        "AI Remove BG uses paid OpenAI credits. Use it only if both free background removers did not work well enough.",
      )
    ) {
      return;
    }
    const targetId = selected.id;
    const targetPageId = selectedPageId;
    const originalSrc = selected.originalSrc || selected.src;
    pushUndo();
    removingBackgroundRef.current = true;
    localEditShieldUntilRef.current = Date.now() + 6000;
    setRemovingBackground(true);
    try {
      const uploadedCutout = await removeDesignBoardBackgroundWithOpenAI(
        originalSrc,
        id,
        `${selected.label || selected.productName || "ai-cutout"}.png`,
      );
      localEditShieldUntilRef.current = Date.now() + 6000;
      setElementsForPage(targetPageId, (current) =>
        current.map((element) =>
          element.id === targetId
            ? {
                ...element,
                originalSrc,
                src: uploadedCutout,
                backgroundRemovedUrl: uploadedCutout,
                fastBackgroundRemovalTried: true,
                bestFreeBackgroundRemovalTried: true,
                backgroundRemovalStatus: "complete",
              }
            : element,
        ),
      );
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "AI background removal failed. Try the fast remover instead.",
      );
    } finally {
      window.setTimeout(() => {
        removingBackgroundRef.current = false;
      }, 1500);
      setRemovingBackground(false);
    }
  };

  const removeSelectedBackgroundBestFree = async () => {
    if (!selected || selected.type !== "image" || !selected.src) return;
    if (!selected.fastBackgroundRemovalTried) {
      window.alert("Try the fast free Remove BG first. Better Free BG unlocks after that.");
      return;
    }
    const targetId = selected.id;
    const targetPageId = selectedPageId;
    const originalSrc = selected.originalSrc || selected.src;
    pushUndo();
    removingBackgroundRef.current = true;
    localEditShieldUntilRef.current = Date.now() + 6000;
    setRemovingBackground(true);
    try {
      const source = await imageSourceForCanvas(originalSrc);
      const cutout = await removeHighQualityFreeImageBackground(source);
      const uploadedCutout = await uploadDesignBoardImage(
        cutout,
        id,
        `${selected.label || selected.productName || "better-free-cutout"}.png`,
      );
      localEditShieldUntilRef.current = Date.now() + 6000;
      setElementsForPage(targetPageId, (current) =>
        current.map((element) =>
          element.id === targetId
            ? {
                ...element,
                originalSrc,
                src: uploadedCutout,
                backgroundRemovedUrl: uploadedCutout,
                fastBackgroundRemovalTried: true,
                bestFreeBackgroundRemovalTried: true,
                backgroundRemovalStatus: "complete",
              }
            : element,
        ),
      );
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Better Free BG failed. You can still restore original or use the paid AI option.",
      );
    } finally {
      window.setTimeout(() => {
        removingBackgroundRef.current = false;
      }, 1500);
      setRemovingBackground(false);
    }
  };

  useEffect(() => {
    if (!canEditDesignBoards || loadingSharedBoard || removingBackgroundRef.current) return;

    let pending: {
      pageId: string;
      element: BoardElement;
    } | null = null;

    for (const page of pages) {
      const element = page.elements.find(
        (candidate) =>
          candidate.type === "image" &&
          candidate.autoRemoveBackground &&
          !candidate.backgroundRemovedUrl &&
          Boolean(candidate.originalSrc || candidate.src) &&
          !autoBackgroundRemovalIdsRef.current.has(candidate.id),
      );
      if (element) {
        pending = { pageId: page.id, element };
        break;
      }
    }

    if (!pending) return;

    const { pageId, element } = pending;
    const originalSrc = element.originalSrc || element.src;
    if (!originalSrc) return;

    autoBackgroundRemovalIdsRef.current.add(element.id);
    removingBackgroundRef.current = true;
    localEditShieldUntilRef.current = Date.now() + 6000;
    setElementsForPage(pageId, (current) =>
      current.map((candidate) =>
        candidate.id === element.id
          ? { ...candidate, backgroundRemovalStatus: "processing" }
          : candidate,
      ),
    );

    void (async () => {
      try {
        const source = await imageSourceForCanvas(originalSrc);
        const cutout = await removeFlatImageBackground(source);
        const uploadedCutout = await uploadDesignBoardImage(
          cutout,
          id,
          `${element.label || element.productName || "cutout"}.png`,
        );
        localEditShieldUntilRef.current = Date.now() + 6000;
        setElementsForPage(pageId, (current) =>
          current.map((candidate) =>
            candidate.id === element.id
              ? {
                  ...candidate,
                  originalSrc,
                  src: uploadedCutout,
                  backgroundRemovedUrl: uploadedCutout,
                  autoRemoveBackground: false,
                  fastBackgroundRemovalTried: true,
                  backgroundRemovalStatus: "complete",
                }
              : candidate,
          ),
        );
        if (element.productId) {
          await supabase
            .from("products")
            .update({ image_url: uploadedCutout } as any)
            .eq("id", element.productId);
          await queryClient.invalidateQueries({ queryKey: ["catalog"] });
        }
      } catch (error) {
        console.error("[Design Board] Automatic background removal failed", error);
        setElementsForPage(pageId, (current) =>
          current.map((candidate) =>
            candidate.id === element.id
              ? {
                  ...candidate,
                  autoRemoveBackground: false,
                  fastBackgroundRemovalTried: true,
                  backgroundRemovalStatus: "failed",
                }
              : candidate,
          ),
        );
      } finally {
        window.setTimeout(() => {
          removingBackgroundRef.current = false;
          autoBackgroundRemovalIdsRef.current.delete(element.id);
          setAutoBackgroundRemovalPulse((value) => value + 1);
        }, 1500);
      }
    })();
  }, [
    autoBackgroundRemovalPulse,
    canEditDesignBoards,
    id,
    loadingSharedBoard,
    pages,
    queryClient,
    setElementsForPage,
  ]);

  const restoreSelectedOriginal = () => {
    if (!selected || selected.type !== "image" || !selected.originalSrc) return;
    const targetId = selected.id;
    pushUndo();
    setElements((current) =>
      current.map((element) =>
        element.id === targetId
          ? { ...element, src: element.originalSrc, backgroundRemovedUrl: null }
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

  const submitContractorQuestion = async () => {
    const question = contractorQuestion.trim();
    if (!question) {
      toast.error("Add a question or comment first.");
      return;
    }
    setContractorQuestionSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in again to send a question.");
      const res = await fetch("/api/design-board-question", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: id,
          pageId: activePage.id,
          pageTitle: activePage.title,
          question,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not send question.");
      toast.success("Question sent to Ken/Katie.");
      setContractorQuestion("");
      setContractorQuestionOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send question.");
    } finally {
      setContractorQuestionSending(false);
    }
  };

  if (!project) {
    return (
      <AppShell>
        <div className="p-16 text-muted-foreground">Loading design boards...</div>
      </AppShell>
    );
  }

  if (!loadingProfile && !canViewDesignBoards) {
    return (
      <AppShell>
        <div className="p-16">
          <div className="eyebrow">Design Boards</div>
          <h1 className="mt-3 font-display text-5xl">Not ready to view yet</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
            Design boards are not currently shared for your role on this project.
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
              <div className="mt-3 text-xs uppercase tracking-[0.18em] text-stone-500">
                {saveStatus === "loading" && "Loading shared board"}
                {saveStatus === "ready" && "Shared board ready"}
                {saveStatus === "saving" && "Saving shared board"}
                {saveStatus === "saved" && "Shared board saved"}
                {saveStatus === "error" && "Could not save shared board"}
                {saveStatus === "local" && "Local-only view"}
              </div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-stone-500">
                Last updated {formatLastUpdated(sharedBoard?.updated_at ?? project.updated_at)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-600">
                  {onlineUsers.length
                    ? `${onlineUsers.length} online`
                    : canEditDesignBoards
                      ? "Live editing ready"
                      : "Read-only view"}
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
                {canEditDesignBoards && activePageMaterialsSyncStatus === "current" && (
                  <div
                    className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800"
                    title={`Last sent ${formatLastUpdated(activePage.materialsSyncedAt)}`}
                  >
                    Materials current
                  </div>
                )}
                {canEditDesignBoards && activePageMaterialsSyncStatus === "changed" && (
                  <button
                    type="button"
                    onClick={() => setMaterialsChangesOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 transition hover:border-amber-500 hover:bg-amber-100"
                    title={`Last sent ${formatLastUpdated(activePage.materialsSyncedAt)}`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Changed since Materials send
                  </button>
                )}
                {canEditDesignBoards && activePageMaterialsSyncStatus === "not-tracked" && (
                  <div className="rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700">
                    Send page once to track Materials changes
                  </div>
                )}
                {canEditDesignBoards && changedMaterialsPages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => selectPage(changedMaterialsPages[0].id)}
                    className="text-xs font-medium text-amber-900 underline-offset-4 hover:underline"
                  >
                    {changedMaterialsPages.length} pages need Materials update
                  </button>
                )}
                {canEditDesignBoards && boardMissingInfoCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMaterialInfoReviewPageIds(null);
                      setMissingInfoOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 transition hover:border-amber-500 hover:bg-amber-100"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {boardMissingInfoCount} need material info
                  </button>
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
                {canAskDesignBoardQuestion && (
                  <button
                    type="button"
                    onClick={() => setContractorQuestionOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-ink bg-ink px-3 py-1 text-xs font-medium text-white transition hover:bg-stone-800"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Ask Question
                  </button>
                )}
                {!canEditDesignBoards && canDownloadBoardPdf && (
                  <button
                    type="button"
                    onClick={exportBoardPdf}
                    disabled={exportingPdf || !pages.length}
                    className="inline-flex items-center gap-1.5 rounded-full border border-ink bg-white px-3 py-1 text-xs font-medium text-ink transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {exportingPdf ? "Preparing PDF..." : "Download PDF"}
                  </button>
                )}
              </div>
            </div>
            {canEditDesignBoards && (
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
                  <DraftFontSizeInput
                    ariaLabel="Text font size"
                    value={selected.fontSize ?? 24}
                    className="w-16 border-l border-stone-200 pl-2 text-sm outline-none"
                    onCommit={(fontSize) => updateElement(selected.id, { fontSize })}
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
              <ToolbarButton
                onClick={() => movePage(selectedPageId, "left")}
                disabled={selectedPageIndex <= 0}
              >
                Move Page Left
              </ToolbarButton>
              <ToolbarButton
                onClick={() => movePage(selectedPageId, "right")}
                disabled={selectedPageIndex < 0 || selectedPageIndex >= pages.length - 1}
              >
                Move Page Right
              </ToolbarButton>
              <ToolbarButton
                onClick={() => deletePage(selectedPageId)}
                disabled={pages.length <= 1}
                destructive
              >
                <Trash2 className="h-4 w-4" /> Delete Page
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
                onClick={rotateSelectedImage}
                disabled={!selected || selectedCount !== 1 || selected.type !== "image"}
              >
                <RotateCw className="h-4 w-4" /> Rotate
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
                onClick={removeSelectedBackgroundBestFree}
                disabled={
                  !selected ||
                  selectedCount !== 1 ||
                  selected.type !== "image" ||
                  removingBackground ||
                  !selected.fastBackgroundRemovalTried
                }
                title={
                  selected?.type === "image" && !selected.fastBackgroundRemovalTried
                    ? "Try Remove BG first. Better Free BG runs a larger free model after that."
                    : undefined
                }
              >
                <Scissors className="h-4 w-4" />{" "}
                {removingBackground
                  ? "Cutting..."
                  : selected?.type === "image" && !selected.fastBackgroundRemovalTried
                    ? "Better Free Locked"
                    : "Better Free BG"}
              </ToolbarButton>
              <ToolbarButton
                onClick={removeSelectedBackgroundWithOpenAI}
                disabled={
                  !selected ||
                  selectedCount !== 1 ||
                  selected.type !== "image" ||
                  removingBackground ||
                  !selected.bestFreeBackgroundRemovalTried
                }
                title={
                  selected?.type === "image" && !selected.bestFreeBackgroundRemovalTried
                    ? "Try Better Free BG before using paid AI credits."
                    : undefined
                }
              >
                <WandSparkles className="h-4 w-4" />{" "}
                {removingBackground
                  ? "Cutting..."
                  : selected?.type === "image" && !selected.bestFreeBackgroundRemovalTried
                    ? "AI Locked"
                    : "AI Remove BG"}
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
              <ToolbarButton
                onClick={() => {
                  if (!selected || selected.type !== "image") return;
                  if (croppingElementId === selected.id) setCroppingElementId(null);
                  else startImageCrop(selected);
                }}
                disabled={!selected || selectedCount !== 1 || selected.type !== "image"}
                title="Double-click an image or enter crop mode"
              >
                <Crop className="h-4 w-4" /> {croppingElementId === selected?.id ? "Done" : "Crop"}
              </ToolbarButton>
              <ToolbarButton onClick={toggleBoardDetails} disabled={!imageElements.length}>
                {allBoardDetailsHidden ? "Show Text / Links" : "Hide Text / Links"}
              </ToolbarButton>
              <ToolbarButton
                onClick={toggleSelectedMaterialExclusion}
                disabled={!selectedImageTargets.length}
                title="Keep selected image items out of Materials and Spec"
              >
                {selectedImagesExcludedFromMaterials ? "Include in Materials" : "Exclude from Materials"}
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
              <ToolbarButton onClick={exportBoardPdf} disabled={exportingPdf || !pages.length}>
                <Download className="h-4 w-4" />
                {exportingPdf ? "Exporting PDF..." : "Export PDF"}
              </ToolbarButton>
              <Link
                to="/projects/$id/design-board-presentation"
                params={{ id }}
                className="inline-flex items-center gap-2 border border-stone-300 bg-white px-4 py-2 text-sm transition hover:border-ink"
              >
                <LayoutTemplate className="h-4 w-4" /> Present Board
              </Link>
              {canRestoreDesignBoards && (
                <ToolbarButton onClick={() => setHistoryOpen(true)}>History</ToolbarButton>
              )}
              <ToolbarButton onClick={removeSelected} disabled={!selectedCount} destructive>
                <Trash2 className="h-4 w-4" /> Delete
              </ToolbarButton>
            </div>
            )}
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
                const pageHidden = page.hidden === true;

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
                      onDrop={(event) => {
                        if (canEditDesignBoards) handleBoardDrop(event, page.id);
                      }}
                      onDragOver={(event) => {
                        if (canEditDesignBoards) event.preventDefault();
                      }}
                      onPointerDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        selectPage(page.id, false, false);
                        if (!canEditDesignBoards) return;
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
                            editable={canEditDesignBoards}
                            showProductBadge={!isContractorRole(profile?.role)}
                            cropMode={croppingElementId === element.id}
                            linkedProduct={
                              element.productId ? productById.get(element.productId) ?? null : null
                            }
                            needsReselection={
                              element.materialItemId
                                ? materialById.get(element.materialItemId)?.room_product?.approval_status === "declined"
                                : false
                            }
                            selected={selectedIdSet.has(element.id)}
                            showResizeHandle={selectedCount <= 1}
                            remoteUsers={remoteSelections.get(`${page.id}:${element.id}`) ?? []}
                            commentCount={
                              commentCountsByElement.get(`${page.id}:${element.id}`) ?? 0
                            }
                            onQuickComment={() => {
                              if (canEditDesignBoards) quickCommentElement(element, page.id);
                            }}
                            onQuickLink={() => {
                              if (canEditDesignBoards) quickEditElementLink(element, page.id);
                            }}
                            onQuickLabel={() => {
                              if (canEditDesignBoards) quickEditElementLabel(element, page.id);
                            }}
                            onQuickFinish={() => {
                              if (canEditDesignBoards) quickEditElementFinish(element, page.id);
                            }}
                            onQuickDelete={() => {
                              if (canEditDesignBoards) quickDeleteElement(element, page.id);
                            }}
                            onSelect={(event) => {
                              if (croppingElementId && croppingElementId !== element.id) {
                                setCroppingElementId(null);
                              }
                              selectPage(page.id, false, false);
                              if (!canEditDesignBoards) return;
                              if (event.shiftKey || event.metaKey) {
                                toggleSelectedElement(element.id);
                              } else if (selectedCount > 1 && selectedIdSet.has(element.id)) {
                                setSelectedId(element.id);
                              } else {
                                selectOnly(element.id);
                              }
                            }}
                            onChange={(patch) => {
                              if (canEditDesignBoards) updateElement(element.id, patch, page.id);
                            }}
                            onEnterCrop={() => {
                              if (canEditDesignBoards) startImageCrop(element, page.id);
                            }}
                            onCropChange={(patch) => {
                              if (canEditDesignBoards) updateImageCrop(element.id, patch, page.id);
                            }}
                            onStartMove={(event) => {
                              if (!canEditDesignBoards) return;
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
                              if (!canEditDesignBoards) return;
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

                      {canEditDesignBoards && isActivePage && selectedBounds && selectedCount > 1 && (
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
                      {pageHidden && (
                        <div className="pointer-events-none absolute left-6 top-6 z-[999999] rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-amber-900 shadow-sm">
                          Hidden Page
                        </div>
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
                  const pageCanMoveLeft = index > 0;
                  const pageCanMoveRight = index < pages.length - 1;
                  const pageCanDelete = pages.length > 1;
                  const pageHidden = page.hidden === true;
                  const pageMaterialsStatus =
                    materialsSyncStatusByPageId.get(page.id) ?? "not-applicable";
                  return (
                    <div
                      key={page.id}
                      className={cn(
                        "group relative shrink-0 rounded-lg border bg-white p-0.5 text-left shadow-sm transition",
                        pageHidden && "opacity-55",
                        page.id === selectedPageId
                          ? "border-[#6d4cff] ring-2 ring-[#6d4cff]"
                          : "border-stone-200 hover:border-ink",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => selectPage(page.id)}
                        className="block"
                      >
                        <PageThumbnail
                          page={page}
                          pageNumber={index + 1}
                          renderImages={!virtualizeThumbnails || isNearSelected}
                        />
                      </button>
                      {pageHidden && (
                        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-amber-900">
                          Hidden
                        </div>
                      )}
                      {canEditDesignBoards && pageMaterialsStatus === "changed" && (
                        <div
                          className="pointer-events-none absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded border border-amber-300 bg-amber-50 text-amber-900 shadow-sm"
                          title="Changed since this page was sent to Materials"
                          aria-label="Changed since this page was sent to Materials"
                        >
                          <AlertTriangle className="h-3 w-3" />
                        </div>
                      )}
                      {canEditDesignBoards && pageMaterialsStatus === "not-tracked" && (
                        <div
                          className="pointer-events-none absolute left-1 top-1 h-2.5 w-2.5 rounded-full border border-stone-400 bg-white shadow-sm"
                          title="Send this page once to track Materials changes"
                          aria-label="Materials change tracking has not started for this page"
                        />
                      )}
                      {canEditDesignBoards && (
                        <div className="pointer-events-none absolute right-1 top-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() =>
                              updatePage(page.id, {
                                hidden: !pageHidden,
                              })
                            }
                            className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded border border-stone-200 bg-white/95 text-stone-700 shadow-sm transition hover:border-ink hover:text-ink"
                            aria-label={`${pageHidden ? "Show" : "Hide"} ${page.title || `Board ${index + 1}`}`}
                            title={pageHidden ? "Show page" : "Hide page"}
                          >
                            {pageHidden ? (
                              <Eye className="h-3.5 w-3.5" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => movePage(page.id, "left")}
                            disabled={!pageCanMoveLeft}
                            className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded border border-stone-200 bg-white/95 text-stone-700 shadow-sm transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label={`Move ${page.title || `Board ${index + 1}`} left`}
                            title="Move page left"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => movePage(page.id, "right")}
                            disabled={!pageCanMoveRight}
                            className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded border border-stone-200 bg-white/95 text-stone-700 shadow-sm transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label={`Move ${page.title || `Board ${index + 1}`} right`}
                            title="Move page right"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePage(page.id)}
                            disabled={!pageCanDelete}
                            className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded border border-red-200 bg-white/95 text-red-600 shadow-sm transition hover:border-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label={`Delete ${page.title || `Board ${index + 1}`}`}
                            title="Delete page"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {virtualizeThumbnails && (
                  <div
                    aria-hidden="true"
                    className="shrink-0"
                    style={{ width: thumbnailWindow.after }}
                  />
                )}
                {canEditDesignBoards && (
                  <button
                    type="button"
                    onClick={() => addPage(selectedPageId)}
                    title="Add page after current page"
                    className="flex h-[64px] w-[112px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white text-xs text-ink transition hover:border-ink"
                  >
                    <Plus className="h-3.5 w-3.5" /> New Page
                  </button>
                )}
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

          <Dialog open={materialsChangesOpen} onOpenChange={setMaterialsChangesOpen}>
            <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-display text-3xl font-normal">
                  Materials Changes
                </DialogTitle>
                <DialogDescription>
                  {activePage.title || `Board ${selectedPageIndex + 1}`} since Materials were last
                  sent {formatLastUpdated(activePage.materialsSyncedAt)}.
                </DialogDescription>
              </DialogHeader>

              {!activePage.materialsSyncSnapshot ? (
                <div className="border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">
                  Detailed change history starts after this page is sent to Materials again. The
                  page is still correctly marked as changed.
                </div>
              ) : activePageMaterialsChanges.length ? (
                <ul className="divide-y divide-stone-200 border-y border-stone-200">
                  {activePageMaterialsChanges.map((change, index) => (
                    <li key={`${index}-${change}`} className="flex gap-3 py-3 text-sm leading-6">
                      <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-700" />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-stone-600">
                  No material-relevant differences were found.
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog
            open={pageTransferOpen}
            onOpenChange={(open) => {
              if (transferringPage) return;
              setPageTransferOpen(open);
              if (!open) {
                setDestinationProjectId("");
                setDestinationRoomId("");
                setPageTransferMode("duplicate");
              }
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-display text-3xl font-normal">
                  Transfer Design Board Page
                </DialogTitle>
                <DialogDescription>
                  Send "{activePage.title || `Board ${selectedPageIndex + 1}`}" to another project.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-500">
                    Transfer Type
                  </div>
                  <div className="grid grid-cols-2 border border-stone-300 p-1">
                    <button
                      type="button"
                      onClick={() => setPageTransferMode("duplicate")}
                      className={cn(
                        "inline-flex items-center justify-center gap-2 px-3 py-2 text-sm transition",
                        pageTransferMode === "duplicate"
                          ? "bg-ink text-white"
                          : "bg-white text-stone-700 hover:bg-stone-50",
                      )}
                    >
                      <Copy className="h-4 w-4" />
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageTransferMode("move")}
                      className={cn(
                        "inline-flex items-center justify-center gap-2 px-3 py-2 text-sm transition",
                        pageTransferMode === "move"
                          ? "bg-ink text-white"
                          : "bg-white text-stone-700 hover:bg-stone-50",
                      )}
                    >
                      <ArrowRight className="h-4 w-4" />
                      Move
                    </button>
                  </div>
                </div>

                <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                  Destination Project
                  <select
                    value={destinationProjectId}
                    onChange={(event) => {
                      setDestinationProjectId(event.target.value);
                      setDestinationRoomId("");
                    }}
                    className="mt-1 w-full border border-stone-300 bg-white px-3 py-2.5 text-sm normal-case tracking-normal"
                  >
                    <option value="">Choose a project</option>
                    {sortedPageTransferProjects.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                        {candidate.client_name ? ` - ${candidate.client_name}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                  Room in Destination Project
                  <select
                    value={destinationRoomId}
                    onChange={(event) => setDestinationRoomId(event.target.value)}
                    disabled={!destinationProjectId || loadingDestinationRooms}
                    className="mt-1 w-full border border-stone-300 bg-white px-3 py-2.5 text-sm normal-case tracking-normal disabled:cursor-not-allowed disabled:bg-stone-100"
                  >
                    <option value="">
                      {loadingDestinationRooms ? "Loading rooms..." : "No room assigned"}
                    </option>
                    {destinationRooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="border border-stone-200 bg-stone-50 px-4 py-3 text-xs leading-relaxed text-stone-600">
                  The page layout and product details will transfer. Project-specific material rows,
                  approvals, comments, and presentation placement will stay with the original
                  project.
                </div>
                {pageTransferMode === "move" && (
                  <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
                    The original page is removed only after the destination project saves its copy.
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPageTransferOpen(false)}
                    disabled={transferringPage}
                    className="border border-stone-300 bg-white px-4 py-2 text-sm text-ink transition hover:border-ink disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void transferActivePage()}
                    disabled={!destinationProjectId || transferringPage}
                    className="inline-flex items-center justify-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pageTransferMode === "duplicate" ? (
                      <Copy className="h-4 w-4" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    {transferringPage
                      ? "Transferring..."
                      : pageTransferMode === "duplicate"
                        ? "Duplicate Page"
                        : "Move Page"}
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={pendingMaterialSend !== null}
            onOpenChange={(open) => {
              if (!open) setPendingMaterialSend(null);
            }}
          >
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="font-display text-3xl font-normal">
                  Some Items Need Review
                </DialogTitle>
                <DialogDescription>
                  {pendingMaterialIssues.length} item
                  {pendingMaterialIssues.length === 1 ? "" : "s"} on this{" "}
                  {pendingMaterialSend?.scope === "board" ? "board" : "page"} are missing material
                  info or need final approval. You can fix them now, or send the items anyway
                  and come back to this list later.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  Review needed before the final spec is clean
                </div>
                <div className="mt-2 text-xs leading-relaxed text-amber-800">
                  {formatSkippedMaterialReasons(pendingMaterialIssueCounts) ||
                    "Some images need material info."}
                </div>
              </div>
              <div className="max-h-72 divide-y divide-stone-100 overflow-y-auto border border-stone-200">
                {pendingMaterialIssues.slice(0, 8).map((item) => (
                  <div
                    key={`${item.pageId}:${item.element.id}`}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <div className="h-12 w-12 shrink-0 overflow-hidden bg-[#f6f3ee]">
                      {item.element.src ? (
                        <OptimizedBoardImage
                          src={normalizeSupabaseImageUrl(item.element.src)}
                          alt={imageMaterialLabel(item.element) || "Review item"}
                          kind="thumbnail"
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-stone-300">
                          IMG
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">
                        {imageMaterialLabel(item.element) || "Unlabeled item"}
                      </div>
                      <div className="mt-0.5 text-xs text-stone-500">
                        Page {item.pageNumber}: {item.pageTitle} · {item.roomName}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {item.issues.map((issue) => (
                        <span
                          key={issue}
                          className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-amber-900"
                        >
                          Missing {issue}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {pendingMaterialIssues.length > 8 && (
                  <div className="px-3 py-2 text-xs text-stone-500">
                    + {pendingMaterialIssues.length - 8} more in the review list
                  </div>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={reviewPendingMaterialSend}
                  className="inline-flex items-center justify-center border border-stone-300 bg-white px-4 py-2 text-sm transition hover:border-ink"
                >
                  Review Items
                </button>
                <button
                  type="button"
                  onClick={proceedWithPendingMaterialSend}
                  className="inline-flex items-center justify-center border border-ink bg-ink px-4 py-2 text-sm text-white transition hover:bg-stone-800"
                >
                  Send Items Anyway
                </button>
              </div>
            </DialogContent>
          </Dialog>

          <MissingMaterialInfoDialog
            open={missingInfoOpen && materialInfoReviewItems.length > 0}
            items={materialInfoReviewItems}
            rooms={sortedRooms}
            onOpenChange={(open) => {
              setMissingInfoOpen(open);
              if (!open) setMaterialInfoReviewPageIds(null);
            }}
            onUpdateItem={(pageId, elementId, patch) => updateElement(elementId, patch, pageId)}
            onShowOnBoard={reviewMissingMaterialInfoItem}
          />

          <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
            <DialogContent className="max-w-5xl">
              <DialogHeader>
                <DialogTitle className="font-display text-3xl font-normal">
                  Design Board History
                </DialogTitle>
                <DialogDescription>
                  Admin restore view. Every live board change now archives an immutable snapshot in
                  Supabase before the current board is changed.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
                <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
                  {designBoardVersions.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-sm text-stone-500">
                      No archived versions yet.
                    </div>
                  ) : (
                    designBoardVersions.map((version, index) => (
                      <button
                        key={version.version_id}
                        type="button"
                        onClick={() => setPreviewVersionId(version.version_id)}
                        className={cn(
                          "w-full rounded-lg border px-4 py-3 text-left transition",
                          selectedVersionRecord?.version_id === version.version_id
                            ? "border-ink bg-stone-50"
                            : "border-stone-200 bg-white hover:border-stone-400",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-ink">
                              Version {designBoardVersions.length - index}
                            </div>
                            <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-stone-500">
                              {version.save_type}
                            </div>
                          </div>
                          <div className="text-right text-xs text-stone-500">
                            {new Date(version.created_at).toLocaleString()}
                          </div>
                        </div>
                        {version.save_reason && (
                          <div className="mt-2 text-xs text-stone-600">{version.save_reason}</div>
                        )}
                      </button>
                    ))
                  )}
                </div>
                <div className="space-y-4">
                  {selectedVersionRecord && loadingVersionPreview ? (
                    <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-sm text-stone-500">
                      Loading version preview...
                    </div>
                  ) : selectedVersionRecord && selectedVersionPreview && selectedVersionPreviewPage ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-stone-500">
                            Preview
                          </div>
                          <div className="mt-1 text-sm text-stone-700">
                            {new Date(selectedVersionRecord.created_at).toLocaleString()} ·{" "}
                            {selectedVersionRecord.save_type}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void restoreVersion(selectedVersionRecord)}
                          className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-white transition hover:bg-stone-800"
                        >
                          Restore This Version
                        </button>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-[#f4f1ec] p-4">
                        <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-stone-500">
                          <span>{selectedVersionPreview.pages.length} pages archived</span>
                          <span>{selectedVersionPreviewPage.title}</span>
                        </div>
                        <div className="relative h-[420px] overflow-hidden rounded-lg bg-[#fbfaf7] shadow-[0_16px_40px_rgba(40,34,25,0.12)]">
                          <LightweightPagePreview
                            page={selectedVersionPreviewPage}
                            pageNumber={1}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-sm text-stone-500">
                      Choose a version to preview and restore.
                    </div>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {canEditDesignBoards && (
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
                    value={pageTitleDraft}
                    onChange={(event) => setPageTitleDraft(event.target.value)}
                    onBlur={() => updateActivePage({ title: pageTitleDraft })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    placeholder={`Design Board ${selectedPageIndex + 1}`}
                    className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
                  />
                </label>
                <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-stone-500">
                  Room
                  <select
                    value={activePage.roomId ?? ""}
                    onChange={(event) => updateActivePageRoom(event.target.value)}
                    className="mt-1 w-full border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                  >
                    <option value="">No room assigned</option>
                    {sortedRooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateActivePage({
                        hidden: activePage.hidden !== true,
                      })
                    }
                    className={cn(
                      "inline-flex items-center justify-center gap-2 border px-4 py-2 text-sm transition",
                      activePage.hidden === true
                        ? "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-500"
                        : "border-stone-300 bg-white text-ink hover:border-ink",
                    )}
                  >
                    {activePage.hidden === true ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                    {activePage.hidden === true ? "Show Page" : "Hide Page"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateActivePage({
                        presentationVisible: activePage.presentationVisible !== true,
                      })
                    }
                    disabled={activePage.hidden === true}
                    className={cn(
                      "inline-flex items-center justify-center gap-2 border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                      activePage.presentationVisible === true
                        ? "border-ink bg-ink text-white hover:bg-stone-800"
                        : "border-stone-300 bg-white text-ink hover:border-ink",
                    )}
                  >
                    <LayoutTemplate className="h-4 w-4" />
                    {activePage.presentationVisible === true
                      ? "In Presentation"
                      : "Add Page to Presentation"}
                  </button>
                  <Link
                    to="/projects/$id/design-board-presentation"
                    params={{ id }}
                    className="inline-flex items-center justify-center gap-2 border border-stone-300 bg-white px-4 py-2 text-sm text-ink transition hover:border-ink"
                  >
                    Present Design Board <ExternalLink className="h-4 w-4" />
                  </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setDestinationProjectId("");
                        setDestinationRoomId("");
                        setPageTransferMode("duplicate");
                        setPageTransferOpen(true);
                      }}
                      className="inline-flex items-center justify-center gap-2 border border-stone-300 bg-white px-4 py-2 text-sm text-ink transition hover:border-ink"
                    >
                      <Copy className="h-4 w-4" />
                      Transfer Page
                    </button>
                  <div className="text-[11px] leading-relaxed text-stone-500">
                    Hidden pages stay editable here, but are skipped when sending the full board to
                    Materials and exporting the design board PDF.
                  </div>
                </div>
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
                      Add label, link, and room for clean specs, approve no-label/no-link items, or
                      exclude items from Materials.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setMaterialInfoReviewPageIds([activePage.id]);
                        setMissingInfoOpen(true);
                      }}
                      className="mt-2 text-xs font-medium underline-offset-4 hover:underline"
                    >
                      Review missing items
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={sendFullBoardToMaterials}
                  disabled={
                    bulkMaterialScope !== null ||
                    !visiblePagesWithImages.length
                  }
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {bulkMaterialScope === "board"
                    ? "Sending Full Board..."
                    : "Send Full Board to Materials"}
                </button>
                {hiddenPageCount > 0 && (
                  <div className="mt-2 text-[11px] leading-relaxed text-stone-500">
                    {hiddenPageCount} hidden page{hiddenPageCount === 1 ? "" : "s"} will be removed from project materials.
                  </div>
                )}
              </div>

              <CommentsPanel
                comments={activePageComments}
                selectedComments={selectedTargetComments}
                focusedCommentId={focusedCommentId}
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
                  rooms={sortedRooms}
                  products={products}
                  activePageRoomId={activePage.roomId}
                  onUpdate={(patch) => updateElement(selected.id, patch)}
                  onSendToMaterials={sendSelectedToMaterials}
                  sendingToMaterials={sendingMaterialId === selected.id}
                  allBoardDetailsHidden={allBoardDetailsHidden}
                  onToggleBoardDetails={toggleBoardDetails}
                  onRemoveBackground={removeSelectedBackground}
                  onRemoveBackgroundBestFree={removeSelectedBackgroundBestFree}
                  onRemoveBackgroundWithOpenAI={removeSelectedBackgroundWithOpenAI}
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
                    <div className="space-y-3">
                      {filteredProjectMaterials.slice(0, 60).map((item) => (
                        <MaterialTrayItem key={item.id} item={item} />
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-3">
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
          )}

          <Dialog open={contractorQuestionOpen} onOpenChange={setContractorQuestionOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <div className="eyebrow mb-2">Design Board Question</div>
                <DialogTitle className="font-display text-4xl font-normal">
                  Send a note to MERAV
                </DialogTitle>
                <DialogDescription>
                  This will notify Ken and Katie on their Studio reminder list.
                </DialogDescription>
              </DialogHeader>
              <div className="border border-border bg-bone/20 p-4 text-sm text-muted-foreground">
                Page: <span className="font-medium text-ink">{activePage.title}</span>
              </div>
              <textarea
                value={contractorQuestion}
                onChange={(event) => setContractorQuestion(event.target.value)}
                rows={6}
                placeholder="Ask a question or leave a note about this page..."
                className="w-full border border-border bg-background p-3 text-sm outline-none focus:border-ink"
              />
              <button
                type="button"
                onClick={submitContractorQuestion}
                disabled={contractorQuestionSending}
                className="inline-flex items-center justify-center bg-ink px-5 py-2.5 text-sm text-primary-foreground disabled:opacity-60"
              >
                {contractorQuestionSending ? "Sending..." : "Send Question"}
              </button>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </AppShell>
  );
}

function LightweightPagePlaceholder({ page, pageNumber }: { page: BoardPage; pageNumber: number }) {
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
          src={normalizeSupabaseImageUrl(element.src)}
          alt=""
          kind="thumbnail"
          className="h-full w-full object-contain"
          draggable={false}
          loading="lazy"
          style={boardImageStyle(element)}
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
                  src={normalizeSupabaseImageUrl(element.src)}
                  alt=""
                  kind="thumbnail"
                  className="h-full w-full object-contain"
                  draggable={false}
                  loading="lazy"
                  style={boardImageStyle(element)}
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
  editable,
  showProductBadge,
  cropMode,
  linkedProduct,
  needsReselection,
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
  onEnterCrop,
  onCropChange,
  onStartMove,
  onStartResize,
}: {
  element: BoardElement;
  editable: boolean;
  showProductBadge: boolean;
  cropMode: boolean;
  linkedProduct?: Product | null;
  needsReselection: boolean;
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
  onEnterCrop: () => void;
  onCropChange: (patch: Partial<BoardElement>) => void;
  onStartMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const cropGestureRef = useRef<
    | {
        kind: "move" | "zoom";
        startClientX: number;
        startClientY: number;
        startX: number;
        startY: number;
        startZoom: number;
        frameWidth: number;
        frameHeight: number;
      }
    | null
  >(null);
  const isLocked = element.locked === true;
  const isHidden = element.visible === false;
  const remoteUser = remoteUsers[0];
  const materialIssues =
    element.type === "image" ? imageMaterialIssues(element, linkedProduct) : [];
  const elementLinkHref = externalHref(element.link);

  const startCropGesture = (
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    kind: "move" | "zoom",
  ) => {
    if (!cropMode) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.parentElement?.getBoundingClientRect() ??
      event.currentTarget.getBoundingClientRect();
    cropGestureRef.current = {
      kind,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.imageCropX ?? 0,
      startY: element.imageCropY ?? 0,
      startZoom: element.imageCropZoom ?? 1,
      frameWidth: Math.max(1, rect.width),
      frameHeight: Math.max(1, rect.height),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCropGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = cropGestureRef.current;
    if (!gesture) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - gesture.startClientX;
    const dy = event.clientY - gesture.startClientY;
    if (gesture.kind === "zoom") {
      const distance = (dx + dy) / Math.max(gesture.frameWidth, gesture.frameHeight);
      onCropChange({ imageCropZoom: clampNumber(gesture.startZoom + distance, 1, 3) });
      return;
    }
    onCropChange({
      imageCropX: clampNumber(gesture.startX + (dx / gesture.frameWidth) * 100, -50, 50),
      imageCropY: clampNumber(gesture.startY + (dy / gesture.frameHeight) * 100, -50, 50),
    });
  };

  const endCropGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropGestureRef.current) return;
    cropGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      data-board-object="editable"
      data-board-element-id={element.id}
      className={cn(
        "absolute select-none",
        selected && "outline outline-2 outline-offset-2 outline-[#1f4e5f]",
        remoteUser && !selected && "outline outline-2 outline-offset-2",
        editable && element.type !== "text" && !isLocked && "cursor-move",
        isLocked && "cursor-default",
      )}
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.zIndex,
        transform: element.type === "image" ? undefined : `rotate(${element.rotation ?? 0}deg)`,
        opacity: isHidden ? 0.22 : 1,
        outlineColor: remoteUser?.color,
      }}
      onPointerDown={(event) => {
        if (!editable) return;
        if (cropMode) return;
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
      {needsReselection && (
        <div className="pointer-events-none absolute left-2 top-2 z-30 inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-1 font-[var(--font-montserrat)] text-[10px] font-semibold uppercase tracking-[0.12em] text-red-800 shadow-sm">
          <AlertTriangle className="h-3 w-3" />
          Needs re-selection
        </div>
      )}
      {editable && selected && showResizeHandle && (
        <div
          className="absolute left-1/2 top-0 z-50 flex -translate-x-1/2 -translate-y-[calc(100%+14px)] items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-2 shadow-[0_10px_30px_rgba(31,29,27,0.18)]"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {element.link &&
            (elementLinkHref ? (
              <a
                href={elementLinkHref}
                target="_blank"
                rel="noreferrer"
                className="max-w-52 truncate px-2 font-[var(--font-montserrat)] text-sm text-blue-600 underline-offset-4 hover:underline"
                title={element.link}
              >
                {element.link}
              </a>
            ) : (
              <span
                className="max-w-52 truncate px-2 font-[var(--font-montserrat)] text-sm text-stone-600"
                title={element.link}
              >
                {element.link}
              </span>
            ))}
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
            <div
              className={cn(
                "relative h-full w-full",
                imageCropSettings(element).active && "overflow-hidden",
                cropMode && "cursor-grab touch-none",
              )}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (editable) onEnterCrop();
              }}
              onPointerDown={(event) => startCropGesture(event, "move")}
              onPointerMove={moveCropGesture}
              onPointerUp={endCropGesture}
              onPointerCancel={endCropGesture}
            >
              <OptimizedBoardImage
                src={normalizeSupabaseImageUrl(element.src)}
                alt={element.label ?? ""}
                kind="preview"
                className="h-full w-full object-contain"
                draggable={false}
                style={boardImageStyle(element, { includeRotation: true })}
              />
              {cropMode && (
                <>
                  <div className="pointer-events-none absolute inset-0 border-2 border-[#1f4e5f] shadow-[0_0_0_9999px_rgba(31,29,27,0.26)]">
                    <div className="absolute left-2 top-2 bg-[#1f4e5f] px-2 py-1 font-[var(--font-montserrat)] text-[10px] uppercase tracking-[0.14em] text-white">
                      Drag to reposition
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Drag to zoom crop"
                    title="Drag to zoom"
                    onPointerDown={(event) => startCropGesture(event, "zoom")}
                    className="absolute -bottom-2 -right-2 z-20 h-5 w-5 cursor-se-resize border-2 border-[#1f4e5f] bg-white shadow-sm"
                  />
                </>
              )}
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center border border-dashed border-stone-300 bg-[#faf9f5] p-4 text-center font-display text-2xl text-stone-400">
              {element.label || element.productName || "Image"}
            </div>
          )}
          {!element.hideDetails &&
            (element.label || element.productName) &&
            (elementLinkHref ? (
              <a
                href={elementLinkHref}
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
          {!element.hideDetails && showProductBadge && element.productId && (
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

function ImageAdjustmentSlider({
  label,
  value,
  min,
  max,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-3 block text-xs uppercase tracking-[0.18em] text-stone-500 last:mb-0">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="font-[var(--font-montserrat)] text-[11px] normal-case tracking-normal text-stone-600">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[#1f4e5f]"
      />
    </label>
  );
}

function imageAdjustmentStyle(element: BoardElement): CSSProperties | undefined {
  const brightness = clampNumber(element.imageBrightness ?? 100, 50, 150);
  const contrast = clampNumber(element.imageContrast ?? 100, 50, 150);
  const saturation = clampNumber(element.imageSaturation ?? 100, 0, 200);
  const warmth = clampNumber(element.imageWarmth ?? 0, -50, 50);

  if (brightness === 100 && contrast === 100 && saturation === 100 && warmth === 0) {
    return undefined;
  }

  const warmSepia = Math.max(0, warmth) / 250;
  const hueRotate = warmth < 0 ? Math.abs(warmth) * 0.45 : warmth * -0.15;
  return {
    filter: [
      `brightness(${brightness}%)`,
      `contrast(${contrast}%)`,
      `saturate(${saturation}%)`,
      `sepia(${warmSepia})`,
      `hue-rotate(${hueRotate}deg)`,
    ].join(" "),
  };
}

function imageCropSettings(element: BoardElement) {
  const zoom = clampNumber(element.imageCropZoom ?? 1, 1, 3);
  const x = clampNumber(element.imageCropX ?? 0, -50, 50);
  const y = clampNumber(element.imageCropY ?? 0, -50, 50);
  const active =
    element.imageCropZoom != null || element.imageCropX != null || element.imageCropY != null;
  return { active, zoom, x, y };
}

function boardImageStyle(
  element: BoardElement,
  options: { includeRotation?: boolean } = {},
): CSSProperties | undefined {
  const adjustments = imageAdjustmentStyle(element);
  const crop = imageCropSettings(element);
  const transforms = [
    options.includeRotation ? `rotate(${element.rotation ?? 0}deg)` : "",
    crop.active && crop.zoom !== 1 ? `scale(${crop.zoom})` : "",
  ].filter(Boolean);

  if (!adjustments && !crop.active && transforms.length === 0) return undefined;
  return {
    ...adjustments,
    objectFit: crop.active ? "cover" : "contain",
    objectPosition: crop.active ? `${50 - crop.x}% ${50 - crop.y}%` : undefined,
    transform: transforms.length ? transforms.join(" ") : undefined,
    transformOrigin: crop.active ? `${50 + crop.x}% ${50 + crop.y}%` : undefined,
  };
}

function CommentsPanel({
  comments,
  selectedComments,
  focusedCommentId,
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
  focusedCommentId: string | null;
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
  if (focusedCommentId) selectedCommentIds.add(focusedCommentId);

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
              id={`board-comment-${comment.id}`}
              className={cn(
                "rounded-lg border bg-white p-3 text-sm",
                selectedCommentIds.has(comment.id)
                  ? "border-[#1f4e5f] ring-2 ring-[#1f4e5f]/15"
                  : "border-stone-200",
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

function MissingMaterialInfoDialog({
  open,
  items,
  rooms,
  onOpenChange,
  onUpdateItem,
  onShowOnBoard,
}: {
  open: boolean;
  items: MissingMaterialInfoItem[];
  rooms: Room[];
  onOpenChange: (open: boolean) => void;
  onUpdateItem: (pageId: string, elementId: string, patch: Partial<BoardElement>) => void;
  onShowOnBoard: (pageId: string, elementId: string) => void;
}) {
  const sortedCategories = useMemo(
    () =>
      [...ALL_CATEGORIES].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-6xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">
            Review Material Info
          </DialogTitle>
          <DialogDescription>
            Fix labels, links, rooms, quantities, finishes, and dimensions before sending board
            items into Materials and Spec Books.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {items.length} item{items.length === 1 ? "" : "s"} need a quick check
          </div>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            Add the missing info, send the item anyway, or exclude it from Materials if it should
            stay only on the board.
          </p>
        </div>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {items.map((item) => {
            const element = item.element;
            const quantityValue =
              element.materialQuantity == null ? "" : String(element.materialQuantity);
            return (
              <div
                key={`${item.pageId}:${element.id}`}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="grid gap-4 lg:grid-cols-[96px_minmax(0,1fr)]">
                  <div>
                    <div className="h-24 w-24 overflow-hidden bg-[#f6f3ee]">
                      {element.src ? (
                        <OptimizedBoardImage
                          src={normalizeSupabaseImageUrl(element.src)}
                          alt={imageMaterialLabel(element) || "Missing material item"}
                          kind="thumbnail"
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-stone-300">
                          IMG
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onShowOnBoard(item.pageId, element.id)}
                      className="mt-2 w-24 border border-stone-300 px-2 py-1.5 text-xs transition hover:border-ink"
                    >
                      Show
                    </button>
                  </div>
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-ink">
                          {imageMaterialLabel(element) || "Unlabeled item"}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">
                          Page {item.pageNumber}: {item.pageTitle} · {item.roomName}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {item.issues.map((issue) => (
                          <span
                            key={issue}
                            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-amber-900"
                          >
                            Missing {issue}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                        Label
                        <MissingMaterialInfoDraftInput
                          value={element.label ?? ""}
                          onCommit={(value) =>
                            onUpdateItem(item.pageId, element.id, { label: value })
                          }
                          placeholder="ex. Pantry Sink"
                        />
                      </label>
                      <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                        Product link / note
                        <MissingMaterialInfoDraftInput
                          value={element.link ?? ""}
                          onCommit={(value) =>
                            onUpdateItem(item.pageId, element.id, {
                              link: value,
                              materialLinkCleared: value.trim() === "",
                            })
                          }
                          placeholder="https://... or see cabinet vendor"
                        />
                      </label>
                      <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                        Room
                        <select
                          value={element.materialRoomId ?? ""}
                          onChange={(event) =>
                            onUpdateItem(item.pageId, element.id, {
                              materialRoomId: event.target.value || null,
                            })
                          }
                          className="mt-1 w-full border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                        >
                          <option value="">Use page room / no room</option>
                          {rooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                        Category
                        <select
                          value={element.materialCategory ?? ""}
                          onChange={(event) =>
                            onUpdateItem(item.pageId, element.id, {
                              materialCategory: event.target.value || null,
                            })
                          }
                          className="mt-1 w-full border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                        >
                          <option value="">Auto category</option>
                          {sortedCategories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                        Color / Finish
                        <MissingMaterialInfoDraftInput
                          value={element.materialFinish ?? element.finish ?? ""}
                          onCommit={(value) =>
                            onUpdateItem(item.pageId, element.id, {
                              materialFinish: value,
                            })
                          }
                          placeholder="ex. Aged Brass"
                        />
                      </label>
                      <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                        Dimensions / Notes
                        <MissingMaterialInfoDraftInput
                          value={element.materialDimensions ?? ""}
                          onCommit={(value) =>
                            onUpdateItem(item.pageId, element.id, {
                              materialDimensions: value,
                            })
                          }
                          placeholder="ex. 30 in W x 18 in D"
                        />
                      </label>
                      <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                        Qty
                        <MissingMaterialInfoDraftInput
                          value={quantityValue}
                          onCommit={(draft) => {
                            const value = draft.trim();
                            onUpdateItem(item.pageId, element.id, {
                              materialQuantity: value ? Math.max(1, Number(value) || 1) : null,
                            });
                          }}
                          inputMode="numeric"
                          placeholder="Auto"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateItem(item.pageId, element.id, {
                            materialExcludeFromMaterials: !element.materialExcludeFromMaterials,
                          })
                        }
                        className={cn(
                          "border px-3 py-2 text-xs transition",
                          element.materialExcludeFromMaterials
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-stone-300 bg-white hover:border-ink",
                        )}
                      >
                        {element.materialExcludeFromMaterials
                          ? "Include in Materials"
                          : "Exclude from Materials"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MissingMaterialInfoDraftInput({
  value,
  onCommit,
  placeholder,
  inputMode,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  inputMode?: "text" | "numeric";
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.currentTarget.blur();
      }}
      inputMode={inputMode}
      placeholder={placeholder}
      className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
    />
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
  onRemoveBackgroundBestFree,
  onRemoveBackgroundWithOpenAI,
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
  onRemoveBackgroundBestFree: () => void;
  onRemoveBackgroundWithOpenAI: () => void;
  removingBackground: boolean;
}) {
  const linkedProduct = selected.productId
    ? products.find((product) => product.id === selected.productId)
    : null;
  const selectedMaterialIssues =
    selected.type === "image" ? imageMaterialIssues(selected, linkedProduct) : [];
  const [quantityDraft, setQuantityDraft] = useState(
    selected.materialQuantity == null ? "" : String(selected.materialQuantity),
  );

  useEffect(() => {
    setQuantityDraft(selected.materialQuantity == null ? "" : String(selected.materialQuantity));
  }, [selected.id, selected.materialQuantity]);

  const commitQuantityDraft = () => {
    const value = quantityDraft.trim();
    if (!value) {
      onUpdate({ materialQuantity: null });
      return;
    }
    onUpdate({ materialQuantity: Math.max(1, Number(value) || 1) });
  };

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
            <DraftFontSizeInput
              ariaLabel="Text font size"
              value={selected.fontSize ?? 24}
              className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
              onCommit={(fontSize) => onUpdate({ fontSize })}
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
            onClick={() =>
              onUpdate({
                materialExcludeFromMaterials: !selected.materialExcludeFromMaterials,
              })
            }
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 border px-4 py-2 text-sm transition",
              selected.materialExcludeFromMaterials
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-stone-300 bg-white hover:border-ink",
            )}
          >
            {selected.materialExcludeFromMaterials
              ? "Include in Materials"
              : "Exclude from Materials"}
          </button>
          {selected.materialExcludeFromMaterials && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
              This image will not be sent to Materials or Spec.
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
          <button
            type="button"
            onClick={onRemoveBackgroundBestFree}
            disabled={removingBackground || !selected.fastBackgroundRemovalTried}
            title={
              !selected.fastBackgroundRemovalTried
                ? "Try the fast free Remove Background first. Better Free unlocks after that."
                : undefined
            }
            className="inline-flex w-full items-center justify-center gap-2 border border-[#1f4e5f] bg-white px-4 py-2 text-sm text-[#1f4e5f] transition hover:bg-[#f3f7f5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Scissors className="h-4 w-4" />{" "}
            {removingBackground
              ? "Removing background..."
              : selected.fastBackgroundRemovalTried
                ? "Better Free Background"
                : "Better Free Locked"}
          </button>
          <button
            type="button"
            onClick={onRemoveBackgroundWithOpenAI}
            disabled={removingBackground || !selected.bestFreeBackgroundRemovalTried}
            title={
              !selected.bestFreeBackgroundRemovalTried
                ? "Try Better Free Background before using paid AI credits."
                : undefined
            }
            className="inline-flex w-full items-center justify-center gap-2 border border-[#1f4e5f] bg-[#f3f7f5] px-4 py-2 text-sm text-[#1f4e5f] transition hover:bg-[#e9f1ef] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <WandSparkles className="h-4 w-4" />{" "}
            {removingBackground
              ? "Removing background..."
              : selected.bestFreeBackgroundRemovalTried
                ? "AI Remove Background"
                : "AI Locked Until Better Free Is Tried"}
          </button>
          <p className="text-xs leading-relaxed text-stone-500">
            Use the regular remover first for a free, fast cutout. Better Free uses a larger local
            model before paid AI credits unlock.
          </p>
          <div className="border border-stone-200 bg-[#faf9f5] p-3">
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="eyebrow">Crop</div>
              <button
                type="button"
                onClick={() =>
                  onUpdate({
                    imageCropZoom: null,
                    imageCropX: null,
                    imageCropY: null,
                  })
                }
                className="text-xs text-stone-500 underline-offset-4 hover:text-ink hover:underline"
              >
                Reset crop
              </button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-stone-500">
              Double-click the image or use Crop in the board toolbar. Drag the photo to reposition it,
              then drag the lower-right handle to zoom. This does not change the original image.
            </p>
          </div>
          <div className="border border-stone-200 bg-[#faf9f5] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="eyebrow">Image edits</div>
              <button
                type="button"
                onClick={() =>
                  onUpdate({
                    imageBrightness: null,
                    imageContrast: null,
                    imageSaturation: null,
                    imageWarmth: null,
                  })
                }
                className="text-xs text-stone-500 underline-offset-4 hover:text-ink hover:underline"
              >
                Reset
              </button>
            </div>
            <ImageAdjustmentSlider
              label="Brightness"
              value={selected.imageBrightness ?? 100}
              min={50}
              max={150}
              suffix="%"
              onChange={(value) => onUpdate({ imageBrightness: value })}
            />
            <ImageAdjustmentSlider
              label="Contrast"
              value={selected.imageContrast ?? 100}
              min={50}
              max={150}
              suffix="%"
              onChange={(value) => onUpdate({ imageContrast: value })}
            />
            <ImageAdjustmentSlider
              label="Saturation"
              value={selected.imageSaturation ?? 100}
              min={0}
              max={200}
              suffix="%"
              onChange={(value) => onUpdate({ imageSaturation: value })}
            />
            <ImageAdjustmentSlider
              label="Warmth"
              value={selected.imageWarmth ?? 0}
              min={-50}
              max={50}
              onChange={(value) => onUpdate({ imageWarmth: value })}
            />
          </div>
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
              onChange={(event) =>
                onUpdate({
                  link: event.target.value,
                  materialLinkCleared: event.target.value.trim() === "",
                })
              }
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
                  normalizeItemCategory(selected.materialCategory) ||
                  inferMaterialCategory(imageMaterialLabel(selected), selected.link) ||
                  normalizeItemCategory(linkedProduct?.category) ||
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
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={quantityDraft}
                  onFocus={(event) => event.currentTarget.select()}
                  onMouseUp={(event) => event.preventDefault()}
                  onChange={(event) => setQuantityDraft(event.target.value)}
                  onBlur={commitQuantityDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  placeholder="1"
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
            <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-stone-500">
              Dimensions
              <input
                value={selected.materialDimensions ?? linkedProduct?.dimensions ?? ""}
                onChange={(event) => onUpdate({ materialDimensions: event.target.value })}
                placeholder='33"W x 34"D x 30"H'
                className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
              />
            </label>
            <button
              type="button"
              onClick={onSendToMaterials}
              disabled={sendingToMaterials || selected.materialExcludeFromMaterials}
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
              {linkedProduct.product_url && externalHref(linkedProduct.product_url) ? (
                <a
                  href={externalHref(linkedProduct.product_url) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs underline"
                >
                  Open product link <ExternalLink className="h-3 w-3" />
                </a>
              ) : linkedProduct.product_url ? (
                <div className="mt-2 text-xs text-stone-500">{linkedProduct.product_url}</div>
              ) : null}
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
              src={normalizeSupabaseImageUrl(product.image_url)}
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
  const imageUrl = materialImageUrl(item);
  const label = materialTrayLabel(item);
  const category = normalizedMaterialItemCategory(item);
  const needsReselection = item.room_product?.approval_status === "declined";
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
          {item.product?.vendor && (
            <div className="text-xs text-stone-500">{item.product.vendor}</div>
          )}
          {needsReselection && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-800">
              <AlertTriangle className="h-3 w-3" />
              Needs re-selection
            </div>
          )}
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
  style,
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
      style={style}
      onError={() => {
        if (finalSrc !== src) setFailedVariant(finalSrc);
      }}
    />
  );
}

function imageVariantUrl(src: string, kind: ImageVariantKind) {
  const normalizedSrc = normalizeSupabaseImageUrl(src);
  if (kind === "original") return normalizedSrc;
  // Avoid Supabase's dynamic image transformation endpoint during normal board use.
  // Those transformation requests are metered separately and can spike quickly on
  // image-heavy design boards. The UI still requests thumbnail/preview variants,
  // but until stored derivative files exist we use the regular public image URL.
  return normalizedSrc;
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

function DraftFontSizeInput({
  value,
  onCommit,
  className,
  ariaLabel,
}: {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = useCallback(() => {
    const nextValue = draft.trim();
    if (!nextValue) {
      setDraft(String(value));
      return;
    }

    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const fontSize = clampNumber(Math.round(parsed), 8, 220);
    setDraft(String(fontSize));
    if (fontSize !== value) onCommit(fontSize);
  }, [draft, onCommit, value]);

  return (
    <input
      aria-label={ariaLabel}
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        const parsed = Number(nextValue);
        if (nextValue.trim() && Number.isFinite(parsed) && parsed >= 8 && parsed <= 220) {
          onCommit(Math.round(parsed));
        }
      }}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      className={className}
    />
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
    materialDimensions: product.dimensions,
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
  const src = materialImageUrl(item) || undefined;
  // A project material can intentionally have no link even when its catalog
  // product still has one. Keep the material row as the source of truth so
  // clearing a board link does not resurrect an older catalog URL on reload.
  const link = item.product_url || "";
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
    notes: item.notes ?? "",
    materialItemId: item.id,
    materialRoomId: item.room_id,
    materialCategory,
    materialQuantity: item.quantity ?? 1,
    materialFinish: item.color ?? product?.finish ?? null,
    materialDimensions: product?.dimensions ?? null,
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

function imageMaterialLabelForSend(element: BoardElement) {
  return imageMaterialLabel(element) || "Unlabeled Item";
}

function boardElementProductUrl(element: BoardElement, linkedProduct?: Product | null) {
  if (element.link?.trim()) return element.link.trim();
  if (linkedProduct?.product_url?.trim()) return linkedProduct.product_url.trim();
  return null;
}

function boardElementProductUrlForMaterialSync(
  element: BoardElement,
  linkedProduct?: Product | null,
) {
  if (element.materialLinkCleared) return null;
  return boardElementProductUrl(element, linkedProduct);
}

function imageMaterialIssues(element: BoardElement, linkedProduct?: Product | null) {
  if (element.type !== "image" || element.materialExcludeFromMaterials) {
    return [];
  }
  const issues: string[] = [];
  if (!imageMaterialLabel(element)) issues.push("label");
  if (!boardElementProductUrlForMaterialSync(element, linkedProduct)) issues.push("link");
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

function formatSkippedMaterialReasons(
  reasons: Record<"label" | "link" | "room", number>,
) {
  const parts = (["label", "link", "room"] as const)
    .filter((key) => reasons[key] > 0)
    .map((key) => `${reasons[key]} missing ${key}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function joinMissingInfo(issues: string[]) {
  const readableIssues = issues;
  if (readableIssues.length <= 1) return readableIssues[0] ?? "required info";
  return `${readableIssues.slice(0, -1).join(", ")} and ${readableIssues.at(-1)}`;
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

async function renderDesignBoardPageToDataUrl(page: BoardPage, pixelRatio = 1) {
  const canvas = document.createElement("canvas");
  const scale = Math.max(1, pixelRatio);
  canvas.width = BOARD_WIDTH * scale;
  canvas.height = BOARD_HEIGHT * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare PDF canvas.");
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = "#fbfaf7";
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  const sortedElements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);
  for (const element of sortedElements) {
    await drawBoardElementForExport(ctx, element);
  }

  return canvas.toDataURL("image/png");
}

async function drawBoardElementForExport(ctx: CanvasRenderingContext2D, element: BoardElement) {
  ctx.save();
  ctx.globalAlpha = element.visible === false ? 0.22 : 1;

  if (element.type === "image") {
    ctx.translate(element.x, element.y);
    await drawBoardImageForExport(ctx, element);
    ctx.restore();
    return;
  }

  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  ctx.translate(centerX, centerY);
  ctx.rotate(((element.rotation ?? 0) * Math.PI) / 180);
  ctx.translate(-element.width / 2, -element.height / 2);

  if (element.type === "shape") {
    ctx.fillStyle = element.background ?? "#dcd9ce";
    ctx.fillRect(0, 0, element.width, element.height);
  }

  if (element.type === "text") {
    drawBoardTextForExport(ctx, element);
  }

  if (element.type === "image") {
    await drawBoardImageForExport(ctx, element);
  }

  ctx.restore();
}

async function drawBoardImageForExport(ctx: CanvasRenderingContext2D, element: BoardElement) {
  if (element.src) {
    try {
      const image = await loadImageElement(await imageSourceForCanvas(element.src));
      ctx.save();
      ctx.translate(element.width / 2, element.height / 2);
      ctx.rotate(((element.rotation ?? 0) * Math.PI) / 180);
      ctx.translate(-element.width / 2, -element.height / 2);
      drawImageContain(ctx, image, 0, 0, element.width, element.height, element);
      ctx.restore();
    } catch (error) {
      console.warn("[Design Board] Could not draw image into PDF", error);
      drawImageFallback(ctx, element);
    }
  } else {
    drawImageFallback(ctx, element);
  }

  if (!element.hideDetails && (element.label || element.productName)) {
    drawBoardImageLabelForExport(ctx, element);
  }

  if (!element.hideDetails && element.productId) {
    ctx.fillStyle = "#1f4e5f";
    drawRoundedRect(ctx, 4, 4, 74, 24, 12);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "10px Montserrat, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PRODUCT", 41, 16);
  }
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  element: BoardElement,
) {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) return;

  const crop = imageCropSettings(element);
  const scale =
    (crop.active
      ? Math.max(width / naturalWidth, height / naturalHeight)
      : Math.min(width / naturalWidth, height / naturalHeight)) * crop.zoom;
  const drawWidth = naturalWidth * scale;
  const drawHeight = naturalHeight * scale;
  const extraX = Math.max(0, drawWidth - width);
  const extraY = Math.max(0, drawHeight - height);
  const drawX = x + (width - drawWidth) / 2 + (crop.x / 100) * extraX;
  const drawY = y + (height - drawHeight) / 2 + (crop.y / 100) * extraY;

  const previousFilter = ctx.filter;
  ctx.filter = boardElementCanvasFilter(element);
  if (crop.active) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
  }
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  if (crop.active) ctx.restore();
  ctx.filter = previousFilter;
}

function drawImageFallback(ctx: CanvasRenderingContext2D, element: BoardElement) {
  ctx.strokeStyle = "#d6d3cb";
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(0, 0, element.width, element.height);
  ctx.setLineDash([]);
  ctx.fillStyle = "#faf9f5";
  ctx.fillRect(0, 0, element.width, element.height);
  drawWrappedCanvasText(
    ctx,
    element.label || element.productName || "Image",
    element.width / 2,
    element.height / 2,
    element.width - 32,
    26,
    "var(--font-display)",
    "#a8a29a",
    "center",
    "middle",
  );
}

function drawBoardImageLabelForExport(ctx: CanvasRenderingContext2D, element: BoardElement) {
  const label = (element.label || element.productName || "").trim();
  if (!label) return;
  const fontSize = 12;
  ctx.font = `${fontSize}px Montserrat, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelWidth = Math.min(element.width + 24, Math.max(52, ctx.measureText(label).width + 18));
  const labelHeight = 24;
  const labelX = element.width / 2 - labelWidth / 2;
  const labelY = element.height + 6;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.shadowColor = "rgba(40,34,25,0.12)";
  ctx.shadowBlur = 6;
  ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#57534e";
  ctx.fillText(label.toUpperCase(), element.width / 2, labelY + labelHeight / 2 + 0.5);
}

function drawBoardTextForExport(ctx: CanvasRenderingContext2D, element: BoardElement) {
  drawWrappedCanvasText(
    ctx,
    element.text ?? "",
    element.width / 2,
    element.height / 2,
    element.width,
    element.fontSize ?? 24,
    element.fontFamily ?? DEFAULT_BOARD_TEXT_FONT,
    element.color ?? DEFAULT_BOARD_TEXT_COLOR,
    "center",
    "middle",
    element.letterSpacing ?? 1,
  );
}

function drawWrappedCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  color: string,
  textAlign: CanvasTextAlign,
  textBaseline: CanvasTextBaseline,
  letterSpacing = 0,
) {
  const resolvedFont = resolveCanvasFontFamily(fontFamily);
  const lines = wrapCanvasText(ctx, text.toUpperCase(), maxWidth, fontSize, resolvedFont);
  const lineHeight = fontSize * 1.12;
  const totalHeight = Math.max(lineHeight, lines.length * lineHeight);
  const startY = textBaseline === "middle" ? y - totalHeight / 2 + lineHeight / 2 : y;

  ctx.fillStyle = color;
  ctx.font = `${fontSize}px ${resolvedFont}`;
  ctx.textAlign = textAlign;
  ctx.textBaseline = "middle";

  lines.forEach((line, index) => {
    drawCanvasTextWithLetterSpacing(ctx, line, x, startY + index * lineHeight, letterSpacing);
  });
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
) {
  ctx.font = `${fontSize}px ${fontFamily}`;
  const explicitLines = text.split(/\n/);
  const lines: string[] = [];
  for (const explicitLine of explicitLines) {
    const words = explicitLine.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const nextLine = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(nextLine).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = nextLine;
      }
    }
    lines.push(line || "");
  }
  return lines;
}

function drawCanvasTextWithLetterSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
) {
  if (!letterSpacing || text.length <= 1 || ctx.textAlign !== "center") {
    ctx.fillText(text, x, y);
    return;
  }

  const letters = Array.from(text);
  const widths = letters.map((letter) => ctx.measureText(letter).width);
  const totalWidth =
    widths.reduce((total, width) => total + width, 0) + letterSpacing * (letters.length - 1);
  let cursor = x - totalWidth / 2;
  letters.forEach((letter, index) => {
    ctx.fillText(letter, cursor + widths[index] / 2, y);
    cursor += widths[index] + letterSpacing;
  });
}

function resolveCanvasFontFamily(fontFamily: string) {
  if (fontFamily.includes("--font-montserrat")) return "Montserrat, Arial, sans-serif";
  if (fontFamily.includes("--font-display")) return "Cormorant Garamond, Georgia, serif";
  if (fontFamily.includes("--font-sans")) return "Inter, Arial, sans-serif";
  return fontFamily;
}

function boardElementCanvasFilter(element: BoardElement) {
  const brightness = clampNumber(element.imageBrightness ?? 100, 50, 150);
  const contrast = clampNumber(element.imageContrast ?? 100, 50, 150);
  const saturation = clampNumber(element.imageSaturation ?? 100, 0, 200);
  const warmth = clampNumber(element.imageWarmth ?? 0, -50, 50);
  const warmSepia = Math.max(0, warmth) / 250;
  const hueRotate = warmth < 0 ? Math.abs(warmth) * 0.45 : warmth * -0.15;
  return [
    `brightness(${brightness}%)`,
    `contrast(${contrast}%)`,
    `saturate(${saturation}%)`,
    `sepia(${warmSepia})`,
    `hue-rotate(${hueRotate}deg)`,
  ].join(" ");
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function sanitizeFileName(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "design-board"
  );
}

async function removeFlatImageBackground(src: string) {
  const cutout = await runImglyBackgroundRemoval(src, "isnet_fp16");
  return rescueForegroundDetails(src, await blobToDataUrl(cutout));
}

async function removeHighQualityFreeImageBackground(src: string) {
  const cutout = await runImglyBackgroundRemoval(src, "isnet");
  return rescueForegroundDetails(src, await blobToDataUrl(cutout));
}

async function runImglyBackgroundRemoval(src: string, model: ImglyBackgroundModel) {
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(src, {
    device: "cpu",
    model,
    output: {
      format: "image/png",
      quality: 1,
      type: "foreground",
    },
  });
}

function shouldUseLocalSmartBackgroundRemoval() {
  if (typeof window === "undefined") return false;
  return !window.location.search.includes("legacyBg=1");
}

async function removeSmartProductBackground(originalSrc: string) {
  const original = await loadImageElement(originalSrc);
  const analysis = analyzeProductImage(original);
  const workingSrc = analysis.isLikelyProduct
    ? createProductIsolationWorkingImage(original, analysis)
    : originalSrc;

  const fastCutout = await blobToDataUrl(await runImglyBackgroundRemoval(workingSrc, "isnet_fp16"));
  const fastResult = await applyCutoutMaskToOriginal(originalSrc, fastCutout);
  const fastScore = await scoreCutoutMask(fastResult, analysis);
  if (fastScore.acceptable) return fastResult;

  const qualityCutout = await blobToDataUrl(await runImglyBackgroundRemoval(workingSrc, "isnet"));
  const qualityResult = await applyCutoutMaskToOriginal(originalSrc, qualityCutout);
  const qualityScore = await scoreCutoutMask(qualityResult, analysis);
  return qualityScore.score >= fastScore.score ? qualityResult : fastResult;
}

type ProductImageAnalysis = {
  isLikelyProduct: boolean;
  foregroundBox: BoardRect;
  areaRatio: number;
  borderTouchRatio: number;
  centerScore: number;
};

function analyzeProductImage(image: HTMLImageElement): ProductImageAnalysis {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sampleWidth = 160;
  const sampleHeight = Math.max(1, Math.round((sourceHeight / Math.max(1, sourceWidth)) * sampleWidth));
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const fallbackBox = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  if (!ctx || !sourceWidth || !sourceHeight) {
    return {
      isLikelyProduct: false,
      foregroundBox: fallbackBox,
      areaRatio: 1,
      borderTouchRatio: 1,
      centerScore: 0,
    };
  }

  ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const pixels = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
  const border = sampleBorderColor(pixels.data, sampleWidth, sampleHeight);
  const threshold = Math.max(30, border.deviation * 0.7);
  let minX = sampleWidth;
  let minY = sampleHeight;
  let maxX = -1;
  let maxY = -1;
  let candidateCount = 0;
  let borderCandidateCount = 0;
  const centerX = sampleWidth / 2;
  const centerY = sampleHeight / 2;
  const maxCenterDistance = Math.hypot(centerX, centerY) || 1;

  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const index = (y * sampleWidth + x) * 4;
      const alpha = pixels.data[index + 3];
      if (alpha < 20) continue;
      const distance = colorDistance(
        pixels.data[index],
        pixels.data[index + 1],
        pixels.data[index + 2],
        border.red,
        border.green,
        border.blue,
      );
      const centerBias = 1.18 - Math.hypot(x - centerX, y - centerY) / maxCenterDistance;
      if (distance * centerBias < threshold) continue;
      candidateCount += 1;
      if (x <= 1 || y <= 1 || x >= sampleWidth - 2 || y >= sampleHeight - 2) {
        borderCandidateCount += 1;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      isLikelyProduct: false,
      foregroundBox: fallbackBox,
      areaRatio: 1,
      borderTouchRatio: 1,
      centerScore: 0,
    };
  }

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const areaRatio = (boxWidth * boxHeight) / (sampleWidth * sampleHeight);
  const borderTouchRatio = borderCandidateCount / Math.max(1, candidateCount);
  const boxCenterX = minX + boxWidth / 2;
  const boxCenterY = minY + boxHeight / 2;
  const centerScore = 1 - Math.hypot(boxCenterX - centerX, boxCenterY - centerY) / maxCenterDistance;
  const scaleX = sourceWidth / sampleWidth;
  const scaleY = sourceHeight / sampleHeight;
  const padX = boxWidth * scaleX * 0.14;
  const padY = boxHeight * scaleY * 0.14;
  const foregroundBox = {
    x: Math.max(0, minX * scaleX - padX),
    y: Math.max(0, minY * scaleY - padY),
    width: Math.min(sourceWidth, (maxX + 1) * scaleX + padX) - Math.max(0, minX * scaleX - padX),
    height:
      Math.min(sourceHeight, (maxY + 1) * scaleY + padY) - Math.max(0, minY * scaleY - padY),
  };

  return {
    isLikelyProduct:
      areaRatio >= 0.08 &&
      areaRatio <= 0.88 &&
      borderTouchRatio <= 0.22 &&
      centerScore >= 0.58 &&
      candidateCount / (sampleWidth * sampleHeight) >= 0.025,
    foregroundBox,
    areaRatio,
    borderTouchRatio,
    centerScore,
  };
}

function sampleBorderColor(data: Uint8ClampedArray, width: number, height: number) {
  const samples: Array<[number, number, number]> = [];
  for (let x = 0; x < width; x += 1) {
    samples.push(readRgb(data, x, 0, width), readRgb(data, x, height - 1, width));
  }
  for (let y = 1; y < height - 1; y += 1) {
    samples.push(readRgb(data, 0, y, width), readRgb(data, width - 1, y, width));
  }
  const average = samples.reduce(
    (acc, sample) => {
      acc.red += sample[0];
      acc.green += sample[1];
      acc.blue += sample[2];
      return acc;
    },
    { red: 0, green: 0, blue: 0 },
  );
  average.red /= Math.max(1, samples.length);
  average.green /= Math.max(1, samples.length);
  average.blue /= Math.max(1, samples.length);
  const deviation =
    samples.reduce(
      (total, sample) =>
        total + colorDistance(sample[0], sample[1], sample[2], average.red, average.green, average.blue),
      0,
    ) / Math.max(1, samples.length);
  return { ...average, deviation };
}

function readRgb(data: Uint8ClampedArray, x: number, y: number, width: number): [number, number, number] {
  const index = (y * width + x) * 4;
  return [data[index], data[index + 1], data[index + 2]];
}

function colorDistance(
  redA: number,
  greenA: number,
  blueA: number,
  redB: number,
  greenB: number,
  blueB: number,
) {
  return Math.hypot(redA - redB, greenA - greenB, blueA - blueB);
}

function createProductIsolationWorkingImage(image: HTMLImageElement, analysis: ProductImageAnalysis) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image.src;

  ctx.filter = "blur(7px) saturate(55%) contrast(88%) brightness(108%)";
  ctx.drawImage(image, 0, 0, width, height);
  ctx.filter = "none";
  ctx.fillStyle = "rgba(248, 247, 242, 0.22)";
  ctx.fillRect(0, 0, width, height);

  const box = analysis.foregroundBox;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.drawImage(image, 0, 0, width, height);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

async function applyCutoutMaskToOriginal(originalSrc: string, cutoutSrc: string) {
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
  const maskPixels = ctx.getImageData(0, 0, width, height);
  const alpha = refineMaskAlpha(maskPixels.data, width, height);

  for (let index = 0; index < originalPixels.data.length; index += 4) {
    originalPixels.data[index + 3] = alpha[index / 4];
  }
  ctx.putImageData(originalPixels, 0, 0);
  return canvas.toDataURL("image/png");
}

function refineMaskAlpha(data: Uint8ClampedArray, width: number, height: number) {
  const alpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = data[index * 4 + 3];

  const refined = new Uint8ClampedArray(alpha);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value = alpha[index];
      let strongNeighbors = 0;
      let weakNeighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const neighbor = alpha[(y + offsetY) * width + x + offsetX];
          if (neighbor > 170) strongNeighbors += 1;
          if (neighbor > 24) weakNeighbors += 1;
        }
      }

      // Fill tiny holes, but avoid broad feathering so furniture edges stay crisp.
      if (value < 40 && strongNeighbors >= 6) refined[index] = 220;
      // Remove only obvious isolated specks; keep thin lamp arms/chair legs.
      if (value > 140 && weakNeighbors <= 1) refined[index] = 0;
    }
  }
  return refined;
}

async function scoreCutoutMask(cutoutSrc: string, analysis: ProductImageAnalysis) {
  const image = await loadImageElement(cutoutSrc);
  const width = Math.min(160, image.naturalWidth || image.width);
  const height = Math.max(
    1,
    Math.round(((image.naturalHeight || image.height) / Math.max(1, image.naturalWidth || image.width)) * width),
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { score: 0, acceptable: false };
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let foregroundPixels = 0;
  let edgePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha <= 32) continue;
      foregroundPixels += 1;
      if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) edgePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return { score: 0, acceptable: false };

  const coverage = foregroundPixels / (width * height);
  const boxAreaRatio = ((maxX - minX + 1) * (maxY - minY + 1)) / (width * height);
  const edgeTouchRatio = edgePixels / Math.max(1, foregroundPixels);
  const holeRatio = estimateMaskHoleRatio(pixels, width, height, minX, minY, maxX, maxY);
  let score = 100;
  if (coverage < 0.025 || coverage > 0.9) score -= 40;
  if (analysis.isLikelyProduct && boxAreaRatio < analysis.areaRatio * 0.45) score -= 25;
  if (analysis.isLikelyProduct && edgeTouchRatio > Math.max(0.2, analysis.borderTouchRatio + 0.16)) {
    score -= 12;
  }
  if (holeRatio > 0.22) score -= 20;
  if (holeRatio > 0.36) score -= 18;
  return { score, acceptable: score >= 74 };
}

function estimateMaskHoleRatio(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) {
  const insetX = Math.max(1, Math.round((maxX - minX) * 0.08));
  const insetY = Math.max(1, Math.round((maxY - minY) * 0.08));
  let transparent = 0;
  let total = 0;
  for (let y = minY + insetY; y <= maxY - insetY; y += 1) {
    for (let x = minX + insetX; x <= maxX - insetX; x += 1) {
      total += 1;
      if (data[(y * width + x) * 4 + 3] < 24) transparent += 1;
    }
  }
  return transparent / Math.max(1, total);
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
  const blob = dataUrlToBlob(dataUrl);
  const signedRes = await fetch("/api/upload-design-board-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, fileName, contentType: blob.type || "image/png" }),
  });
  const signedBody = await safeJsonResponse<{
    error?: string;
    path?: string;
    token?: string;
    url?: string;
  }>(signedRes);
  if (!signedRes.ok || !signedBody?.path || !signedBody?.token || !signedBody?.url) {
    throw new Error(signedBody?.error || "Could not prepare image upload.");
  }

  const { error } = await supabase.storage
    .from("design-board-images")
    .uploadToSignedUrl(signedBody.path, signedBody.token, blob, {
      contentType: blob.type || "image/png",
    });
  if (error) throw new Error(error.message || "Could not upload image.");
  return signedBody.url;
}

async function removeDesignBoardBackgroundWithOpenAI(
  imageUrl: string,
  projectId: string,
  fileName: string,
) {
  const res = await fetch("/api/remove-design-board-background", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl, projectId, fileName }),
  });
  const body = await res.json();
  if (!res.ok || !body?.url) {
    throw new Error(body?.error || "AI background removal failed. Try the fast remover instead.");
  }
  return body.url as string;
}

async function safeJsonResponse<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.replace(/\s+/g, " ").trim().slice(0, 240) || "Server returned an invalid response.");
  }
}

function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!match) throw new Error("Could not prepare image upload.");
  const contentType = match[1] || "image/png";
  const isBase64 = Boolean(match[2]);
  const data = match[3] || "";
  const binary = isBase64 ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
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
        : [...current.pages.slice(0, insertAt), patch.page, ...current.pages.slice(insertAt)],
    });
  }
  if (patch.kind === "move-page") {
    const pageIndex = current.pages.findIndex((page) => page.id === patch.pageId);
    if (pageIndex < 0) return current;
    const targetIndex = patch.direction === "left" ? pageIndex - 1 : pageIndex + 1;
    if (targetIndex < 0 || targetIndex >= current.pages.length) return current;
    const reorderedPages = [...current.pages];
    const [movedPage] = reorderedPages.splice(pageIndex, 1);
    reorderedPages.splice(targetIndex, 0, movedPage);
    return normalizeBoardState({
      ...current,
      pages: reorderedPages,
      selectedPageId: patch.pageId,
    });
  }
  if (patch.kind === "delete-page") {
    if (current.pages.length <= 1) return current;
    const pageIndex = current.pages.findIndex((page) => page.id === patch.pageId);
    if (pageIndex < 0) return current;

    const nextPages = current.pages.filter((page) => page.id !== patch.pageId);
    const fallbackSelectedPageId =
      current.pages[pageIndex - 1]?.id ?? current.pages[pageIndex + 1]?.id ?? nextPages[0]?.id;

    return normalizeBoardState({
      ...current,
      pages: nextPages,
      selectedPageId:
        current.selectedPageId === patch.pageId
          ? (fallbackSelectedPageId ?? nextPages[0]?.id ?? current.selectedPageId)
          : current.selectedPageId,
      comments: (current.comments ?? []).filter((comment) => comment.pageId !== patch.pageId),
      presentationExtraPages: (current.presentationExtraPages ?? []).filter(
        (slot) => slot.boardPageId !== patch.pageId,
      ),
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
    "backgroundRemovedUrl",
    "autoRemoveBackground",
    "fastBackgroundRemovalTried",
    "bestFreeBackgroundRemovalTried",
    "backgroundRemovalStatus",
    "label",
    "notes",
    "text",
    "background",
    "color",
    "fontSize",
    "fontFamily",
    "letterSpacing",
    "link",
    "materialLinkCleared",
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
    "materialDimensions",
    "materialInfoNotNeeded",
    "materialInfoSkipApproved",
    "materialExcludeFromMaterials",
    "imageBrightness",
    "imageContrast",
    "imageSaturation",
    "imageWarmth",
    "imageCropZoom",
    "imageCropX",
    "imageCropY",
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
    presentationExtraPages: normalized.presentationExtraPages ?? [],
    presentationSlideOrder: normalized.presentationSlideOrder ?? [],
    presentationHiddenSlideKeys: normalized.presentationHiddenSlideKeys ?? [],
    presentationRenderingOverrides: normalized.presentationRenderingOverrides ?? {},
    presentationHiddenSections: normalized.presentationHiddenSections ?? {},
    presentationSlidePicks: normalized.presentationSlidePicks ?? {},
    comments: normalized.comments ?? [],
    versions: [],
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
    presentationExtraPages: normalized.presentationExtraPages ?? [],
    presentationSlideOrder: normalized.presentationSlideOrder ?? [],
    presentationHiddenSlideKeys: normalized.presentationHiddenSlideKeys ?? [],
    presentationRenderingOverrides: normalized.presentationRenderingOverrides ?? {},
    presentationHiddenSections: normalized.presentationHiddenSections ?? {},
    presentationSlidePicks: normalized.presentationSlidePicks ?? {},
    comments: normalized.comments ?? [],
  };
}

function mergeLatestPresentationState(state: BoardState, latestState: BoardState): BoardState {
  const normalized = normalizeBoardState(state);
  const latest = normalizeBoardState(latestState);
  const latestPresentationVisibility = new Map(
    latest.pages.map((page) => [page.id, page.presentationVisible] as const),
  );
  return {
    ...normalized,
    pages: normalized.pages.map((page) =>
      latestPresentationVisibility.has(page.id)
        ? { ...page, presentationVisible: latestPresentationVisibility.get(page.id) }
        : page,
    ),
    presentationExtraPages: latest.presentationExtraPages ?? [],
    presentationSlideOrder: latest.presentationSlideOrder ?? [],
    presentationHiddenSlideKeys: latest.presentationHiddenSlideKeys ?? [],
    presentationRenderingOverrides: latest.presentationRenderingOverrides ?? {},
    presentationHiddenSections: latest.presentationHiddenSections ?? {},
    presentationSlidePicks: latest.presentationSlidePicks ?? {},
  };
}

function stripPresentationStateForCompare(state: BoardState): BoardState {
  const normalized = prepareBoardStateForSave(state);
  return {
    ...normalized,
    pages: normalized.pages.map((page) => {
      const { presentationVisible: _presentationVisible, ...rest } = page;
      return rest;
    }),
    presentationExtraPages: [],
    presentationSlideOrder: [],
    presentationHiddenSlideKeys: [],
    presentationRenderingOverrides: {},
    presentationHiddenSections: {},
    presentationSlidePicks: {},
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
      : (normalized.pages[0]?.id ?? defaultBoardState().selectedPageId),
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

  const presentationExtraPages = Array.isArray(candidate.presentationExtraPages)
    ? candidate.presentationExtraPages
        .map(normalizePresentationExtraPageSlot)
        .filter((slot): slot is PresentationExtraPageSlot => Boolean(slot))
    : [];

  return {
    pages,
    selectedPageId,
    presentationExtraPages,
    presentationSlideOrder: normalizeUniqueStringArray(candidate.presentationSlideOrder),
    presentationHiddenSlideKeys: normalizeUniqueStringArray(candidate.presentationHiddenSlideKeys),
    presentationRenderingOverrides: normalizeStringRecord(candidate.presentationRenderingOverrides),
    presentationHiddenSections: normalizeStringArrayRecord(candidate.presentationHiddenSections),
    presentationSlidePicks: normalizePlainObjectRecord(candidate.presentationSlidePicks),
    comments,
    versions,
  };
}

function normalizeUniqueStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((item): item is string => {
    if (typeof item !== "string" || !item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

function normalizeStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        Boolean(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1]),
    ),
  );
}

function normalizeStringArrayRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [
        key,
        Array.isArray(entryValue)
          ? entryValue.filter((item): item is string => typeof item === "string" && Boolean(item))
          : [],
      ])
      .filter(([key, entryValue]) => Boolean(key) && entryValue.length > 0),
  ) as Record<string, string[]>;
}

function normalizePlainObjectRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key, entryValue]) =>
        Boolean(key) && Boolean(entryValue) && typeof entryValue === "object" && !Array.isArray(entryValue),
    ),
  );
}

function normalizePresentationExtraPageSlot(value: unknown): PresentationExtraPageSlot | null {
  if (!value || typeof value !== "object") return null;
  const slot = value as Partial<PresentationExtraPageSlot>;
  const afterSlideKey =
    typeof slot.afterSlideKey === "string" && slot.afterSlideKey.trim()
      ? slot.afterSlideKey.trim()
      : null;
  if (!afterSlideKey) return null;
  return {
    id: typeof slot.id === "string" && slot.id ? slot.id : crypto.randomUUID(),
    afterSlideKey,
    boardPageId:
      typeof slot.boardPageId === "string" && slot.boardPageId ? slot.boardPageId : null,
  };
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

function normalizePageMaterialsSyncSnapshot(value: unknown): PageMaterialsSyncSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as Partial<PageMaterialsSyncSnapshot>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.materialImages)) return undefined;
  const nullableString = (entry: unknown) => (typeof entry === "string" ? entry : null);
  const materialImages = snapshot.materialImages
    .filter(
      (item): item is PageMaterialsSyncImageSnapshot =>
        Boolean(item && typeof item === "object" && typeof item.id === "string" && item.id),
    )
    .map((item) => ({
      id: item.id,
      src: nullableString(item.src),
      label: nullableString(item.label),
      notes: nullableString(item.notes),
      link: nullableString(item.link),
      materialLinkCleared: item.materialLinkCleared === true,
      productId: nullableString(item.productId),
      productName: nullableString(item.productName),
      finish: nullableString(item.finish),
      materialRoomId: nullableString(item.materialRoomId),
      materialCategory: nullableString(item.materialCategory),
      materialQuantity:
        typeof item.materialQuantity === "number" ? item.materialQuantity : null,
      materialFinish: nullableString(item.materialFinish),
      materialDimensions: nullableString(item.materialDimensions),
      materialInfoNotNeeded: item.materialInfoNotNeeded === true,
      materialInfoSkipApproved: item.materialInfoSkipApproved === true,
      materialExcludeFromMaterials: item.materialExcludeFromMaterials === true,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    version: 1,
    title: typeof snapshot.title === "string" ? snapshot.title : "",
    roomId: nullableString(snapshot.roomId),
    hidden: snapshot.hidden === true,
    roomApprovalStatus:
      snapshot.roomApprovalStatus === "approved" || snapshot.roomApprovalStatus === "declined"
        ? snapshot.roomApprovalStatus
        : null,
    materialImages,
  };
}

function normalizeBoardPage(value: unknown, pageIndex: number): BoardPage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Partial<BoardPage>;
  const id = typeof page.id === "string" && page.id ? page.id : crypto.randomUUID();
  const title = typeof page.title === "string" ? page.title : `Design Board ${pageIndex + 1}`;
  const roomId = typeof page.roomId === "string" && page.roomId ? page.roomId : null;
  const hidden = page.hidden === true;
  const roomApprovalStatus =
    page.roomApprovalStatus === "approved" || page.roomApprovalStatus === "declined"
      ? page.roomApprovalStatus
      : undefined;
  const declinedMaterialItems = Array.isArray(page.declinedMaterialItems)
    ? page.declinedMaterialItems.filter(
        (item): item is Record<string, unknown> => Boolean(item && typeof item === "object"),
      )
    : undefined;
  const presentationVisible = page.presentationVisible === true;
  const materialsSyncFingerprint =
    typeof page.materialsSyncFingerprint === "string" && page.materialsSyncFingerprint
      ? page.materialsSyncFingerprint
      : undefined;
  const materialsSyncSnapshot = normalizePageMaterialsSyncSnapshot(page.materialsSyncSnapshot);
  const materialsSyncedAt =
    typeof page.materialsSyncedAt === "string" && page.materialsSyncedAt
      ? page.materialsSyncedAt
      : undefined;
  const elements = Array.isArray(page.elements)
    ? page.elements
        .map(normalizeBoardElement)
        .filter((element): element is BoardElement => Boolean(element))
    : [];
  return {
    id,
    title,
    roomId,
    hidden,
    roomApprovalStatus,
    declinedMaterialItems,
    presentationVisible: hidden ? false : presentationVisible,
    materialsSyncFingerprint,
    materialsSyncSnapshot,
    materialsSyncedAt,
    elements,
  };
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

function defaultBoardState(): BoardState {
  const pages = defaultPages();
  return { pages, selectedPageId: pages[0].id, presentationExtraPages: [], comments: [] };
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

function createTransferredBoardPage(
  sourcePage: BoardPage,
  destinationRoomId: string | null,
): BoardPage {
  return {
    ...cloneBoardState({
      pages: [sourcePage],
      selectedPageId: sourcePage.id,
    }).pages[0],
    id: crypto.randomUUID(),
    roomId: destinationRoomId,
    hidden: false,
    roomApprovalStatus: undefined,
    declinedMaterialItems: undefined,
    presentationVisible: false,
    materialsSyncFingerprint: undefined,
    materialsSyncSnapshot: undefined,
    materialsSyncedAt: undefined,
    elements: sourcePage.elements.map((element) => ({
      ...element,
      id: crypto.randomUUID(),
      materialItemId: null,
      materialRoomId: destinationRoomId,
      materialInfoSkipApproved: false,
    })),
  };
}

function isUntouchedDefaultBoard(state: BoardState) {
  return (
    state.pages.length === 1 &&
    state.pages[0].id === "board-1" &&
    state.pages[0].title === "Design Board 1" &&
    state.pages[0].roomId === null &&
    state.pages[0].elements.length === 0 &&
    (state.comments ?? []).length === 0
  );
}

function storageKey(projectId: string) {
  return `merav-studio-design-boards-v2-${projectId}`;
}

function cloneBoardState(state: BoardState): BoardState {
  return JSON.parse(JSON.stringify(state)) as BoardState;
}

function externalHref(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!/\s/.test(trimmed) && /^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function normalizeMaterialIdentityText(value?: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeMaterialIdentityUrl(value?: string | null) {
  const normalized = value?.trim() || "";
  return normalized.replace(/\/+$/, "").toLowerCase();
}

function buildBoardMaterialIdentity({
  roomId,
  label,
  productUrl,
  color,
  dimensions,
}: {
  roomId: string;
  label?: string | null;
  productUrl?: string | null;
  color?: string | null;
  dimensions?: string | null;
}) {
  return [
    roomId,
    normalizeMaterialIdentityText(label),
    normalizeMaterialIdentityUrl(productUrl),
    normalizeMaterialIdentityText(color),
    normalizeMaterialIdentityText(dimensions),
  ].join("::");
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
