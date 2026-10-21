import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { strToU8, zipSync } from "fflate";
import {
  Archive,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCopy,
  ClipboardList,
  ExternalLink,
  FileImage,
  GripVertical,
  ImagePlus,
  LayoutTemplate,
  Link2,
  Lock,
  PackageCheck,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  WandSparkles,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RoomDesignTileFields } from "@/components/RoomDesignTileFields";
import { RoomDesignItemDetails } from "@/components/RoomDesignItemDetails";
import { RoomDesignDisclosure } from "@/components/RoomDesignDisclosure";
import { mergeAutomaticRoomProduct, roomDesignLinkSourceKey } from "@/lib/roomDesignAutoScrape";
import {
  roomDesignInitialQuantity,
  roomItemStatus,
  roomItemNeedsProduct,
  roomDetailValue,
  roomScopeValue,
  updateRoomScope,
  isRoomScopeItem,
  synchronizeRoomSelectionDetails,
  roomItemShowsTileFields,
  roomProjectDefaults,
  markRoomRelatedChanges,
  roomDesignScrapedNotes,
} from "@/lib/roomDesignDetails";
import { RoomDesignQuantityInput } from "@/components/RoomDesignQuantityInput";
import { roomDesignQuantityLabel } from "@/lib/roomDesignQuantity";
import { Label } from "@/components/ui/label";
import { removeProductImageBackground } from "@/lib/backgroundRemovalClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildCodexProjectRenderHandoffMarkdown,
  buildCodexRenderHandoffMarkdown,
  codexProjectRenderHandoffBaseName,
  codexRenderHandoffBaseName,
  createCodexProjectRenderHandoff,
  createCodexRenderHandoff,
  type CodexRenderAttachment,
} from "@/lib/codexRenderHandoff";
import {
  productScrapeReviewMessage,
  scrapeProductUrlsBatch,
  scrapedProductStatus,
  scrapeProductUrl,
  type ScrapedProductData,
} from "@/lib/productScrape";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { classifyBoardGroup, selectionItemsForRoom } from "@/lib/selectionChecklist";
import { BOARD_GROUPS, type BoardGroup } from "@/lib/selectionTypes";
import { cn } from "@/lib/utils";
import { inferVendorFromUrl } from "@/lib/vendorInference";
import {
  db,
  type MaterialItem,
  type Product,
  type Project,
  type Room,
  type RoomImage,
  type RoomDesignWorkflowRecord,
  type UserProfile,
} from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import {
  mergeRoomDesignSelectionsIntoBoard,
  normalizeRoomDesignWorkflowState,
  reconcileRoomDesignChecklist,
  roomDesignGeneratedPageCount,
  type RoomDesignWorkflowState,
} from "@/lib/roomDesignWorkflow";
import { canUseRoomDesign, canUseRenderingStudio } from "@/lib/permissions";
import { cleanProductDetail } from "@/lib/productDetails";
import {
  productAwareQuantityUnit,
  roomDesignSelectionIssues,
  roomDesignProductGaps,
  roomDesignStepForAccess,
  roomDesignOrderReady,
  retainRoomDesignMeasurements,
  roomDesignConfirmationMessage,
  ROOM_DESIGN_REVIEW_FIELDS,
  roomDesignReviewBlockers,
  confirmRoomDesignSelection,
} from "@/lib/roomDesignReview";
import { selectionQuantityUnitFromSpec } from "@/lib/specQuantity";
import { mergeRoomDesignEdits, roomDesignStatesEqual } from "@/lib/roomDesignSync";
import {
  inferMaterialCategory,
  productMatchesItemCategory,
  toProductCategory,
  type ItemCategory,
} from "@/lib/roomTemplates";

export const Route = createFileRoute("/projects/$id/room-design")({
  validateSearch: (search: Record<string, unknown>) => ({
    roomId: typeof search.roomId === "string" ? search.roomId : undefined,
    manualBoard: search.manualBoard === "ready" ? "ready" : undefined,
    stage: search.stage === "render" ? "render" : undefined,
  }),
  head: () => ({ meta: [{ title: "Room Design — MERAV Studio" }] }),
  component: RoomDesignPage,
});

type StartMethod = "manual" | "links" | "concept";
type SelectionSource = "Manual board" | "Product link" | "Product catalog" | "Concept match";
type SelectionState = "draft" | "selected" | "locked";
type QuantityUnit =
  "each" | "pair" | "set" | "sq ft" | "linear ft" | "box" | "carton" | "slab" | "roll" | "gallon";

const QUANTITY_UNITS: Array<{ value: QuantityUnit; label: string }> = [
  { value: "each", label: "Each" },
  { value: "pair", label: "Pair" },
  { value: "set", label: "Set" },
  { value: "sq ft", label: "Sq. ft." },
  { value: "linear ft", label: "Linear ft." },
  { value: "box", label: "Box" },
  { value: "carton", label: "Carton" },
  { value: "slab", label: "Slab" },
  { value: "roll", label: "Roll" },
  { value: "gallon", label: "Gallon" },
];

function defaultQuantityUnit(category: string): QuantityUnit {
  if (/flooring|tile|backsplash/i.test(category)) return "sq ft";
  if (/baseboard|casing|transition/i.test(category)) return "linear ft";
  if (/countertop/i.test(category)) return "slab";
  if (/wall finish|ceiling finish|vanity finish|paint/i.test(category)) return "gallon";
  if (/shower system/i.test(category)) return "set";
  return "each";
}

function defaultWastePercent(category: string) {
  if (/flooring|tile|backsplash/i.test(category)) return 10;
  if (/baseboard|casing|transition/i.test(category)) return 5;
  return 0;
}

function quantityUnitUsesWaste(unit: QuantityUnit) {
  return ["sq ft", "linear ft", "box", "carton", "roll"].includes(unit);
}

function selectionQuantityUnit(selection: DemoSelection) {
  return selection.quantityUnit ?? defaultQuantityUnit(selection.category);
}

function selectionOrderQuantity(selection: DemoSelection) {
  if (selection.quantity === null) return null;
  const quantity = selection.quantity ?? 1;
  const unit = selectionQuantityUnit(selection);
  if (!quantityUnitUsesWaste(unit)) return quantity;
  const wastePercent = selection.wastePercent ?? defaultWastePercent(selection.category);
  return Math.round(quantity * (1 + wastePercent / 100) * 100) / 100;
}

type DemoSelection = {
  id: string;
  category: string;
  productName: string;
  vendor: string;
  finish: string;
  source: SelectionSource;
  state: SelectionState;
  swatch: string;
  url?: string;
  group?: BoardGroup;
  quantity?: number | null;
  quantityUnit?: QuantityUnit;
  wastePercent?: number;
  notes?: string;
  savedToTemplate?: boolean;
  imageUrl?: string;
  originalImageUrl?: string;
  price?: string;
  sku?: string;
  dimensions?: string;
  sizeOptions?: string[];
  selectedSize?: string;
  reviewFields?: string[];
  scrapeStatus?: "complete" | "partial" | "failed";
  scrapeError?: string;
  materialsSyncStatus?: "current" | "changed";
  productId?: string | null;
};

type DemoLink = {
  id: string;
  category: string;
  url: string;
  group: BoardGroup;
  quantity: number | null;
  notes: string;
  productId?: string;
  catalogProductName?: string;
  custom?: boolean;
  saveToTemplate?: boolean;
};

type LinkScrapeState = {
  status: "waiting" | "scraping" | "complete" | "partial" | "failed";
  message?: string;
};

type GatherProgress = {
  completed: number;
  total: number;
  successful: number;
  partial: number;
  failed: number;
};

type RoomWorkflowDraft = {
  method: StartMethod;
  links: DemoLink[];
  linksRoomName: string;
  selections: DemoSelection[];
  conceptPreview: string;
  roomPreview: string;
  planPreview: string;
  sketchupPreview: string;
  boardReady: boolean;
  renderReady: boolean;
  completedRenderPreview: string;
  materialsSent: boolean;
};

type ProjectRenderRoom = RoomWorkflowDraft & {
  id: string;
  name: string;
  outputFilename: string;
};

const STEPS = ["Start", "Selections", "Design Board", "Render", "Approve", "Studio Outputs"];

function itemKey(label: string) {
  return label
    .toLowerCase()
    .replace(/\+/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const LEGACY_LINK_SPLITS: Record<string, string[]> = {
  "Flooring + transitions": ["Flooring", "Transitions"],
  "Baseboard + casing": ["Baseboard", "Casing"],
  "Doors + door hardware": ["Doors", "Door hardware"],
  "General / recessed lighting": ["General lighting", "Recessed lighting"],
  "Switches, outlets + plates": ["Switches", "Outlets", "Wall plates"],
  "Cabinet + appliance layout": ["Cabinet layout", "Appliance layout"],
  "Drain / disposal / flange / air switch": [
    "Sink drain",
    "Garbage disposal",
    "Sink flange",
    "Air switch",
  ],
  "Open shelving / rails": ["Open shelving", "Shelf rails"],
  "Sconces / accent lighting": ["Sconces", "Accent lighting"],
  "Under-cabinet / interior lighting": ["Under-cabinet lighting", "Cabinet interior lighting"],
  "Countertop / island power": ["Countertop power", "Island power"],
  "Bath accessories + hooks": ["Bath accessories", "Hooks"],
  "Furniture / fixtures": ["Furniture", "Fixtures"],
  "Hardware + accessories": ["Hardware", "Accessories"],
};

function splitLegacyBlankLinks(links: DemoLink[]) {
  return links.flatMap((link) => {
    const replacements = LEGACY_LINK_SPLITS[link.category];
    const hasWork =
      Boolean(link.url.trim() || link.productId || link.catalogProductName || link.notes.trim()) ||
      link.quantity !== 1 ||
      link.saveToTemplate === true;
    if (!replacements || hasWork) return [link];
    return replacements.map((category) => ({
      ...link,
      id: itemKey(category),
      category,
      group: classifyBoardGroup(category),
    }));
  });
}

function linksForRoom(roomName: string): DemoLink[] {
  return selectionItemsForRoom(roomName).map(({ key: id, label: category }) => {
    return {
      id,
      category,
      url: "",
      group: classifyBoardGroup(category),
      quantity: roomDesignInitialQuantity(category),
      notes: "",
    };
  });
}

function swatchForGroup(group: BoardGroup) {
  const swatches: Record<BoardGroup, string> = {
    Materials: "linear-gradient(135deg,#e9e2d8,#b9ab98 48%,#f5f2ec 52%,#cdbfae)",
    "Cabinetry / Millwork": "repeating-linear-gradient(90deg,#b7946f 0 7px,#c7a783 8px 13px)",
    Plumbing: "linear-gradient(145deg,#f0ede5 0 35%,#97938a 36% 44%,#ded9cf 45% 66%,#77736c 67%)",
    Lighting: "radial-gradient(circle,#f2dfba 0 24%,#b58a50 26% 34%,transparent 36%)",
    Appliances: "linear-gradient(135deg,#d9d8d4,#777672 48%,#efeee9 50%,#999793)",
    Hardware: "radial-gradient(circle,#b58a50 0 35%,#836236 36% 45%,transparent 47%)",
    "Feature / Decor": "linear-gradient(135deg,#ccbca8,#8d7864)",
    "Architecture / Other": "linear-gradient(135deg,#ece8df,#c9c1b5)",
  };
  return swatches[group];
}

function catalogSectionForItem(label: string, group: BoardGroup): ItemCategory {
  if (/\b(wall finish|ceiling finish)\b/i.test(label)) return "Paint";
  if (/\bair switch\b/i.test(label)) return "Plumbing";
  if (/\b(hardware|switches?|outlets?|wall plates?|hooks?)\b/i.test(label)) return "Hardware";
  const inferred = inferMaterialCategory(label);
  if (inferred !== "Other") return inferred;
  if (group === "Cabinetry / Millwork") return "Cabinetry";
  if (group === "Lighting") return "Lighting";
  if (group === "Plumbing") return "Plumbing";
  if (group === "Appliances") return "Appliances";
  if (group === "Hardware") return "Hardware";
  if (group === "Materials") return "Other";
  if (group === "Feature / Decor") return "Accessories";
  return "Other";
}

function catalogMatchScore(product: Product, itemLabel: string) {
  const words = itemLabel
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !["and", "finish", "decorative"].includes(word));
  const haystack = `${product.name} ${product.subcategory ?? ""}`.toLowerCase();
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

const EMPTY_GATHER_PROGRESS: GatherProgress = {
  completed: 0,
  total: 0,
  successful: 0,
  partial: 0,
  failed: 0,
};

function createRoomWorkflowDraft(roomName: string): RoomWorkflowDraft {
  return {
    method: "links",
    links: linksForRoom(roomName),
    linksRoomName: roomName,
    selections: [],
    conceptPreview: "",
    roomPreview: "",
    planPreview: "",
    sketchupPreview: "",
    boardReady: false,
    renderReady: false,
    completedRenderPreview: "",
    materialsSent: false,
  };
}

function latestRoomImage(images: RoomImage[], roomId: string, kind: RoomImage["kind"]) {
  return (
    images
      .filter(
        (image) => image.room_id === roomId && image.kind === kind && image.status === "complete",
      )
      .sort((left, right) => (right.created_at || "").localeCompare(left.created_at || ""))[0]
      ?.url || ""
  );
}

function createSavedRoomWorkflowDraft(
  roomName: string,
  savedState: unknown,
  roomImages: RoomImage[],
  roomId: string,
): RoomWorkflowDraft {
  const base = createRoomWorkflowDraft(roomName);
  const normalized = reconcileRoomDesignChecklist(
    normalizeRoomDesignWorkflowState(savedState, {
      method: base.method,
      stage: 0,
      links: base.links,
      linksRoomName: base.linksRoomName,
      selections: base.selections,
      conceptImageUrl: base.conceptPreview,
      roomImageUrl: base.roomPreview,
      floorPlanImageUrl: base.planPreview,
      sketchupImageUrl: base.sketchupPreview,
      completedRenderImageUrl: base.completedRenderPreview,
      boardReady: base.boardReady,
      renderReady: base.renderReady,
      materialsSent: base.materialsSent,
    }),
    roomName,
  );

  return {
    method: normalized.method,
    links: splitLegacyBlankLinks(normalized.links as DemoLink[]),
    linksRoomName: normalized.linksRoomName,
    selections: normalized.selections as DemoSelection[],
    conceptPreview: normalized.conceptImageUrl,
    roomPreview: normalized.roomImageUrl,
    planPreview: normalized.floorPlanImageUrl,
    sketchupPreview: normalized.sketchupImageUrl || latestRoomImage(roomImages, roomId, "sketchup"),
    completedRenderPreview:
      normalized.completedRenderImageUrl ||
      (savedState && typeof savedState === "object" && "completedRenderImageUrl" in savedState
        ? ""
        : latestRoomImage(roomImages, roomId, "rendering")),
    boardReady: normalized.boardReady,
    renderReady: normalized.renderReady,
    materialsSent: normalized.materialsSent,
  };
}

function savedRoomWorkflowStage(state?: Record<string, unknown>) {
  return typeof state?.stage === "number" ? Math.min(5, Math.max(0, state.stage)) : 0;
}

function serializeRoomWorkflowDraft(
  draft: RoomWorkflowDraft,
  stage: number,
): RoomDesignWorkflowState {
  return {
    version: 1,
    method: draft.method,
    stage,
    links: draft.links,
    linksRoomName: draft.linksRoomName,
    selections: draft.selections,
    conceptImageUrl: draft.conceptPreview,
    roomImageUrl: draft.roomPreview,
    floorPlanImageUrl: draft.planPreview,
    sketchupImageUrl: draft.sketchupPreview,
    completedRenderImageUrl: draft.completedRenderPreview,
    boardReady: draft.boardReady,
    renderReady: draft.renderReady,
    materialsSent: draft.materialsSent,
    updatedAt: new Date().toISOString(),
  };
}

type HandoffImage = {
  dataUrl: string;
  baseName: string;
  purpose: CodexRenderAttachment["purpose"];
};

function handoffImageFile(image: HandoffImage) {
  const commaIndex = image.dataUrl.indexOf(",");
  if (!image.dataUrl.startsWith("data:") || commaIndex < 0) return null;
  const header = image.dataUrl.slice(5, commaIndex);
  const payload = image.dataUrl.slice(commaIndex + 1);
  const mimeType = header.split(";")[0] || "image/png";
  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/webp"
        ? "webp"
        : mimeType === "image/svg+xml"
          ? "svg"
          : "png";
  const bytes = header.includes(";base64")
    ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
    : strToU8(decodeURIComponent(payload));
  return {
    attachment: { filename: `${image.baseName}.${extension}`, purpose: image.purpose },
    bytes,
  };
}

async function buildRoomHandoffPackage({
  projectName,
  room,
  prepareImage,
  boardState,
}: {
  projectName: string;
  room: ProjectRenderRoom;
  prepareImage: (url: string, roomId: string) => Promise<string>;
  boardState?: unknown;
}) {
  const imageInputs: HandoffImage[] = [
    ...(room.roomPreview
      ? [{ dataUrl: room.roomPreview, baseName: "room-photo", purpose: "room-photo" as const }]
      : []),
    ...(room.planPreview
      ? [{ dataUrl: room.planPreview, baseName: "floor-plan", purpose: "floor-plan" as const }]
      : []),
    ...(room.sketchupPreview
      ? [
          {
            dataUrl: room.sketchupPreview,
            baseName: "cad-sketchup-view",
            purpose: "sketchup-view" as const,
          },
        ]
      : []),
    ...(room.method === "concept" && room.conceptPreview
      ? [
          {
            dataUrl: room.conceptPreview,
            baseName: "concept-board",
            purpose: "concept-board" as const,
          },
        ]
      : []),
  ];
  room.selections.forEach((selection, index) => {
    if (selection.imageUrl)
      imageInputs.push({
        dataUrl: selection.imageUrl,
        baseName: `product-${String(index + 1).padStart(2, "0")}`,
        purpose: "product-reference",
      });
  });
  const packagedImages: NonNullable<ReturnType<typeof handoffImageFile>>[] = [];
  for (const image of imageInputs) {
    const dataUrl = image.dataUrl.startsWith("data:image/")
      ? image.dataUrl
      : await prepareImage(image.dataUrl, room.id);
    const packaged = handoffImageFile({ ...image, dataUrl });
    if (!packaged)
      throw new Error(
        `Could not package ${image.baseName}. Reattach that reference before downloading.`,
      );
    packagedImages.push(packaged);
  }
  const handoff = createCodexRenderHandoff({
    projectName,
    roomName: room.name,
    outputFilename: room.outputFilename,
    attachments: packagedImages.map((image) => image.attachment),
    selections: room.selections.map((selection, index) => ({
      category: selection.category,
      productName: selection.productName,
      vendor: selection.vendor,
      finish: selection.finish,
      source: selection.source,
      state: selection.state,
      url: selection.url,
      group: selection.group,
      quantity: selection.quantity,
      notes: selection.notes,
      imageUrl: selection.imageUrl,
      imageFilename: packagedImages.find((image) =>
        image.attachment.filename.startsWith(`product-${String(index + 1).padStart(2, "0")}.`),
      )?.attachment.filename,
      sku: selection.sku,
      dimensions: selection.dimensions,
      price: selection.price,
      quantityUnit: selection.quantityUnit,
      wastePercent: selection.wastePercent,
    })),
  });
  return {
    handoff,
    markdown: buildCodexRenderHandoffMarkdown(handoff),
    packagedImages,
    boardSnapshot:
      boardState && typeof boardState === "object"
        ? {
            projectName,
            roomId: room.id,
            roomName: room.name,
            pages: ((boardState as { pages?: Array<{ roomId?: string }> }).pages || []).filter(
              (page) => page.roomId === room.id,
            ),
          }
        : null,
  };
}

function downloadBrowserFile(filename: string, contents: Uint8Array, type: string) {
  const blob = new Blob([new Uint8Array(contents)], { type });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function RoomDesignPage() {
  const { id } = Route.useParams();
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.getProject(id),
  });
  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ["rooms", id],
    queryFn: async () => (await db.listRooms(id)) ?? [],
  });
  const { data: workflows = [], isLoading: workflowsLoading } = useQuery({
    queryKey: ["roomDesignWorkflows", id],
    queryFn: async () => (await db.listRoomDesignWorkflows(id)) ?? [],
    enabled: canUseRoomDesign(profile) && project?.design_workflow_version === "room_design_v2",
    refetchInterval: 5000,
    refetchOnWindowFocus: "always",
  });
  const { data: roomImages = [] } = useQuery({
    queryKey: ["projectRoomImages", id],
    queryFn: async () => (await db.listProjectRoomImages(id)) ?? [],
    enabled: canUseRoomDesign(profile) && project?.design_workflow_version === "room_design_v2",
  });
  const { data: materialItems = [] } = useQuery({
    queryKey: ["materialItems", id],
    queryFn: async () => (await db.listMaterialItemsByProject(id)) ?? [],
    enabled: canUseRoomDesign(profile) && project?.design_workflow_version === "room_design_v2",
  });
  const { data: featureFlag } = useQuery({
    queryKey: ["studioFeatureFlag", "room_design_v2"],
    queryFn: () => db.getStudioFeatureFlag("room_design_v2"),
    enabled: canUseRoomDesign(profile),
  });
  const { data: designBoard } = useQuery({
    queryKey: ["designBoard", id],
    queryFn: () => db.getDesignBoard(id),
    enabled: canUseRoomDesign(profile) && project?.design_workflow_version === "room_design_v2",
  });

  if (profileLoading || projectLoading || roomsLoading || workflowsLoading) {
    return (
      <AppShell>
        <div className="page-pad text-sm text-muted-foreground">Loading Room Design…</div>
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell>
        <div className="page-pad">
          <h1 className="font-display text-5xl">Project not found</h1>
        </div>
      </AppShell>
    );
  }

  if (!canUseRoomDesign(profile as UserProfile | null)) {
    return (
      <AppShell>
        <div className="page-pad">
          <div className="eyebrow">Room Design Pilot</div>
          <h1 className="mt-3 font-display text-5xl">Studio team access required</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Room Design is available to active Studio designers and administrators on their
            projects.
          </p>
        </div>
      </AppShell>
    );
  }

  if (featureFlag?.enabled !== true || project.design_workflow_version !== "room_design_v2") {
    return (
      <AppShell>
        <div className="page-pad">
          <div className="eyebrow">Room Design Pilot</div>
          <h1 className="mt-3 font-display text-5xl">Current Studio process is active</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
            This project has not been placed in the new Room Design pilot, or the global pilot
            switch is currently off. No project data has been changed.
          </p>
          <Button className="mt-6" asChild>
            <Link to="/projects/$id" params={{ id }}>
              Return to project
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  if (!rooms.length) {
    return (
      <AppShell>
        <div className="page-pad">
          <h1 className="font-display text-5xl">Add a room to begin</h1>
        </div>
      </AppShell>
    );
  }

  return (
    <RoomDesignWorkflow
      key={project.id}
      project={project}
      initialRooms={rooms}
      workflows={workflows}
      roomImages={roomImages}
      materialItems={materialItems}
      designBoardState={designBoard?.board_state}
      profile={profile as UserProfile}
    />
  );
}

function RoomDesignWorkflow({
  project,
  initialRooms,
  workflows,
  roomImages,
  materialItems,
  designBoardState,
  profile,
}: {
  project: Project;
  initialRooms: Room[];
  workflows: RoomDesignWorkflowRecord[];
  roomImages: RoomImage[];
  materialItems: MaterialItem[];
  designBoardState: unknown;
  profile: UserProfile;
}) {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const workflowByRoom = new Map(workflows.map((workflow) => [workflow.room_id, workflow]));
  const initialRoom = initialRooms.find((room) => room.id === search.roomId) ?? initialRooms[0];
  const initialDraft = createSavedRoomWorkflowDraft(
    initialRoom.name,
    workflowByRoom.get(initialRoom.id)?.state,
    roomImages,
    initialRoom.id,
  );
  const projectId = project.id;
  const renderingEnabled = canUseRenderingStudio(profile);
  const [rooms, setRooms] = useState(initialRooms);
  const [roomId, setRoomId] = useState(initialRoom.id);
  const [method, setMethod] = useState<StartMethod>(initialDraft.method);
  const [step, setRawStep] = useState(() => {
    if (search.stage === "render") return roomDesignStepForAccess(3, renderingEnabled);
    const savedStage = workflowByRoom.get(initialRoom.id)?.state?.stage;
    return roomDesignStepForAccess(
      typeof savedStage === "number" ? Math.min(5, Math.max(0, savedStage)) : 0,
      renderingEnabled,
    );
  });
  const setStep = (next: number) => setRawStep(roomDesignStepForAccess(next, renderingEnabled));
  useEffect(() => {
    if (!renderingEnabled && step === 3) setRawStep(4);
  }, [renderingEnabled, step]);
  const [links, setLinks] = useState(initialDraft.links);
  const [linksRoomName, setLinksRoomName] = useState(initialDraft.linksRoomName);
  const [selections, setSelections] = useState<DemoSelection[]>(initialDraft.selections);
  const latestRoomInputs = useRef({ roomId, links, selections, method });
  latestRoomInputs.current = { roomId, links, selections, method };
  const autoLinkTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const autoLinkVersions = useRef(new Map<string, number>());
  const autoLinkSequence = useRef(0);
  useEffect(() => {
    const timers = autoLinkTimers.current;
    const versions = autoLinkVersions.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      versions.clear();
    };
  }, [roomId]);
  const [conceptPreview, setConceptPreview] = useState(initialDraft.conceptPreview);
  const [roomPreview, setRoomPreview] = useState(initialDraft.roomPreview);
  const [planPreview, setPlanPreview] = useState(initialDraft.planPreview);
  const [sketchupPreview, setSketchupPreview] = useState(initialDraft.sketchupPreview);
  const [sourcing, setSourcing] = useState(false);
  const [conceptSourceMessage, setConceptSourceMessage] = useState("");
  const [gathering, setGathering] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [gatherProgress, setGatherProgress] = useState(EMPTY_GATHER_PROGRESS);
  const [linkScrapeStates, setLinkScrapeStates] = useState<Record<string, LinkScrapeState>>({});
  const [boardReady, setBoardReady] = useState(initialDraft.boardReady);
  const [renderReady, setRenderReady] = useState(initialDraft.renderReady);
  const [completedRenderPreview, setCompletedRenderPreview] = useState(
    initialDraft.completedRenderPreview,
  );
  const [materialsSent, setMaterialsSent] = useState(initialDraft.materialsSent);
  const linkedCatalogIdsKey = useMemo(
    () =>
      Array.from(new Set(links.map((link) => link.productId).filter(Boolean)))
        .sort()
        .join("|"),
    [links],
  );
  const [roomDrafts, setRoomDrafts] = useState<Record<string, RoomWorkflowDraft>>(() =>
    Object.fromEntries(
      initialRooms.map((room) => [
        room.id,
        createSavedRoomWorkflowDraft(
          room.name,
          workflowByRoom.get(room.id)?.state,
          roomImages,
          room.id,
        ),
      ]),
    ),
  );
  const [newRoomName, setNewRoomName] = useState("");
  const activeRoom = rooms.find((room) => room.id === roomId);
  const defaultsRoom = rooms.find((room) =>
    /^(?:project.?wide finishes|materials throughout|whole.?home finishes)$/i.test(
      room.name.trim(),
    ),
  );
  const projectDefaultLinks =
    defaultsRoom && defaultsRoom.id !== roomId ? (roomDrafts[defaultsRoom.id]?.links ?? []) : [];
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualBoardHydratedRef = useRef(false);
  const workflowBases = useRef(
    new Map(
      initialRooms.map((room) => {
        const saved = workflowByRoom.get(room.id);
        return [
          room.id,
          {
            updatedAt: saved?.updated_at ?? null,
            state: serializeRoomWorkflowDraft(
              createSavedRoomWorkflowDraft(room.name, saved?.state, roomImages, room.id),
              savedRoomWorkflowStage(saved?.state),
            ),
          },
        ] as const;
      }),
    ),
  );

  useEffect(() => {
    if (!linkedCatalogIdsKey) return;
    let cancelled = false;
    void db.listCatalog().then((catalog) => {
      if (cancelled || !catalog) return;
      const catalogProducts = new Map(catalog.map((product) => [product.id, product]));
      setLinks((current) => {
        let changed = false;
        const next = current.map((link) => {
          const product = link.productId ? catalogProducts.get(link.productId) : undefined;
          if (!product) return link;
          const currentName = product.name;
          const notes = roomDesignScrapedNotes(
            link.notes,
            link.category,
            product.name,
            product.finish || "",
          );
          if (currentName === link.catalogProductName && notes === link.notes) return link;
          changed = true;
          return { ...link, catalogProductName: currentName, notes };
        });
        return changed ? next : current;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [linkedCatalogIdsKey]);

  const currentRoomDraft = (): RoomWorkflowDraft => ({
    method,
    links,
    linksRoomName,
    selections,
    conceptPreview,
    roomPreview,
    planPreview,
    sketchupPreview,
    boardReady,
    renderReady,
    completedRenderPreview,
    materialsSent,
  });

  const persistDraft = async (targetRoomId: string, draft: RoomWorkflowDraft, stage = step) => {
    setSaveStatus("saving");
    try {
      const local = serializeRoomWorkflowDraft(draft, stage);
      const base =
        workflowBases.current.get(targetRoomId)?.state ??
        serializeRoomWorkflowDraft(createRoomWorkflowDraft(draft.linksRoomName), 0);
      let confirmed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const latest = await db.getRoomDesignWorkflow(projectId, targetRoomId);
        const remote = serializeRoomWorkflowDraft(
          createSavedRoomWorkflowDraft(
            draft.linksRoomName,
            latest?.state,
            roomImages,
            targetRoomId,
          ),
          savedRoomWorkflowStage(latest?.state),
        );
        const merged = mergeRoomDesignEdits(base, local, remote);
        if (latest && roomDesignStatesEqual(merged, remote)) {
          confirmed = true;
          break;
        }
        const saved = await db.saveRoomDesignWorkflowIfFresh(
          projectId,
          targetRoomId,
          merged,
          profile.id,
          latest?.updated_at ?? null,
        );
        if (saved) {
          confirmed = true;
          break;
        }
      }
      if (!confirmed)
        throw new Error("The room changed during saving. Refresh it before continuing.");
      setSaveStatus("saved");
      setSaveError("");
      queryClient.invalidateQueries({ queryKey: ["roomDesignWorkflows", projectId] });
    } catch (error) {
      console.error("Could not save Room Design workflow", error);
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Your edits could not be saved.");
    }
  };

  const pilotRequestOptions = async (targetRoomId = roomId) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Sign in again to continue.");
    return {
      authorization: `Bearer ${token}`,
      projectId,
      roomId: targetRoomId,
    };
  };

  const storeWorkflowImage = async (
    kind:
      | "concept-board"
      | "room-photo"
      | "floor-plan"
      | "sketchup-view"
      | "completed-render"
      | "product-cutout",
    value: string,
    setter: (url: string) => void,
    targetRoomId = roomId,
  ) => {
    if (!value.startsWith("data:image/")) {
      setter(value);
      return value;
    }
    setSaveStatus("saving");
    try {
      const requestOptions = await pilotRequestOptions(targetRoomId);
      const response = await fetch("/api/room-design-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: requestOptions.authorization,
        },
        body: JSON.stringify({ projectId, roomId: targetRoomId, kind, dataUrl: value }),
      });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Image upload failed.");
      setter(result.url);
      setSaveStatus("saved");
      return result.url;
    } catch (error) {
      setSaveStatus("error");
      throw error;
    }
  };

  const populateStudioDesignBoard = async (pageCount: number, boardSelections: DemoSelection[]) => {
    const uploadedSelections = await Promise.all(
      boardSelections.map(async (selection) => {
        if (!selection.imageUrl?.startsWith("data:image/")) return selection;
        let uploadedUrl = "";
        await storeWorkflowImage("product-cutout", selection.imageUrl, (url) => {
          uploadedUrl = url;
        });
        return { ...selection, imageUrl: uploadedUrl || selection.imageUrl };
      }),
    );
    const existing = await db.getDesignBoard(projectId);
    const merged = mergeRoomDesignSelectionsIntoBoard({
      boardState: existing?.board_state,
      projectName: project.name,
      roomId,
      roomName: activeRoom?.name || "Room",
      selections: uploadedSelections,
      pageCount,
    });
    const saved = existing
      ? await db.updateDesignBoardIfFresh(projectId, merged, existing.updated_at, profile.id)
      : await db.insertDesignBoard(projectId, merged, profile.id);
    if (!saved) {
      throw new Error(
        "The shared design board changed while this room was being added. Open the board, review the latest changes, and try again.",
      );
    }
    setBoardReady(true);
    await db.appendRoomDesignEvent(
      projectId,
      roomId,
      "design_board_populated",
      { pageCount, selectionCount: uploadedSelections.length },
      profile.id,
    );
    queryClient.invalidateQueries({ queryKey: ["designBoard", projectId] });
  };

  const removeSelectionBackground = async (imageUrl: string) =>
    removeProductImageBackground(imageUrl, await pilotRequestOptions());

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const draft = currentRoomDraft();
    const baseline = workflowBases.current.get(roomId)?.state;
    if (baseline && roomDesignStatesEqual(serializeRoomWorkflowDraft(draft, step), baseline))
      return;
    saveTimer.current = setTimeout(() => void persistDraft(roomId, draft, step), 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // The exact workflow primitives below intentionally control autosave. Including the helper
    // closures would recreate the timer on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    method,
    step,
    links,
    selections,
    conceptPreview,
    roomPreview,
    planPreview,
    sketchupPreview,
    boardReady,
    renderReady,
    completedRenderPreview,
    materialsSent,
    roomId,
  ]);

  useEffect(() => {
    if (search.manualBoard !== "ready" || manualBoardHydratedRef.current) return;
    manualBoardHydratedRef.current = true;
    const manualSelections: DemoSelection[] = materialItems
      .filter((item) => item.room_id === roomId && !item.not_needed)
      .map((item) => ({
        id: item.source_board_element_id?.startsWith(`room-design-v2:${roomId}:selection:`)
          ? item.source_board_element_id.split(":selection:")[1]
          : `manual-material:${item.id}`,
        category: item.item_label,
        productName: item.product?.name || item.client_product_name || item.item_label,
        vendor: item.product?.vendor || "",
        finish: item.product?.finish || item.color || "",
        source: "Manual board",
        state: item.product_url || item.product_id ? "selected" : "draft",
        swatch: swatchForGroup(classifyBoardGroup(item.item_label)),
        url: item.product_url || item.product?.product_url || undefined,
        imageUrl: item.image_url || item.product?.image_url || undefined,
        group: classifyBoardGroup(item.item_label),
        quantity: item.quantity_tbd || item.quantity === null ? null : (item.quantity ?? 1),
        quantityUnit: selectionQuantityUnitFromSpec(item.quantity_unit),
        wastePercent: item.waste_percent || 0,
        notes: item.notes || undefined,
        price: item.product?.price || undefined,
        sku: item.product?.sku || undefined,
        dimensions: item.product?.dimensions || undefined,
        sizeOptions: item.product?.size_options || undefined,
        selectedSize: item.product?.selected_size || undefined,
        productId: item.product_id,
        scrapeStatus: item.scrape_status === "failed" ? "failed" : "complete",
        scrapeError: item.scrape_error || undefined,
        materialsSyncStatus: "current",
      }));
    if (!manualSelections.length) return;
    setMethod("manual");
    setSelections(manualSelections);
    setMaterialsSent(true);
    setBoardReady(true);
    setStep(search.stage === "render" ? 3 : 1);
  }, [materialItems, roomId, search.manualBoard, search.stage]);

  const applyRoomDraft = (draft: RoomWorkflowDraft) => {
    setGathering(false);
    setGatherProgress(EMPTY_GATHER_PROGRESS);
    setLinkScrapeStates({});
    setMethod(draft.method);
    setLinks(draft.links);
    setLinksRoomName(draft.linksRoomName);
    setSelections(draft.selections);
    setConceptPreview(draft.conceptPreview);
    setRoomPreview(draft.roomPreview);
    setPlanPreview(draft.planPreview);
    setSketchupPreview(draft.sketchupPreview);
    setBoardReady(draft.boardReady);
    setRenderReady(draft.renderReady);
    setCompletedRenderPreview(draft.completedRenderPreview);
    setMaterialsSent(draft.materialsSent);
    setStep(0);
  };

  useEffect(() => {
    if (gathering || sourcing) return;
    for (const saved of workflows) {
      const room = rooms.find((item) => item.id === saved.room_id);
      if (!room) continue;
      const base = workflowBases.current.get(room.id);
      if (base?.updatedAt === saved.updated_at) continue;
      const remote = serializeRoomWorkflowDraft(
        createSavedRoomWorkflowDraft(room.name, saved.state, roomImages, room.id),
        savedRoomWorkflowStage(saved.state),
      );
      const localDraft = room.id === roomId ? currentRoomDraft() : roomDrafts[room.id];
      const local = localDraft
        ? serializeRoomWorkflowDraft(
            localDraft,
            room.id === roomId ? step : (base?.state.stage ?? 0),
          )
        : remote;
      try {
        const merged = base ? mergeRoomDesignEdits(base.state, local, remote) : remote;
        const draft = createSavedRoomWorkflowDraft(room.name, merged, roomImages, room.id);
        workflowBases.current.set(room.id, { updatedAt: saved.updated_at, state: remote });
        setRoomDrafts((current) => ({ ...current, [room.id]: draft }));
        if (room.id === roomId) {
          applyRoomDraft(draft);
          setStep(step);
        }
      } catch (error) {
        console.error("Room Design changed while editing", error);
        setSaveStatus("error");
        setSaveError(
          error instanceof Error
            ? error.message
            : "The saved room changed. Your edits are still on this page.",
        );
      }
    }
    // Read current edits when a new saved version arrives; typing must not reset the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflows, roomId, gathering, sourcing]);

  const changeRoom = (nextRoomId: string) => {
    if (nextRoomId === roomId) return;
    void persistDraft(roomId, currentRoomDraft(), step);
    if (roomId) {
      setRoomDrafts((current) => ({ ...current, [roomId]: currentRoomDraft() }));
    }
    const nextRoom = rooms.find((room) => room.id === nextRoomId);
    applyRoomDraft(
      roomDrafts[nextRoomId] ??
        createSavedRoomWorkflowDraft(
          nextRoom?.name ?? "Room",
          workflowByRoom.get(nextRoomId)?.state,
          roomImages,
          nextRoomId,
        ),
    );
    setRoomId(nextRoomId);
  };

  const addRoomToProject = async () => {
    const name = newRoomName.trim();
    if (!name) return;
    if (rooms.some((room) => room.name.toLowerCase() === name.toLowerCase())) return;
    const room = await db.createRoom({ project_id: projectId, name });
    if (!room) return;
    await db.updateRoom(room.id, { sort_order: rooms.length });
    void persistDraft(roomId, currentRoomDraft(), step);
    setRooms((current) => [...current, room]);
    setRoomDrafts((current) => ({
      ...current,
      [roomId]: currentRoomDraft(),
      [room.id]: createRoomWorkflowDraft(name),
    }));
    applyRoomDraft(createRoomWorkflowDraft(name));
    setRoomId(room.id);
    setNewRoomName("");
    queryClient.invalidateQueries({ queryKey: ["rooms", projectId] });
    await db.appendRoomDesignEvent(
      projectId,
      room.id,
      "room_created",
      { roomName: name },
      profile.id,
    );
  };

  const renderableRooms = rooms.filter(
    (room) =>
      !/^(materials throughout|appliance package|project.?wide finishes|whole.?home finishes)$/i.test(
        room.name.trim(),
      ),
  );
  const projectRenderRooms: ProjectRenderRoom[] = renderableRooms.map((room, index) => ({
    id: room.id,
    name: room.name,
    outputFilename: `${String(index + 1).padStart(2, "0")}-${codexRenderHandoffBaseName(
      project.name,
      room.name,
    )}-render.png`,
    ...(room.id === roomId
      ? currentRoomDraft()
      : (roomDrafts[room.id] ??
        createSavedRoomWorkflowDraft(
          room.name,
          workflowByRoom.get(room.id)?.state,
          roomImages,
          room.id,
        ))),
  }));

  const importProjectRenders = async (renders: Array<{ roomId: string; dataUrl: string }>) => {
    for (const render of renders) {
      let storedUrl = "";
      await storeWorkflowImage(
        "completed-render",
        render.dataUrl,
        (url) => {
          storedUrl = url;
        },
        render.roomId,
      );
      if (render.roomId === roomId) {
        setCompletedRenderPreview(storedUrl);
        continue;
      }
      const targetRoom = rooms.find((candidate) => candidate.id === render.roomId);
      const draft =
        roomDrafts[render.roomId] ?? createRoomWorkflowDraft(targetRoom?.name ?? "Room");
      const nextDraft = { ...draft, completedRenderPreview: storedUrl };
      setRoomDrafts((current) => ({ ...current, [render.roomId]: nextDraft }));
      await persistDraft(render.roomId, nextDraft, 3);
    }
  };

  const saveRenderToStudio = async () => {
    if (!activeRoom || (!completedRenderPreview && !sketchupPreview)) return;
    let sketchupId = activeRoom.presentation_sketchup_image_id;
    if (sketchupPreview) {
      const existingSketchup = roomImages.find(
        (image) =>
          image.room_id === roomId && image.kind === "sketchup" && image.url === sketchupPreview,
      );
      const sketchup =
        existingSketchup ??
        (await db.addRoomImage({
          room_id: roomId,
          kind: "sketchup",
          url: sketchupPreview,
          caption: `${activeRoom.name} CAD / SketchUp view`,
          status: "complete",
          role: "sketchup_single_hero",
          is_approved: false,
          review_status: "draft",
          revision_number: 1,
        }));
      sketchupId = sketchup?.id ?? sketchupId;
    }

    let renderingId = activeRoom.presentation_rendering_image_id;
    if (completedRenderPreview) {
      const existingRendering = roomImages.find(
        (image) =>
          image.room_id === roomId &&
          image.kind === "rendering" &&
          image.url === completedRenderPreview,
      );
      const rendering =
        existingRendering ??
        (await db.addRoomImage({
          room_id: roomId,
          kind: "rendering",
          url: completedRenderPreview,
          caption: `${activeRoom.name} rendering`,
          linked_sketchup_id: sketchupId,
          status: "complete",
          role: "single_hero",
          is_approved: false,
          review_status: "draft",
          revision_number: 1,
        }));
      renderingId = rendering?.id ?? renderingId;
    }

    await db.appendRoomDesignEvent(
      projectId,
      roomId,
      "room_render_draft_saved",
      { sketchupImageId: sketchupId, renderingImageId: renderingId },
      profile.id,
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["roomImages", roomId] }),
      queryClient.invalidateQueries({ queryKey: ["projectRoomImages", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["rooms", projectId] }),
    ]);
  };

  const addSelections = (incoming: DemoSelection[]) => {
    setSelections((current) => {
      const next = new Map(current.map((selection) => [selection.id, selection]));
      incoming.forEach((selection) =>
        next.set(selection.id, retainRoomDesignMeasurements(selection, next.get(selection.id))),
      );
      return Array.from(next.values());
    });
  };

  const chooseMethod = (next: StartMethod) => {
    for (const timer of autoLinkTimers.current.values()) clearTimeout(timer);
    autoLinkTimers.current.clear();
    autoLinkVersions.current.clear();
    setLinkScrapeStates({});
    setMethod(next);
    setConceptSourceMessage("");
    setStep(0);
    setMaterialsSent(false);
  };

  const gatherLinks = async (
    failedOnly = false,
    automaticLink?: DemoLink,
    isCurrent = () => true,
  ) => {
    const automatic = Boolean(automaticLink);
    const beforeSelections = latestRoomInputs.current.selections;
    if (!automatic) {
      for (const timer of autoLinkTimers.current.values()) clearTimeout(timer);
      autoLinkTimers.current.clear();
      autoLinkVersions.current.clear();
    }
    const instructions: DemoSelection[] =
      failedOnly || automatic
        ? []
        : links
            .filter(
              (link) =>
                !/tile installation defaults/i.test(link.category) &&
                !roomItemNeedsProduct(link) &&
                (link.notes.trim() || roomItemStatus(link) === "TBD"),
            )
            .map((link) => {
              const previous = selections.find((selection) => selection.id === `link-${link.id}`);
              return {
                ...previous,
                id: `link-${link.id}`,
                category: link.category,
                productName: link.catalogProductName || previous?.productName || link.category,
                vendor: previous?.vendor || "",
                finish:
                  roomDetailValue(link.notes, "Selected color / finish") || previous?.finish || "",
                dimensions:
                  roomDetailValue(link.notes, "Selected size / dimensions") || previous?.dimensions,
                source: "Manual board",
                state: "selected",
                swatch: swatchForGroup(link.group),
                group: link.group,
                quantity: link.quantity,
                notes: link.notes,
                url: link.url || undefined,
                productId: link.productId || null,
                scrapeStatus: "complete",
              };
            });
    const linkedItems = (automaticLink ? [automaticLink] : links).filter(
      (link) =>
        roomItemNeedsProduct(link) &&
        (link.url.trim() || link.productId) &&
        (!failedOnly || linkScrapeStates[link.id]?.status === "failed"),
    );
    if (!linkedItems.length) {
      if (instructions.length) {
        addSelections(instructions);
        setBoardReady(false);
        setRenderReady(false);
        setCompletedRenderPreview("");
        setStep(1);
      }
      return;
    }

    if (!automatic) setGathering(true);
    try {
      if (!automatic) setGatherProgress({ ...EMPTY_GATHER_PROGRESS, total: linkedItems.length });
      setLinkScrapeStates((current) => ({
        ...(failedOnly || automatic ? current : {}),
        ...Object.fromEntries(
          linkedItems.map((link) => [
            link.id,
            { status: automatic ? ("scraping" as const) : ("waiting" as const) },
          ]),
        ),
      }));

      const catalogPairs = await Promise.all(
        linkedItems.map(
          async (link) =>
            [
              link.id,
              link.productId
                ? await db.getProduct(link.productId)
                : (await db.listProductsByUrl(link.url.trim()))?.[0],
            ] as const,
        ),
      );
      const catalogByLinkId = new Map(catalogPairs.filter((entry) => Boolean(entry[1])));
      const savedByLinkId = new Map(
        !automatic && !failedOnly
          ? linkedItems.flatMap((link) => {
              const saved = selections.find(
                (item) =>
                  item.id === `link-${link.id}` &&
                  item.url?.trim() === link.url.trim() &&
                  item.state !== "draft" &&
                  item.scrapeStatus !== "failed",
              );
              return saved ? [[link.id, saved] as const] : [];
            })
          : [],
      );
      const linksNeedingScrape = linkedItems.filter(
        (link) =>
          link.url.trim() &&
          !savedByLinkId.has(link.id) &&
          (!catalogByLinkId.has(link.id) || (automatic && !link.productId)),
      );
      let batchResults: Awaited<ReturnType<typeof scrapeProductUrlsBatch>> = [];
      let batchError = "";
      if (linksNeedingScrape.length) {
        try {
          const requestOptions = await pilotRequestOptions();
          batchResults = automatic
            ? [
                {
                  url: linksNeedingScrape[0].url,
                  product: await scrapeProductUrl(linksNeedingScrape[0].url, fetch, requestOptions),
                },
              ]
            : await scrapeProductUrlsBatch(
                linksNeedingScrape.map((link) => link.url),
                fetch,
                {
                  ...requestOptions,
                  onProgress: ({ completed }) =>
                    setGatherProgress((current) => ({
                      ...current,
                      completed: Math.max(current.completed, Math.min(completed, current.total)),
                    })),
                },
              );
        } catch (error) {
          batchError =
            error instanceof Error ? error.message : "The batch queue could not be completed.";
        }
      }
      const batchByUrl = new Map(batchResults.map((result) => [result.url.trim(), result]));

      const gathered: DemoSelection[] = [];
      for (const [index, link] of linkedItems.entries()) {
        if (!isCurrent()) return;
        const fallbackVendor = inferVendorFromUrl(link.url) || "Linked vendor";
        setLinkScrapeStates((current) => ({
          ...current,
          [link.id]: { status: "scraping" },
        }));

        const batchResult = batchByUrl.get(link.url.trim());
        const catalogProduct = catalogByLinkId.get(link.id);
        const saved = savedByLinkId.get(link.id);
        let scraped: ScrapedProductData = saved
          ? {
              name: saved.productName,
              vendor: saved.vendor,
              finish: saved.finish,
              dimensions: saved.dimensions,
              size_options: saved.sizeOptions,
              selected_size: saved.selectedSize,
              price: saved.price,
              sku: saved.sku,
              image_url: saved.imageUrl,
            }
          : batchResult?.product
            ? batchResult.product
            : catalogProduct
              ? {
                  name: catalogProduct.name,
                  vendor: catalogProduct.vendor || undefined,
                  sku: catalogProduct.sku || undefined,
                  finish: catalogProduct.finish || undefined,
                  dimensions: catalogProduct.dimensions || undefined,
                  size_options: catalogProduct.size_options || undefined,
                  selected_size: catalogProduct.selected_size || undefined,
                  price: catalogProduct.price || undefined,
                  image_url: catalogProduct.image_url || undefined,
                }
              : (batchResult?.product ?? {});
        let scrapeStatus: "complete" | "partial" | "failed" = "failed";
        let scrapeError = batchResult?.error || batchError;
        if (!saved && !catalogProduct && !batchResult?.product) {
          try {
            scraped = await scrapeProductUrl(link.url, fetch, {
              maxAttempts: 4,
              ...(await pilotRequestOptions()),
            });
            scrapeError = "";
          } catch (error) {
            scrapeError =
              error instanceof Error ? error.message : "Product page could not be scraped.";
          }
        }
        if (!isCurrent()) return;
        if (Object.keys(scraped).length) scrapeStatus = scrapedProductStatus(scraped);
        scraped = {
          ...scraped,
          finish: cleanProductDetail(scraped.finish),
          color: cleanProductDetail(scraped.color),
        };
        const reviewMessage =
          Object.keys(scraped).length && !link.productId && !saved
            ? productScrapeReviewMessage(link.url, link.category, scraped)
            : "";
        if (reviewMessage) {
          scrapeStatus = "partial";
          scrapeError = reviewMessage;
        }

        let productId = saved?.productId ?? catalogProduct?.id ?? null;
        if (!productId && scraped.name) {
          const category = toProductCategory(
            inferMaterialCategory(`${link.category} ${scraped.name}`, link.url),
          );
          const created = await db.createProduct({
            category,
            name: scraped.name,
            vendor: scraped.vendor || fallbackVendor,
            product_url: link.url,
            image_url: scraped.image_url || null,
            finish: scraped.finish || null,
            sku: scraped.sku || null,
            dimensions: scraped.dimensions || null,
            size_options: scraped.size_options?.length ? scraped.size_options : null,
            selected_size: scraped.selected_size || null,
            price: scraped.price || null,
            notes: `Created by the Room Design V2 pilot for ${project.name}.`,
          });
          productId = created?.id ?? null;
        }
        if (!isCurrent()) return;

        const gatheredSelection: DemoSelection = {
          id: `link-${link.id}`,
          category: link.category,
          productName: scraped.name || `${link.category} selection`,
          vendor: scraped.vendor || fallbackVendor,
          finish:
            roomDetailValue(link.notes, "Selected color / finish") ||
            cleanProductDetail(scraped.finish || scraped.color),
          source: link.productId ? ("Product catalog" as const) : ("Product link" as const),
          state: saved?.state ?? ("selected" as const),
          swatch: swatchForGroup(link.group),
          url: link.url || catalogProduct?.product_url || undefined,
          group: link.group,
          quantity: link.quantity,
          quantityUnit: productAwareQuantityUnit(link.category, scraped.name),
          wastePercent:
            productAwareQuantityUnit(link.category, scraped.name) === "sq ft"
              ? 10
              : defaultWastePercent(link.category),
          notes: roomDesignScrapedNotes(
            link.notes,
            link.category,
            scraped.name || "",
            scraped.finish || "",
          ),
          savedToTemplate: link.saveToTemplate,
          imageUrl: scraped.image_url,
          price: scraped.price,
          sku: scraped.sku,
          dimensions:
            roomDetailValue(link.notes, "Selected size / dimensions") || scraped.dimensions,
          sizeOptions: scraped.size_options,
          selectedSize: scraped.selected_size,
          scrapeStatus,
          scrapeError: saved?.scrapeError || scrapeError || undefined,
          reviewFields: saved?.reviewFields,
          productId,
        };
        const missing = roomDesignProductGaps(gatheredSelection);
        const confirmation = roomDesignConfirmationMessage(gatheredSelection);
        if (scrapeStatus !== "failed") {
          gatheredSelection.scrapeStatus = missing.length || confirmation ? "partial" : "complete";
          if (!confirmation) gatheredSelection.scrapeError = undefined;
        }
        gathered.push(gatheredSelection);
        setLinkScrapeStates((current) => ({
          ...current,
          [link.id]: {
            status: gatheredSelection.scrapeStatus!,
            message:
              [
                missing.length ? `Missing: ${missing.map((gap) => gap.label).join(", ")}.` : "",
                confirmation,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
          },
        }));
        if (!automatic)
          setGatherProgress((current) => ({
            ...current,
            completed: Math.max(current.completed, index + 1),
            successful:
              current.successful + (gatheredSelection.scrapeStatus === "complete" ? 1 : 0),
            partial: current.partial + (gatheredSelection.scrapeStatus === "partial" ? 1 : 0),
            failed: current.failed + (gatheredSelection.scrapeStatus === "failed" ? 1 : 0),
          }));
      }

      if (!isCurrent()) return;
      if (automaticLink) {
        const latest = latestRoomInputs.current;
        const latestLink = latest.links.find((link) => link.id === automaticLink.id);
        if (!latestLink || !gathered[0]) return;
        const next = mergeAutomaticRoomProduct(
          gathered[0],
          beforeSelections.find((item) => item.id === gathered[0].id),
          latest.selections.find((item) => item.id === gathered[0].id),
          latestLink,
        );
        if (!next) return;
        setSelections((current) =>
          current.some((item) => item.id === next.id)
            ? current.map((item) => (item.id === next.id ? next : item))
            : [...current, next],
        );
        const missing = roomDesignProductGaps(next);
        const confirmation = roomDesignConfirmationMessage(next);
        setLinkScrapeStates((current) => ({
          ...current,
          [automaticLink.id]: {
            status:
              next.scrapeStatus === "failed"
                ? "failed"
                : missing.length || confirmation
                  ? "partial"
                  : "complete",
            message:
              [
                missing.length ? `Missing: ${missing.map((gap) => gap.label).join(", ")}.` : "",
                confirmation,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
          },
        }));
      } else addSelections([...gathered, ...instructions]);
      setBoardReady(false);
      setRenderReady(false);
      setCompletedRenderPreview("");
      if (!automatic) setStep(1);
    } catch (error) {
      if (!isCurrent()) return;
      if (automaticLink) {
        setLinkScrapeStates((current) => ({
          ...current,
          [automaticLink.id]: {
            status: "failed",
            message:
              error instanceof Error
                ? error.message
                : "Could not read this product link. You can enter its details manually.",
          },
        }));
      }
      setReviewError(
        error instanceof Error
          ? error.message
          : "Product gathering failed. Your saved selections are still available.",
      );
    } finally {
      if (!automatic) setGathering(false);
    }
  };

  const queueLinkLookup = (link: DemoLink) => {
    const prior = autoLinkTimers.current.get(link.id);
    if (prior) clearTimeout(prior);
    const version = ++autoLinkSequence.current;
    autoLinkVersions.current.set(link.id, version);
    const requestedRoom = roomId;
    const source = roomDesignLinkSourceKey(link);
    if (
      (!link.productId && !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(link.url.trim())) ||
      !roomItemNeedsProduct(link)
    ) {
      setLinkScrapeStates((current) => {
        const next = { ...current };
        delete next[link.id];
        return next;
      });
      return;
    }
    setLinkScrapeStates((current) => ({ ...current, [link.id]: { status: "waiting" } }));
    autoLinkTimers.current.set(
      link.id,
      setTimeout(() => {
        autoLinkTimers.current.delete(link.id);
        const isCurrent = () => {
          const latest = latestRoomInputs.current;
          const currentLink = latest.links.find((item) => item.id === link.id);
          return (
            latest.roomId === requestedRoom &&
            latest.method === "links" &&
            autoLinkVersions.current.get(link.id) === version &&
            Boolean(
              currentLink &&
              roomDesignLinkSourceKey(currentLink) === source &&
              roomItemNeedsProduct(currentLink),
            )
          );
        };
        if (isCurrent()) void gatherLinks(false, link, isCurrent);
      }, 1000),
    );
  };

  const retryFailedLinks = () => {
    setStep(0);
    void gatherLinks(true);
  };

  const replaceSelectionFromUrl = async (id: string, url: string) => {
    const current = selections.find((selection) => selection.id === id);
    if (!current) throw new Error("That board item could not be found.");

    const catalogProduct = (await db.listProductsByUrl(url))?.[0];
    const scraped = catalogProduct
      ? {
          name: catalogProduct.name,
          vendor: catalogProduct.vendor || undefined,
          sku: catalogProduct.sku || undefined,
          finish: catalogProduct.finish || undefined,
          dimensions: catalogProduct.dimensions || undefined,
          size_options: catalogProduct.size_options || undefined,
          selected_size: catalogProduct.selected_size || undefined,
          price: catalogProduct.price || undefined,
          image_url: catalogProduct.image_url || undefined,
        }
      : await scrapeProductUrl(url, fetch, {
          maxAttempts: 4,
          ...(await pilotRequestOptions()),
        });
    let productId = catalogProduct?.id ?? null;
    if (!productId && scraped.name) {
      const created = await db.createProduct({
        category: toProductCategory(
          inferMaterialCategory(`${current.category} ${scraped.name}`, url),
        ),
        name: scraped.name,
        vendor: scraped.vendor || inferVendorFromUrl(url) || null,
        product_url: url,
        image_url: scraped.image_url || null,
        finish: scraped.finish || null,
        sku: scraped.sku || null,
        dimensions: scraped.dimensions || null,
        size_options: scraped.size_options?.length ? scraped.size_options : null,
        selected_size: scraped.selected_size || null,
        price: scraped.price || null,
        notes: `Created by the Room Design V2 pilot for ${project.name}.`,
      });
      productId = created?.id ?? null;
    }
    const scrapeStatus = scrapedProductStatus(scraped);
    const reviewMessage = productScrapeReviewMessage(url, current.category, scraped);
    const updated: DemoSelection = {
      ...current,
      productName: scraped.name || current.productName,
      vendor: scraped.vendor || inferVendorFromUrl(url) || current.vendor,
      finish: cleanProductDetail(scraped.finish || scraped.color),
      url,
      imageUrl: scraped.image_url || current.imageUrl,
      price: scraped.price,
      sku: scraped.sku,
      dimensions: scraped.dimensions,
      sizeOptions: scraped.size_options,
      selectedSize: scraped.selected_size,
      reviewFields: undefined,
      state: "selected",
      scrapeStatus: "partial",
      scrapeError: reviewMessage || "Confirm the replacement product and selected variant.",
      materialsSyncStatus: materialsSent ? "changed" : current.materialsSyncStatus,
      productId,
    };
    setSelections((items) => items.map((selection) => (selection.id === id ? updated : selection)));
    setBoardReady(false);
    setRenderReady(false);
    setCompletedRenderPreview("");
    return updated;
  };

  const replaceSelectionImage = async (id: string, imageUrl: string) => {
    const current = selections.find((selection) => selection.id === id);
    if (!current) throw new Error("That board item could not be found.");
    let storedImageUrl = imageUrl;
    if (imageUrl.startsWith("data:image/")) {
      storedImageUrl = await storeWorkflowImage("product-cutout", imageUrl, () => {});
    }
    const updated = {
      ...current,
      imageUrl: storedImageUrl,
      state: "selected" as const,
      scrapeStatus: "partial" as const,
      scrapeError: "Confirm the replacement image matches this exact product variant.",
      materialsSyncStatus: materialsSent ? ("changed" as const) : current.materialsSyncStatus,
    };
    setSelections((items) => items.map((selection) => (selection.id === id ? updated : selection)));
    setBoardReady(false);
    setRenderReady(false);
    setCompletedRenderPreview("");
    return updated;
  };

  const applyLinks = (proposed: DemoLink[]) => {
    const next = markRoomRelatedChanges(links, proposed);
    setLinks(next);
    setLinkScrapeStates((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) =>
          next.some(
            (link) =>
              link.id === id && roomItemNeedsProduct(link) && (link.url.trim() || link.productId),
          ),
        ),
      ),
    );
    setSelections((current) =>
      current.map((selection) => {
        const link = next.find((item) => `link-${item.id}` === selection.id);
        if (!link) return selection;
        const priorLink = links.find((item) => item.id === link.id);
        const sourceChanged =
          priorLink && (priorLink.url !== link.url || priorLink.productId !== link.productId);
        if (
          !sourceChanged &&
          link.notes === (selection.notes || "") &&
          link.quantity === selection.quantity
        )
          return selection;
        return {
          ...selection,
          quantity: link.quantity,
          ...synchronizeRoomSelectionDetails(selection, { notes: link.notes }),
          state: "selected" as const,
          ...(sourceChanged
            ? {
                state: "draft" as const,
                scrapeStatus: "partial" as const,
                scrapeError: "Gather the updated product link to review this selection.",
              }
            : {}),
          ...(materialsSent ? { materialsSyncStatus: "changed" as const } : {}),
        };
      }),
    );
    setBoardReady(false);
    setRenderReady(false);
    setCompletedRenderPreview("");
  };

  const updateSelection = (id: string, patch: Partial<DemoSelection>) => {
    const previous = selections.find((selection) => selection.id === id);
    if (previous) patch = synchronizeRoomSelectionDetails(previous, patch);
    if (previous && "url" in patch && patch.url !== previous.url)
      patch = { ...patch, productId: null };
    const nextLinks = markRoomRelatedChanges(
      links,
      links.map((item) =>
        `link-${item.id}` === id
          ? {
              ...item,
              ...("quantity" in patch ? { quantity: patch.quantity ?? null } : {}),
              ...("notes" in patch ? { notes: patch.notes ?? "" } : {}),
              ...("url" in patch
                ? { url: patch.url || "", productId: undefined, catalogProductName: undefined }
                : {}),
            }
          : item,
      ),
    );
    setLinks(nextLinks);
    const changedFields = Object.keys(ROOM_DESIGN_REVIEW_FIELDS).filter(
      (key) =>
        key in patch &&
        previous?.[key as keyof DemoSelection] !== patch[key as keyof DemoSelection],
    );
    const detailsChanged = changedFields.length > 0;
    if ("dimensions" in patch) patch = { ...patch, selectedSize: patch.dimensions || undefined };
    const invalidatesReview =
      detailsChanged ||
      Object.keys(patch).some(
        (key) =>
          ["quantity", "quantityUnit", "wastePercent", "notes"].includes(key) &&
          previous?.[key as keyof DemoSelection] !== patch[key as keyof DemoSelection],
      );
    if (invalidatesReview) {
      setBoardReady(false);
      setRenderReady(false);
      setCompletedRenderPreview("");
    }
    const materialFieldsChanged = Object.keys(patch).some((key) =>
      ["quantity", "quantityUnit", "wastePercent", "notes", "finish"].includes(key),
    );
    setSelections((items) =>
      items.map((selection) =>
        selection.id === id
          ? {
              ...selection,
              ...patch,
              ...(invalidatesReview ? { state: "selected" as const } : {}),
              ...(detailsChanged
                ? {
                    scrapeStatus: "partial" as const,
                    scrapeError: "Review the edited product details.",
                    reviewFields: [
                      ...new Set([...(selection.reviewFields ?? []), ...changedFields]),
                    ],
                  }
                : {}),
              ...(materialsSent && materialFieldsChanged
                ? { materialsSyncStatus: "changed" as const }
                : {}),
            }
          : (() => {
              const link = nextLinks.find((item) => `link-${item.id}` === selection.id);
              return link && link.notes !== (selection.notes || "")
                ? {
                    ...selection,
                    notes: link.notes,
                    state: "selected" as const,
                    ...(materialsSent ? { materialsSyncStatus: "changed" as const } : {}),
                  }
                : selection;
            })(),
      ),
    );
  };

  const sourceConcept = async () => {
    setSourcing(true);
    setConceptSourceMessage("");
    try {
      const catalog = (await db.listCatalog()) ?? [];
      const usedProductIds = new Set<string>();
      const matches = links.flatMap((link) => {
        const expectedCategory = toProductCategory(inferMaterialCategory(link.category));
        const product = catalog.find(
          (candidate) =>
            !usedProductIds.has(candidate.id) &&
            candidate.category === expectedCategory &&
            Boolean(candidate.image_url && candidate.product_url),
        );
        if (!product) return [];
        usedProductIds.add(product.id);
        return [
          {
            id: `concept-catalog:${link.id}:${product.id}`,
            category: link.category,
            productName: product.name,
            vendor: product.vendor || "Studio vendor",
            finish: product.finish || "Finish needs review",
            source: "Concept match" as const,
            state: "selected" as const,
            swatch: swatchForGroup(link.group),
            url: product.product_url || undefined,
            imageUrl: product.image_url || undefined,
            group: link.group,
            quantity: link.quantity,
            quantityUnit: defaultQuantityUnit(link.category),
            wastePercent: defaultWastePercent(link.category),
            notes: link.notes,
            price: product.price || undefined,
            sku: product.sku || undefined,
            dimensions: product.dimensions || undefined,
            sizeOptions: product.size_options || undefined,
            selectedSize: product.selected_size || undefined,
            productId: product.id,
            scrapeStatus: "complete" as const,
          },
        ];
      });
      addSelections(matches);
      setConceptSourceMessage(
        matches.length
          ? `${matches.length} real Studio catalog product${matches.length === 1 ? "" : "s"} matched by room category. Review style and finish against the concept before locking.`
          : "No complete Studio catalog products matched this room yet. Use Product Links to add exact products; the concept will remain attached to the rendering handoff.",
      );
      if (matches.length) setStep(1);
    } catch (error) {
      setConceptSourceMessage(
        error instanceof Error
          ? error.message
          : "Studio catalog products could not be loaded. Try again or use Product Links.",
      );
    } finally {
      setSourcing(false);
    }
  };

  const reviewSelection = (id: string) => {
    const selection = selections.find((item) => item.id === id);
    if (!selection) return;
    try {
      const reviewed = confirmRoomDesignSelection(selection);
      setSelections((current) => current.map((item) => (item.id === id ? reviewed : item)));
      setLinks((current) =>
        current.map((link) =>
          `link-${link.id}` === id ? { ...link, notes: reviewed.notes || "" } : link,
        ),
      );
      setReviewError("");
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : "Complete the missing details before reviewing this item.",
      );
    }
  };

  const composeBoard = async () => {
    setReviewError("");
    try {
      await populateStudioDesignBoard(Math.max(1, Math.ceil(selections.length / 18)), selections);
      setStep(2);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Could not save the shared board.");
    }
  };

  const prepareRender = () => {
    if (renderingEnabled) setRenderReady(true);
    setStep(renderingEnabled ? 3 : 4);
  };

  const approveAll = async () => {
    const unresolved = selections.filter(
      (item) => roomDesignSelectionIssues(item).length || roomDesignConfirmationMessage(item),
    );
    if (!selections.length || unresolved.length) {
      setReviewError(
        "Review the highlighted product details and quantities before saving approval.",
      );
      return;
    }
    setReviewError("");
    try {
      await db.appendRoomDesignEvent(
        projectId,
        roomId,
        "selections_reviewed",
        {
          selections: selections.map((item) => ({ ...item, state: "locked" })),
          roomName: activeRoom?.name,
          reviewedAt: new Date().toISOString(),
          scope: "selected-products-only",
        },
        profile.id,
      );
      setSelections((current) =>
        current.map((selection) => ({
          ...selection,
          state: selection.state === "draft" ? "draft" : ("locked" as const),
        })),
      );
      setStep(5);
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "The reviewed version could not be saved.",
      );
    }
  };

  const resetPreview = () => {
    setGathering(false);
    setGatherProgress(EMPTY_GATHER_PROGRESS);
    setLinkScrapeStates({});
    setSelections([]);
    setLinks(linksForRoom(activeRoom?.name ?? "Primary Bathroom"));
    setLinksRoomName(activeRoom?.name ?? "Primary Bathroom");
    setStep(0);
    setBoardReady(false);
    setRenderReady(false);
    setCompletedRenderPreview("");
    setMaterialsSent(false);
  };

  return (
    <AppShell>
      <div className="page-pad max-w-[1720px]">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="eyebrow mb-3">{project.name} · Room Design</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">Room Design</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
              Begin manually, from product links, or from a concept. Every path builds one room
              selection set for the board, {renderingEnabled ? "render, " : ""}approval, Materials,
              Specs, and Procurement.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "text-xs",
                saveStatus === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {saveStatus === "saving"
                ? "Saving to Studio…"
                : saveStatus === "error"
                  ? "Could not save"
                  : "Saved to Studio"}
            </span>
            <Button variant="outline" onClick={resetPreview}>
              <RefreshCw className="h-4 w-4" /> Reset room draft
            </Button>
          </div>
        </header>
        {reviewError && (
          <p role="alert" className="mb-5 border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {reviewError}
          </p>
        )}

        {saveStatus === "error" && saveError && (
          <p role="alert" className="mb-5 text-sm text-destructive">
            {saveError}
          </p>
        )}

        <section className="mb-5 grid gap-3 border border-border bg-bone/25 p-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={projectId} disabled>
              <SelectTrigger>
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={project.id}>{project.name}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Room</Label>
            <Select value={roomId} onValueChange={changeRoom} disabled={!projectId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a room" />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((room) => (
                  <SelectItem key={room.id} value={room.id}>
                    {room.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2 pt-1">
              <Input
                aria-label="New room name"
                value={newRoomName}
                onChange={(event) => setNewRoomName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addRoomToProject();
                }}
                placeholder="Add another room"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void addRoomToProject()}
                disabled={!newRoomName.trim()}
              >
                <Plus /> Add Room
              </Button>
            </div>
          </div>
        </section>

        <WorkflowRail step={step} onStep={setStep} renderingEnabled={renderingEnabled} />

        <div>
          <div className="min-w-0 border border-border bg-background">
            {step === 0 && (
              <StartStep
                renderingEnabled={renderingEnabled}
                method={method}
                onMethod={chooseMethod}
                links={links}
                loadedProducts={selections}
                onLinks={applyLinks}
                onLookupLink={queueLinkLookup}
                projectDefaultLinks={projectDefaultLinks}
                onOpenDefaults={
                  defaultsRoom && defaultsRoom.id !== roomId
                    ? () => changeRoom(defaultsRoom.id)
                    : undefined
                }
                gathering={gathering}
                gatherProgress={gatherProgress}
                linkScrapeStates={linkScrapeStates}
                onGather={() => gatherLinks()}
                onRetryFailed={retryFailedLinks}
                conceptPreview={conceptPreview}
                roomPreview={roomPreview}
                planPreview={planPreview}
                sketchupPreview={sketchupPreview}
                onConcept={(value) =>
                  void storeWorkflowImage("concept-board", value, setConceptPreview)
                }
                onRoom={(value) => void storeWorkflowImage("room-photo", value, setRoomPreview)}
                onPlan={(value) => void storeWorkflowImage("floor-plan", value, setPlanPreview)}
                onSketchup={(value) =>
                  void storeWorkflowImage("sketchup-view", value, setSketchupPreview)
                }
                sourcing={sourcing}
                onSource={sourceConcept}
                conceptSourceMessage={conceptSourceMessage}
                projectId={projectId}
                projectName={project.name}
                roomId={roomId}
                roomName={activeRoom?.name ?? "Primary Bathroom"}
              />
            )}
            {step === 1 && (
              <SelectionsStep
                selections={selections}
                gathering={gathering}
                onRetryFailed={retryFailedLinks}
                onUpdate={updateSelection}
                onReview={reviewSelection}
                onBack={() => setStep(0)}
                onContinue={composeBoard}
              />
            )}
            {step === 2 && (
              <BoardStep
                renderingEnabled={renderingEnabled}
                selections={selections}
                projectRooms={projectRenderRooms}
                ready={boardReady}
                projectName={project.name}
                roomName={activeRoom?.name ?? "Primary Bathroom"}
                roomId={roomId}
                projectId={projectId}
                onReplaceProduct={replaceSelectionFromUrl}
                onReplaceImage={replaceSelectionImage}
                onUpdate={updateSelection}
                onReview={reviewSelection}
                onPopulateBoard={populateStudioDesignBoard}
                onRemoveBackground={removeSelectionBackground}
                initialStudioPageCount={roomDesignGeneratedPageCount(designBoardState, roomId)}
                materialsSent={materialsSent}
                onBack={() => setStep(1)}
                onContinue={prepareRender}
              />
            )}
            {step === 3 && renderingEnabled && (
              <RenderStep
                boardState={designBoardState}
                selections={selections}
                method={method}
                projectId={projectId}
                roomId={roomId}
                projectName={project.name}
                roomName={activeRoom?.name ?? "Primary Bathroom"}
                conceptPreview={conceptPreview}
                roomPreview={roomPreview}
                planPreview={planPreview}
                sketchupPreview={sketchupPreview}
                onRoom={(value) => void storeWorkflowImage("room-photo", value, setRoomPreview)}
                onPlan={(value) => void storeWorkflowImage("floor-plan", value, setPlanPreview)}
                onSketchup={(value) =>
                  void storeWorkflowImage("sketchup-view", value, setSketchupPreview)
                }
                completedRenderPreview={completedRenderPreview}
                onCompletedRender={(value) =>
                  void storeWorkflowImage("completed-render", value, setCompletedRenderPreview)
                }
                projectRooms={projectRenderRooms}
                onProjectRenders={importProjectRenders}
                onSaveToStudio={saveRenderToStudio}
                ready={renderReady}
                onBack={() => setStep(2)}
                onContinue={() => setStep(4)}
              />
            )}
            {step === 4 && (
              <ApprovalStep
                selections={selections}
                onBack={() => setStep(renderingEnabled ? 3 : 2)}
                onContinue={() => void approveAll()}
              />
            )}
            {step === 5 && (
              <MaterialsStep
                renderingEnabled={renderingEnabled}
                materialItems={materialItems.filter(
                  (item) => item.room_id === roomId && !item.not_needed,
                )}
                selections={selections}
                sent={materialsSent}
                completedRenderPreview={completedRenderPreview}
                projectName={project.name}
                roomName={activeRoom?.name ?? "Primary Bathroom"}
                projectId={projectId}
                onBack={() => setStep(4)}
              />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function WorkflowRail({
  step,
  onStep,
  renderingEnabled,
}: {
  step: number;
  onStep: (step: number) => void;
  renderingEnabled: boolean;
}) {
  const visibleSteps = STEPS.map((label, index) => ({ label, index })).filter(
    ({ index }) => renderingEnabled || index !== 3,
  );
  return (
    <div className="mobile-card-scroll mb-5 border-y border-border bg-background">
      <div className="flex min-w-[900px] items-center px-4 py-3">
        {visibleSteps.map(({ label, index }, position) => (
          <div key={label} className="flex flex-1 items-center">
            <button type="button" onClick={() => onStep(index)} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-[10px]",
                  index < step
                    ? "border-ink bg-ink text-white"
                    : index === step
                      ? "border-brass bg-brass text-white"
                      : "border-border text-muted-foreground",
                )}
              >
                {index < step ? <Check className="h-3.5 w-3.5" /> : position + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-xs",
                  index === step ? "font-medium text-ink" : "text-muted-foreground",
                )}
              >
                {index === 3 ? "*TESTING* Render" : label}
              </span>
            </button>
            {position < visibleSteps.length - 1 && <div className="mx-3 h-px flex-1 bg-border" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function CatalogPickerButton({
  item,
  disabled,
  onSelect,
}: {
  item: DemoLink;
  disabled: boolean;
  onSelect: (product: Product) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const section = catalogSectionForItem(item.category, item.group);
  const { data: catalog = [], isLoading } = useQuery({
    queryKey: ["roomDesignCatalog"],
    queryFn: async () => (await db.listCatalog()) ?? [],
    enabled: open,
  });
  const searchTerms = useMemo(
    () =>
      search
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 1),
    [search],
  );
  const products = useMemo(
    () =>
      catalog
        .filter((product) => productMatchesItemCategory(product, section))
        .filter((product) => {
          if (!searchTerms.length) return true;
          const haystack = [
            product.name,
            product.vendor,
            product.subcategory,
            product.finish,
            product.sku,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return searchTerms.some((term) => haystack.includes(term));
        })
        .sort((left, right) => {
          const score =
            catalogMatchScore(right, item.category) - catalogMatchScore(left, item.category);
          return score || right.updated_at.localeCompare(left.updated_at);
        }),
    [catalog, item.category, searchTerms, section],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Choose ${item.category} from product catalog`}
          className="w-full justify-center"
        >
          <BookOpen /> Catalog
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            Choose {item.category}
          </DialogTitle>
        </DialogHeader>
        <div className="border border-brass/35 bg-bone/35 px-3 py-2 text-xs text-muted-foreground">
          Showing the <span className="font-medium text-ink">{section}</span> section first, with
          the closest matches to {item.category.toLowerCase()} at the top.
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${section.toLowerCase()}`}
            className="pl-9"
          />
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading catalog products…
            </div>
          ) : products.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    onSelect(product);
                    setOpen(false);
                  }}
                  className="flex min-w-0 gap-3 border border-border p-3 text-left transition hover:border-ink"
                >
                  <div className="h-20 w-20 shrink-0 overflow-hidden bg-bone">
                    {product.image_url ? (
                      <img
                        src={normalizeSupabaseImageUrl(product.image_url)}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-wider text-muted-foreground">
                        No image
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 py-0.5">
                    <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                      {product.vendor || section}
                    </div>
                    <div className="mt-1 line-clamp-2 font-display text-base leading-tight">
                      {product.name}
                    </div>
                    <div className="mt-2 truncate text-xs text-muted-foreground">
                      {product.finish || product.subcategory || "Saved catalog product"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No matching products are saved in this catalog section yet.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StartStep(props: {
  renderingEnabled: boolean;
  method: StartMethod;
  onMethod: (method: StartMethod) => void;
  links: DemoLink[];
  loadedProducts: DemoSelection[];
  projectDefaultLinks: DemoLink[];
  onOpenDefaults?: () => void;
  onLinks: (links: DemoLink[]) => void;
  onLookupLink: (link: DemoLink) => void;
  gathering: boolean;
  gatherProgress: GatherProgress;
  linkScrapeStates: Record<string, LinkScrapeState>;
  onGather: () => void | Promise<void>;
  onRetryFailed: () => void;
  conceptPreview: string;
  roomPreview: string;
  planPreview: string;
  sketchupPreview: string;
  onConcept: (url: string) => void;
  onRoom: (url: string) => void;
  onPlan: (url: string) => void;
  onSketchup: (url: string) => void;
  sourcing: boolean;
  onSource: () => void;
  conceptSourceMessage: string;
  projectId: string;
  projectName: string;
  roomId: string;
  roomName: string;
}) {
  const [addingSelection, setAddingSelection] = useState(false);
  const [newSelectionName, setNewSelectionName] = useState("");
  const [newSelectionGroup, setNewSelectionGroup] = useState<BoardGroup>("Architecture / Other");
  const [newSelectionQuantity, setNewSelectionQuantity] = useState<number | null>(null);
  const [newSelectionNotes, setNewSelectionNotes] = useState("");
  const [showNotNeeded, setShowNotNeeded] = useState(false);
  const sortedLinks = [...props.links].sort((left, right) =>
    left.category.localeCompare(right.category, "en", { sensitivity: "base", numeric: true }),
  );
  const visibleLinks = sortedLinks.filter(
    (item) => showNotNeeded || roomItemStatus(item) !== "Not needed",
  );

  const addCustomSelection = () => {
    const category = newSelectionName.trim();
    if (!category) return;
    props.onLinks([
      ...props.links,
      {
        id: `custom-${crypto.randomUUID()}`,
        category,
        url: "",
        group: newSelectionGroup,
        quantity: newSelectionQuantity,
        notes: newSelectionNotes.trim(),
        custom: true,
        saveToTemplate: false,
      },
    ]);
    setNewSelectionName("");
    setNewSelectionGroup("Architecture / Other");
    setNewSelectionQuantity(null);
    setNewSelectionNotes("");
    setAddingSelection(false);
  };

  const methods: Array<{
    id: StartMethod;
    eyebrow: string;
    title: string;
    body: string;
    icon: typeof Palette;
  }> = [
    {
      id: "manual",
      eyebrow: "Current workflow",
      title: "Manual Design Board",
      body: "Upload, paste, arrange, label, and edit the board exactly as you do today.",
      icon: LayoutTemplate,
    },
    {
      id: "links",
      eyebrow: "Checklist workflow",
      title: "Start with Product Links",
      body: "Paste product links or choose saved catalog items, then auto-compose a first board.",
      icon: Link2,
    },
    {
      id: "concept",
      eyebrow: "Discovery workflow",
      title: "Start with a Concept",
      body: "Upload inspiration and room inputs, then source close matches from Studio vendors.",
      icon: WandSparkles,
    },
  ];

  return (
    <div>
      <div className="border-b border-border p-6">
        <div className="eyebrow">Choose how you want to design</div>
        <h2 className="mt-2 font-display text-4xl">Three ways in. One room selection set.</h2>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {methods.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => props.onMethod(item.id)}
                className={cn(
                  "min-h-44 border p-5 text-left transition",
                  props.method === item.id
                    ? "border-ink bg-bone/70 shadow-sm"
                    : "border-border hover:border-ink/50",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="eyebrow">{item.eyebrow}</div>
                  <Icon className="h-5 w-5 text-brass" />
                </div>
                <div className="mt-6 font-display text-2xl">{item.title}</div>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">{item.body}</p>
              </button>
            );
          })}
        </div>
      </div>

      {props.method === "manual" && (
        <div className="p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <div className="eyebrow">Manual stays intact</div>
              <h3 className="mt-2 font-display text-3xl">Keep using the Canva-style board</h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Images, copy/paste, drag, resize, pages, labels, links, background removal, and Send
                to Materials remain available. Board items simply join this same selection set.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild>
                  <Link to="/projects/$id/design-boards" params={{ id: props.projectId }}>
                    <LayoutTemplate /> Open Current Studio Design Board <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
            <div className="grid aspect-[4/3] grid-cols-3 grid-rows-3 gap-2 bg-[#f4f1eb] p-4 shadow-inner">
              <div className="col-span-2 row-span-2 bg-[#d8cbbb]" />
              <div className="rounded-full border-[8px] border-[#a9864d] bg-white" />
              <div className="bg-[#b7936e]" />
              <div className="col-span-2 rounded-t-full bg-white shadow-sm" />
            </div>
          </div>
        </div>
      )}

      {props.method === "links" && (
        <div className="p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-2xl font-bold sm:text-3xl">{props.roomName} checklist</h3>
              <p className="mt-2 text-sm font-normal text-muted-foreground">
                Paste a product link or choose from the catalog. Links fill product details
                automatically; prices can stay blank.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {props.links.length} categories ·{" "}
                {props.links.filter((item) => item.url.trim() || item.productId).length} products
                ready
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddingSelection((current) => !current)}
              >
                <Plus /> Add Selection
              </Button>
            </div>
          </div>
          {addingSelection && (
            <div className="mt-5 border border-brass/45 bg-bone/35 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="eyebrow">Custom room item</div>
                  <div className="mt-1 text-sm font-medium">
                    Add anything missing from the template
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAddingSelection(false)}
                  className="text-xs text-muted-foreground hover:text-ink"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(180px,1fr)_220px_100px]">
                <div className="space-y-1.5">
                  <Label>Selection name</Label>
                  <Input
                    autoFocus
                    value={newSelectionName}
                    onChange={(event) => {
                      const value = event.target.value;
                      setNewSelectionName(value);
                      if (value.trim()) setNewSelectionGroup(classifyBoardGroup(value));
                    }}
                    placeholder="Example: Towel warmer"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Materials group</Label>
                  <Select
                    value={newSelectionGroup}
                    onValueChange={(value) => setNewSelectionGroup(value as BoardGroup)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BOARD_GROUPS.map((group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <RoomDesignQuantityInput
                    aria-label="New selection quantity"
                    value={newSelectionQuantity}
                    onValueChange={setNewSelectionQuantity}
                  />
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                <Label>Notes</Label>
                <Input
                  value={newSelectionNotes}
                  onChange={(event) => setNewSelectionNotes(event.target.value)}
                  placeholder="Placement, finish, size, or anything the team should know"
                />
              </div>
              <div className="mt-4 flex justify-end">
                <Button size="sm" onClick={addCustomSelection} disabled={!newSelectionName.trim()}>
                  <Plus /> Add to checklist
                </Button>
              </div>
            </div>
          )}
          {props.onOpenDefaults && (
            <details className="mt-5 border border-border bg-bone/25 p-3 text-xs">
              <summary className="cursor-pointer font-medium">
                Project-wide defaults & room exceptions
              </summary>
              <p className="mt-3 text-muted-foreground">
                Save shared paint, cabinetry and tile details once in Project-wide finishes. Each
                matching item offers “Use project-wide details” to fill blank fields while keeping
                its room-specific choices.
              </p>
              <button
                type="button"
                onClick={props.onOpenDefaults}
                className="mt-3 underline underline-offset-2"
              >
                Edit project-wide defaults
              </button>
            </details>
          )}
          {/bath|restroom|washroom/i.test(props.roomName) && (
            <details className="mt-5 border border-border bg-bone/25 p-3 text-xs">
              <summary className="cursor-pointer font-medium">Room scope · shower & tub</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(["Shower", "Tub"] as const)
                  .filter((scope) =>
                    props.links.some((link) => isRoomScopeItem(link.category, scope)),
                  )
                  .map((scope) => {
                    return (
                      <label key={scope}>
                        {scope} in this room?
                        <select
                          aria-label={`${scope} in this room`}
                          value={roomScopeValue(props.links, scope)}
                          disabled={props.gathering}
                          onChange={(event) =>
                            props.onLinks(updateRoomScope(props.links, scope, event.target.value))
                          }
                          className="mt-1 block h-9 w-full border border-border bg-background px-2"
                        >
                          <option value="">Confirm scope</option>
                          <option>Included</option>
                          <option>Not included</option>
                        </select>
                      </label>
                    );
                  })}
              </div>
              <p className="mt-3 text-muted-foreground">
                Marking a feature not included keeps its rows saved as “Not needed.” Existing links
                and details are preserved.
              </p>
            </details>
          )}
          <div className="mt-4 flex justify-end">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={showNotNeeded}
                onChange={(event) => setShowNotNeeded(event.target.checked)}
              />
              Show not needed (
              {props.links.filter((link) => roomItemStatus(link) === "Not needed").length})
            </label>
          </div>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {visibleLinks.map((item) => (
              <div
                key={item.id}
                className="grid gap-2 py-3 md:grid-cols-[220px_76px_minmax(0,1fr)_120px_32px] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{item.category}</span>
                    {item.saveToTemplate && (
                      <span className="border border-brass/40 bg-brass/10 px-1.5 py-0.5 text-[8px] uppercase tracking-[.12em] text-amber-800">
                        Template
                      </span>
                    )}
                    {props.linkScrapeStates[item.id] && (
                      <ScrapeStatusPill state={props.linkScrapeStates[item.id]} />
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {item.group}
                    {item.notes ? ` · ${item.notes}` : ""}
                  </div>
                  {item.productId && item.catalogProductName && (
                    <div className="mt-1 truncate text-[10px] font-medium text-amber-800">
                      Catalog: {item.catalogProductName}
                    </div>
                  )}
                </div>
                {/tile installation defaults/i.test(item.category) ? (
                  <span className="text-xs text-muted-foreground">Shared</span>
                ) : (
                  <RoomDesignQuantityInput
                    aria-label={`${item.category} quantity`}
                    value={item.quantity}
                    disabled={props.gathering}
                    onValueChange={(quantity) =>
                      props.onLinks(
                        props.links.map((link) =>
                          link.id === item.id ? { ...link, quantity } : link,
                        ),
                      )
                    }
                  />
                )}
                {/tile installation defaults/i.test(item.category) ? (
                  <span className="text-xs text-muted-foreground md:col-span-2">
                    Shared grout, layout and tile edge choices below
                  </span>
                ) : (
                  <>
                    <Input
                      aria-label={`${item.category} product link`}
                      value={item.url}
                      disabled={props.gathering || roomItemStatus(item) === "Not needed"}
                      onChange={(event) => {
                        const next = {
                          ...item,
                          url: event.target.value,
                          productId: undefined,
                          catalogProductName: undefined,
                        };
                        props.onLinks(
                          props.links.map((link) => (link.id === item.id ? next : link)),
                        );
                        props.onLookupLink(next);
                      }}
                      placeholder={
                        roomItemNeedsProduct(item)
                          ? "Paste product link"
                          : "Product link (optional for this item)"
                      }
                    />
                    <CatalogPickerButton
                      item={item}
                      disabled={props.gathering || roomItemStatus(item) === "Not needed"}
                      onSelect={(product) => {
                        const next = {
                          ...item,
                          productId: product.id,
                          catalogProductName: product.name,
                          url: product.product_url || "",
                        };
                        props.onLinks(
                          props.links.map((link) => (link.id === item.id ? next : link)),
                        );
                        props.onLookupLink(next);
                      }}
                    />
                  </>
                )}
                {item.custom ? (
                  <button
                    type="button"
                    onClick={() => props.onLinks(props.links.filter((link) => link.id !== item.id))}
                    aria-label={`Remove ${item.category}`}
                    className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <span />
                )}
                <div className="space-y-2 md:col-span-full">
                  {props.loadedProducts
                    .filter(
                      (selection) =>
                        selection.id === `link-${item.id}` &&
                        (selection.url || "").trim() === item.url.trim() &&
                        selection.state !== "draft",
                    )
                    .map((selection) => (
                      <div
                        key={selection.id}
                        className="flex items-start gap-3 border-l-2 border-border py-2 pl-3"
                      >
                        <SelectionVisual
                          selection={selection}
                          className="h-12 w-12 shrink-0 border border-border"
                        />
                        <div className="min-w-0 text-xs">
                          <p className="font-semibold">{selection.productName}</p>
                          <p className="mt-1 text-muted-foreground">
                            {[
                              selection.vendor,
                              cleanProductDetail(selection.finish),
                              selection.dimensions,
                              selection.price,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {roomDesignProductGaps(selection).length > 0 && (
                            <p className="mt-1 text-amber-800">
                              To finish:{" "}
                              {roomDesignProductGaps(selection)
                                .map((gap) => gap.label)
                                .join(", ")}
                              . Open Review products to fill these in.
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  {!/tile installation defaults/i.test(item.category) && (
                    <RoomDesignItemDetails
                      category={item.category}
                      productName={item.catalogProductName}
                      notes={item.notes}
                      defaultNotes={
                        roomProjectDefaults(
                          {
                            category: item.category,
                            notes: item.notes,
                            productName: item.catalogProductName,
                          },
                          props.projectDefaultLinks,
                        ).notes
                      }
                      defaultCount={
                        roomProjectDefaults(
                          {
                            category: item.category,
                            notes: item.notes,
                            productName: item.catalogProductName,
                          },
                          props.projectDefaultLinks,
                        ).count
                      }
                      disabled={props.gathering}
                      productSource={[item.productId, item.url].filter(Boolean).join("|")}
                      onChange={(notes) =>
                        props.onLinks(
                          props.links.map((link) =>
                            link.id === item.id ? { ...link, notes } : link,
                          ),
                        )
                      }
                    />
                  )}
                  {roomItemShowsTileFields(item) && (
                    <RoomDesignTileFields
                      category={item.category}
                      productName={item.catalogProductName}
                      notes={item.notes}
                      disabled={props.gathering}
                      productSource={[item.productId, item.url].filter(Boolean).join("|")}
                      onChange={(notes) =>
                        props.onLinks(
                          props.links.map((link) =>
                            link.id === item.id ? { ...link, notes } : link,
                          ),
                        )
                      }
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          {props.renderingEnabled && (
            <div className="mt-6 border border-border bg-bone/25 p-4">
              <div className="eyebrow">*TESTING* · Room inputs for rendering</div>
              <div className="mt-1 text-sm font-medium">
                Add the existing space before you gather products
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                The room photo preserves the architecture and camera angle. A floor plan is optional
                but helps when the layout is changing. Both files are included in the AI rendering
                handoff.
              </p>
              <div className="mt-4 grid max-w-5xl gap-3 sm:grid-cols-3">
                <UploadTile
                  label="Room photo"
                  helper="Used to preserve the room layout"
                  value={props.roomPreview}
                  onChange={props.onRoom}
                  icon={<ImagePlus />}
                />
                <UploadTile
                  label="Floor plan"
                  helper="Optional layout reference"
                  value={props.planPreview}
                  onChange={props.onPlan}
                  icon={<FileImage />}
                />
                <UploadTile
                  label="CAD / SketchUp view"
                  helper="Shown with the finished render"
                  value={props.sketchupPreview}
                  onChange={props.onSketchup}
                  icon={<LayoutTemplate />}
                />
              </div>
            </div>
          )}
          {props.gatherProgress.total > 0 && (
            <div className="mt-5 border border-border bg-bone/30 p-4" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-ink">
                  {props.gathering ? "Gathering product details" : "Product gathering complete"}
                </span>
                <span className="text-muted-foreground">
                  {props.gatherProgress.completed} of {props.gatherProgress.total}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden bg-stone-200">
                <div
                  className="h-full bg-brass transition-[width] duration-300"
                  style={{
                    width: `${Math.round(
                      (props.gatherProgress.completed / props.gatherProgress.total) * 100,
                    )}%`,
                  }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-[.1em] text-muted-foreground">
                <span>{props.gatherProgress.successful} complete</span>
                <span>{props.gatherProgress.partial} need review</span>
                <span>{props.gatherProgress.failed} failed</span>
              </div>
              {!props.gathering && props.gatherProgress.failed > 0 && (
                <Button className="mt-4" size="sm" variant="outline" onClick={props.onRetryFailed}>
                  <RefreshCw /> Retry {props.gatherProgress.failed} failed products
                </Button>
              )}
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <Button
              onClick={props.onGather}
              disabled={
                props.gathering ||
                Object.values(props.linkScrapeStates).some(
                  (state) => state.status === "waiting" || state.status === "scraping",
                ) ||
                !props.links.some(
                  (item) =>
                    item.url.trim() ||
                    item.productId ||
                    (!roomItemNeedsProduct(item) && item.notes.trim()),
                )
              }
            >
              {props.gathering ? <RefreshCw className="animate-spin" /> : <Sparkles />}
              {props.gathering
                ? "Gathering product details..."
                : Object.values(props.linkScrapeStates).some(
                      (state) => state.status === "waiting" || state.status === "scraping",
                    )
                  ? "Reading product links..."
                  : "Review products"}
            </Button>
          </div>
        </div>
      )}

      {props.method === "concept" && (
        <div className="p-6">
          <div>
            <div className="eyebrow">Concept + room inputs</div>
            <h3 className="mt-2 font-display text-3xl">Give Studio the direction and the space</h3>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <UploadTile
              label="Concept board"
              helper="Required for sourcing"
              value={props.conceptPreview}
              onChange={props.onConcept}
              icon={<Palette />}
            />
            {props.renderingEnabled && (
              <>
                <UploadTile
                  label="Room photo"
                  helper="Used for the render"
                  value={props.roomPreview}
                  onChange={props.onRoom}
                  icon={<ImagePlus />}
                />
                <UploadTile
                  label="Floor plan"
                  helper="Optional layout control"
                  value={props.planPreview}
                  onChange={props.onPlan}
                  icon={<FileImage />}
                />
                <UploadTile
                  label="CAD / SketchUp view"
                  helper="Presentation design model"
                  value={props.sketchupPreview}
                  onChange={props.onSketchup}
                  icon={<LayoutTemplate />}
                />
              </>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <p className="max-w-xl text-xs leading-5 text-muted-foreground">
              Studio matches real saved catalog products to this room's categories. Review each
              product's style and finish against the concept before locking it.
              {props.renderingEnabled
                ? " The concept image is also included in the rendering handoff."
                : ""}
            </p>
            <Button onClick={props.onSource} disabled={props.sourcing || !props.conceptPreview}>
              {props.sourcing ? <RefreshCw className="animate-spin" /> : <WandSparkles />}
              {props.sourcing ? "Matching Studio vendors..." : "Source from Studio vendors"}
            </Button>
          </div>
          {props.conceptSourceMessage && (
            <p className="mt-3 border border-border bg-bone/25 p-3 text-xs leading-5 text-muted-foreground">
              {props.conceptSourceMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ScrapeStatusPill({ state }: { state: LinkScrapeState }) {
  const label =
    state.status === "waiting"
      ? "Queued"
      : state.status === "scraping"
        ? "Scraping"
        : state.status === "complete"
          ? "Complete"
          : state.status === "partial"
            ? "Review"
            : "Failed";
  return (
    <span
      title={state.message}
      className={cn(
        "border px-1.5 py-0.5 text-[8px] uppercase tracking-[.12em]",
        state.status === "complete" && "border-emerald-300 bg-emerald-50 text-emerald-800",
        state.status === "partial" && "border-amber-300 bg-amber-50 text-amber-800",
        state.status === "failed" && "border-red-300 bg-red-50 text-red-800",
        (state.status === "waiting" || state.status === "scraping") &&
          "border-border bg-background text-muted-foreground",
      )}
    >
      {state.status === "scraping" && (
        <RefreshCw className="mr-1 inline h-2.5 w-2.5 animate-spin" />
      )}
      {label}
    </span>
  );
}

function UploadTile({
  label,
  helper,
  value,
  onChange,
  icon,
}: {
  label: string;
  helper: string;
  value: string;
  onChange: (value: string) => void;
  icon: ReactNode;
}) {
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ""));
    reader.readAsDataURL(file);
  };
  return (
    <label className="group relative flex aspect-[4/3] cursor-pointer overflow-hidden border border-dashed border-border bg-bone/30 transition hover:border-ink/50">
      {value ? (
        <img src={value} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="m-auto text-center text-muted-foreground">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
            {icon}
          </div>
          <div className="mt-3 text-sm font-medium text-ink">{label}</div>
          <div className="mt-1 text-xs">{helper}</div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ink/85 px-3 py-2 text-white opacity-0 transition group-hover:opacity-100">
        <span className="text-xs">{label}</span>
        <Upload className="h-4 w-4" />
      </div>
      <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </label>
  );
}

function SelectionsStep({
  selections,
  gathering,
  onRetryFailed,
  onUpdate,
  onReview,
  onBack,
  onContinue,
}: {
  selections: DemoSelection[];
  gathering: boolean;
  onRetryFailed: () => void;
  onUpdate: (id: string, patch: Partial<DemoSelection>) => void;
  onReview: (id: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const failedCount = selections.filter((selection) => selection.scrapeStatus === "failed").length;
  const missingProductCount = selections.filter(
    (selection) => roomDesignProductGaps(selection).length,
  ).length;
  return (
    <StepFrame
      eyebrow="Shared room selection set"
      title="Review and lock the products that move forward"
      onBack={onBack}
      action={
        <div className="flex flex-wrap gap-2">
          {failedCount > 0 && (
            <Button variant="outline" onClick={onRetryFailed} disabled={gathering}>
              <RefreshCw className={cn(gathering && "animate-spin")} /> Retry {failedCount} failed
            </Button>
          )}
          <Button onClick={onContinue} disabled={!selections.length || gathering}>
            Compose Design Board <ArrowRight />
          </Button>
        </div>
      }
    >
      {!selections.length ? (
        <EmptyState
          icon={<ClipboardList />}
          title="No selections yet"
          body="Return to Start and use any of the three design methods. Their products will appear here together."
        />
      ) : (
        <div>
          {missingProductCount > 0 && (
            <div
              role="status"
              className="mb-5 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
            >
              <p className="font-medium">
                Missing product information on {missingProductCount}{" "}
                {missingProductCount === 1 ? "item" : "items"}
              </p>
              <p className="mt-1">
                Some information wasn’t available from the links. Fill in the highlighted fields
                below. Each callout clears when its missing information is entered.
              </p>
            </div>
          )}
          <div className="divide-y divide-border border-y border-border">
            {selections.map((selection) => (
              <SelectionRow
                key={selection.id}
                selection={selection}
                stackAction
                action={
                  <div className="space-y-4">
                    {roomItemNeedsProduct(selection) && (
                      <QuantityEditor selection={selection} onUpdate={onUpdate} compact />
                    )}
                    <ProductDetailsEditor
                      selection={selection}
                      onUpdate={onUpdate}
                      onReview={onReview}
                    />
                  </div>
                }
              />
            ))}
          </div>
        </div>
      )}
    </StepFrame>
  );
}

function splitSelectionsIntoPages(selections: DemoSelection[], pageCount: number) {
  const safePageCount = Math.max(1, Math.min(pageCount, Math.max(1, selections.length)));
  const basePageSize = Math.floor(selections.length / safePageCount);
  const remainder = selections.length % safePageCount;
  let offset = 0;

  return Array.from({ length: safePageCount }, (_, pageIndex) => {
    const pageSize = basePageSize + (pageIndex < remainder ? 1 : 0);
    const pageSelections = selections.slice(offset, offset + pageSize);
    offset += pageSize;
    return pageSelections;
  });
}

function initialStudioBoardPageCount(selectionCount: number, savedPageCount = 0) {
  const maximumPageCount = Math.max(1, selectionCount);
  const stockPageCount = Math.max(1, Math.ceil(selectionCount / 18));
  return Math.min(savedPageCount || stockPageCount, maximumPageCount);
}

function FullProjectBoardOverview({
  projectName,
  rooms,
}: {
  projectName: string;
  rooms: ProjectRenderRoom[];
}) {
  const roomsWithSelections = rooms.filter((room) => room.selections.length > 0);
  const totalSelections = roomsWithSelections.reduce(
    (total, room) => total + room.selections.length,
    0,
  );
  const [activeRoomId, setActiveRoomId] = useState(roomsWithSelections[0]?.id ?? "");
  const [activePageByRoom, setActivePageByRoom] = useState<Record<string, number>>({});
  const activeRoom =
    roomsWithSelections.find((room) => room.id === activeRoomId) ?? roomsWithSelections[0];
  const activeRoomPageCount = activeRoom
    ? Math.max(1, Math.ceil(activeRoom.selections.length / 20))
    : 1;
  const activeRoomPages = activeRoom
    ? splitSelectionsIntoPages(activeRoom.selections, activeRoomPageCount)
    : [];
  const activePage = activeRoom
    ? Math.min(activePageByRoom[activeRoom.id] ?? 0, activeRoomPages.length - 1)
    : 0;
  const visibleSelections = activeRoomPages[activePage] ?? [];

  return (
    <div className="mx-auto max-w-[1320px] overflow-hidden bg-[#faf9f6] p-5 shadow-2xl sm:p-9">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 pb-5">
        <div>
          <div className="text-[9px] uppercase tracking-[.35em] text-stone-500">{projectName}</div>
          <div className="mt-1 font-display text-xl uppercase sm:text-3xl">
            Full Project Design Board
          </div>
        </div>
        <div className="text-[9px] uppercase tracking-[.22em] text-stone-500">
          {roomsWithSelections.length} rooms · {totalSelections} selections
        </div>
      </div>

      {roomsWithSelections.length ? (
        <div className="mt-5">
          <div className="border border-stone-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[8px] font-semibold uppercase tracking-[.18em] text-stone-500">
                Rooms
              </span>
              {roomsWithSelections.map((room) => (
                <Button
                  key={room.id}
                  size="sm"
                  variant={room.id === activeRoom?.id ? "default" : "outline"}
                  onClick={() => setActiveRoomId(room.id)}
                >
                  {room.name}
                </Button>
              ))}
            </div>
            {activeRoom && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
                <span className="mr-1 text-[8px] font-semibold uppercase tracking-[.18em] text-stone-500">
                  Pages
                </span>
                {activeRoomPages.map((pageSelections, pageIndex) => (
                  <Button
                    key={pageIndex}
                    size="sm"
                    variant={pageIndex === activePage ? "default" : "outline"}
                    onClick={() =>
                      setActivePageByRoom((current) => ({
                        ...current,
                        [activeRoom.id]: pageIndex,
                      }))
                    }
                  >
                    Page {pageIndex + 1} · {pageSelections.length} items
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 bg-[#d9d4cc] p-4 sm:p-8">
            <StudioCutoutBoard
              selections={visibleSelections}
              cutouts={{}}
              projectName={projectName}
              roomName={activeRoom?.name ?? "Room"}
              pageLabel={
                activeRoomPages.length > 1
                  ? `Page ${activePage + 1} of ${activeRoomPages.length}`
                  : undefined
              }
              selectedId={null}
              draggingId={null}
              onSelect={() => undefined}
              onPointerDown={() => undefined}
              onPointerMove={() => undefined}
              onPointerUp={() => undefined}
              onPointerCancel={() => undefined}
            />
          </div>
          <div className="mt-3 text-center text-[8px] uppercase tracking-[.2em] text-stone-400">
            Choose a room, then choose a page
          </div>
        </div>
      ) : (
        <div className="py-16 text-center">
          <p className="font-display text-2xl uppercase">No room boards yet</p>
          <p className="mt-2 text-sm text-stone-500">
            Gather and compose selections in a room to add it to this project board.
          </p>
        </div>
      )}
    </div>
  );
}

function BoardStep({
  renderingEnabled,
  selections,
  projectRooms,
  ready,
  projectName,
  roomName,
  roomId,
  projectId,
  onReplaceProduct,
  onReplaceImage,
  onUpdate,
  onReview,
  onPopulateBoard,
  onRemoveBackground,
  initialStudioPageCount,
  materialsSent,
  onBack,
  onContinue,
}: {
  renderingEnabled: boolean;
  selections: DemoSelection[];
  projectRooms: ProjectRenderRoom[];
  ready: boolean;
  projectName: string;
  roomName: string;
  roomId: string;
  projectId: string;
  onReplaceProduct: (id: string, url: string) => Promise<DemoSelection>;
  onReplaceImage: (id: string, imageUrl: string) => Promise<DemoSelection>;
  onUpdate: (id: string, patch: Partial<DemoSelection>) => void;
  onReview: (id: string) => void;
  onPopulateBoard: (pageCount: number, selections: DemoSelection[]) => Promise<void>;
  onRemoveBackground: (imageUrl: string) => Promise<string>;
  initialStudioPageCount: number;
  materialsSent: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [boardView, setBoardView] = useState<"studio" | "grid">("studio");
  const showFullProjectBoard = false;
  const [boardPagination, setBoardPagination] = useState<
    Record<"studio" | "grid", { pageCount: number; activePage: number }>
  >(() => ({
    studio: {
      pageCount: initialStudioBoardPageCount(selections.length, initialStudioPageCount),
      activePage: 0,
    },
    grid: { pageCount: 1, activePage: 0 },
  }));
  const boardRoomKeyRef = useRef(`${projectId}:${roomId}`);
  const [boardOrders, setBoardOrders] = useState<Record<"studio" | "grid", string[]>>(() => {
    const selectionIds = selections.map((selection) => selection.id);
    return { studio: selectionIds, grid: selectionIds };
  });
  const [draggingSelectionId, setDraggingSelectionId] = useState<string | null>(null);
  const dragGesture = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressBoardClickUntil = useRef(0);
  const [cutouts, setCutouts] = useState<Record<string, string>>({});
  const [cutoutProgress, setCutoutProgress] = useState({ running: false, completed: 0, total: 0 });
  const [cutoutFailures, setCutoutFailures] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replacementUrl, setReplacementUrl] = useState("");
  const [replaceState, setReplaceState] = useState<{
    status: "idle" | "working" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const [populateState, setPopulateState] = useState<{
    status: "idle" | "saving" | "saved" | "error";
    message?: string;
  }>({ status: "idle" });
  const selectedSelection = selections.find((selection) => selection.id === selectedId);
  const cuttableSelections = selections.filter(
    (selection) => selection.imageUrl && !isStudioMaterialSwatch(selection.category),
  );
  const preparedCutoutCount = cuttableSelections.filter(
    (selection) => cutouts[selection.id],
  ).length;
  const materialSwatchCount = selections.filter(
    (selection) => selection.imageUrl && isStudioMaterialSwatch(selection.category),
  ).length;
  const boardPageCount = boardPagination[boardView].pageCount;
  const activeBoardPage = boardPagination[boardView].activePage;
  const orderedSelections = useMemo(() => {
    const selectionById = new Map(selections.map((selection) => [selection.id, selection]));
    return boardOrders[boardView]
      .map((id) => selectionById.get(id))
      .filter((selection): selection is DemoSelection => Boolean(selection));
  }, [boardOrders, boardView, selections]);
  const boardPages = useMemo(
    () => splitSelectionsIntoPages(orderedSelections, boardPageCount),
    [orderedSelections, boardPageCount],
  );
  const currentPageSelections = boardPages[activeBoardPage] ?? boardPages[0] ?? [];

  const populateCurrentRoomBoard = async () => {
    const eligibleSelections = orderedSelections.filter(
      (selection) => selection.state !== "draft" && Boolean(selection.imageUrl),
    );
    const boardSelections: DemoSelection[] = [];
    for (const selection of eligibleSelections) {
      const boardImageUrl = cutouts[selection.id] || selection.imageUrl;
      boardSelections.push({
        ...selection,
        originalImageUrl: selection.originalImageUrl || selection.imageUrl,
        imageUrl: boardImageUrl,
      });
    }
    if (!boardSelections.length) {
      setPopulateState({
        status: "error",
        message: "Add at least one real product image before building the Studio board.",
      });
      return false;
    }
    setPopulateState({ status: "saving", message: "Adding this room to the Studio board…" });
    try {
      await onPopulateBoard(boardPagination.studio.pageCount, boardSelections);
      setPopulateState({
        status: "saved",
        message:
          "This room is current on the shared Studio design board. Product backgrounds will finish cleaning inside the full editor.",
      });
      return true;
    } catch (error) {
      setPopulateState({
        status: "error",
        message: error instanceof Error ? error.message : "The Studio board could not be updated.",
      });
      return false;
    }
  };

  const openFullProjectBoard = async () => {
    const saved = await populateCurrentRoomBoard();
    if (!saved) return;
    window.location.assign(
      `/projects/${encodeURIComponent(projectId)}/design-boards?roomId=${encodeURIComponent(roomId)}`,
    );
  };

  useEffect(() => {
    const boardRoomKey = `${projectId}:${roomId}`;
    if (boardRoomKeyRef.current === boardRoomKey) return;
    boardRoomKeyRef.current = boardRoomKey;
    setBoardPagination({
      studio: {
        pageCount: initialStudioBoardPageCount(selections.length, initialStudioPageCount),
        activePage: 0,
      },
      grid: { pageCount: 1, activePage: 0 },
    });
  }, [initialStudioPageCount, projectId, roomId, selections.length]);

  useEffect(() => {
    const maximumPageCount = Math.max(1, selections.length);
    setBoardPagination((current) => {
      const clamp = (pagination: { pageCount: number; activePage: number }) => {
        const pageCount = Math.min(pagination.pageCount, maximumPageCount);
        return {
          pageCount,
          activePage: Math.min(pagination.activePage, pageCount - 1),
        };
      };
      return { studio: clamp(current.studio), grid: clamp(current.grid) };
    });
    const selectionIds = selections.map((selection) => selection.id);
    const selectionIdSet = new Set(selectionIds);
    setBoardOrders((current) => {
      const syncOrder = (order: string[]) => [
        ...order.filter((id) => selectionIdSet.has(id)),
        ...selectionIds.filter((id) => !order.includes(id)),
      ];
      return { studio: syncOrder(current.studio), grid: syncOrder(current.grid) };
    });
  }, [roomId, selections]);

  const updateCurrentPagination = (
    update: (current: { pageCount: number; activePage: number }) => {
      pageCount: number;
      activePage: number;
    },
  ) => {
    setBoardPagination((current) => ({
      ...current,
      [boardView]: update(current[boardView]),
    }));
  };

  const changeBoardView = (nextView: "studio" | "grid") => {
    setBoardView(nextView);
    setSelectedId(null);
    setReplaceState({ status: "idle" });
  };

  const reorderCurrentBoard = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setBoardOrders((current) => {
      const order = [...current[boardView]];
      const sourceIndex = order.indexOf(sourceId);
      const targetIndex = order.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const [movedId] = order.splice(sourceIndex, 1);
      order.splice(targetIndex, 0, movedId);
      return { ...current, [boardView]: order };
    });
  };

  const handleBoardPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    selection: DemoSelection,
  ) => {
    if (event.button !== 0) return;
    dragGesture.current = {
      id: selection.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingSelectionId(selection.id);
  };

  const handleBoardPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (
      !gesture.moved &&
      Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 7
    ) {
      return;
    }
    gesture.moved = true;
    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-board-selection-id]");
    const targetId = target?.dataset.boardSelectionId;
    if (targetId && targetId !== gesture.id) reorderCurrentBoard(gesture.id, targetId);
  };

  const finishBoardDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.moved) suppressBoardClickUntil.current = Date.now() + 300;
    dragGesture.current = null;
    setDraggingSelectionId(null);
  };

  const selectBoardItem = (selection: DemoSelection) => {
    if (Date.now() < suppressBoardClickUntil.current) return;
    selectForReplacement(selection);
  };

  const addBoardPage = () => {
    const nextPageCount = Math.min(boardPageCount + 1, Math.max(1, selections.length));
    updateCurrentPagination(() => ({
      pageCount: nextPageCount,
      activePage: nextPageCount - 1,
    }));
    setPopulateState({ status: "idle" });
    setSelectedId(null);
    setReplaceState({ status: "idle" });
  };

  const removeBoardPage = () => {
    const nextPageCount = Math.max(1, boardPageCount - 1);
    updateCurrentPagination((current) => ({
      pageCount: nextPageCount,
      activePage: Math.min(current.activePage, nextPageCount - 1),
    }));
    setPopulateState({ status: "idle" });
    setSelectedId(null);
    setReplaceState({ status: "idle" });
  };

  const prepareStudioCutouts = async () => {
    const pending = cuttableSelections.filter((selection) => !cutouts[selection.id]);
    if (!pending.length) return;
    setCutoutFailures(0);
    setCutoutProgress({ running: true, completed: 0, total: pending.length });
    let failures = 0;
    let completed = 0;
    for (const selection of pending) {
      try {
        const cutout = await onRemoveBackground(selection.imageUrl!);
        setCutouts((current) => ({ ...current, [selection.id]: cutout }));
      } catch {
        failures += 1;
      } finally {
        completed += 1;
        setCutoutProgress({ running: true, completed, total: pending.length });
      }
    }
    setCutoutFailures(failures);
    setCutoutProgress({ running: false, completed: pending.length, total: pending.length });
  };

  const selectForReplacement = (selection: DemoSelection) => {
    setSelectedId(selection.id);
    setReplacementUrl(selection.url || "");
    setReplaceState({ status: "idle" });
  };

  const refreshReplacementCutout = async (selection: DemoSelection) => {
    setCutouts((current) => {
      const next = { ...current };
      delete next[selection.id];
      return next;
    });
    if (!selection.imageUrl || isStudioMaterialSwatch(selection.category)) return;
    try {
      const cutout = await onRemoveBackground(selection.imageUrl);
      setCutouts((current) => ({ ...current, [selection.id]: cutout }));
    } catch {
      // The original stays visible when a vendor blocks automated image downloads.
    }
  };

  const restoreOriginalBackground = () => {
    if (!selectedSelection || !cutouts[selectedSelection.id]) return;
    setCutouts((current) => {
      const next = { ...current };
      delete next[selectedSelection.id];
      return next;
    });
    setReplaceState({
      status: "success",
      message: "Original product image restored. Product details and board position were kept.",
    });
  };

  const replaceFromProductLink = async () => {
    if (!selectedSelection || !replacementUrl.trim()) return;
    setReplaceState({ status: "working", message: "Gathering the replacement product…" });
    try {
      const updated = await onReplaceProduct(selectedSelection.id, replacementUrl.trim());
      await refreshReplacementCutout(updated);
      setReplaceState({ status: "success", message: "Product replaced on this board." });
    } catch (error) {
      setReplaceState({
        status: "error",
        message: error instanceof Error ? error.message : "The replacement could not be gathered.",
      });
    }
  };

  const replaceFromImageUrl = async () => {
    if (!selectedSelection || !replacementUrl.trim()) return;
    setReplaceState({ status: "working", message: "Preparing the replacement image…" });
    try {
      const updated = await onReplaceImage(selectedSelection.id, replacementUrl.trim());
      await refreshReplacementCutout(updated);
      setReplaceState({ status: "success", message: "Image replaced on this board." });
    } catch (error) {
      setReplaceState({
        status: "error",
        message: error instanceof Error ? error.message : "The image could not be replaced.",
      });
    }
  };

  const uploadReplacementImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedSelection) return;
    setReplaceState({ status: "working", message: "Preparing the uploaded image…" });
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const updated = await onReplaceImage(selectedSelection.id, String(reader.result));
        await refreshReplacementCutout(updated);
        setReplaceState({ status: "success", message: "Uploaded image replaced on this board." });
      } catch (error) {
        setReplaceState({
          status: "error",
          message: error instanceof Error ? error.message : "The image could not be replaced.",
        });
      }
    };
    reader.onerror = () =>
      setReplaceState({ status: "error", message: "The uploaded image could not be read." });
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  return (
    <StepFrame
      eyebrow="Design Board"
      title="One board, regardless of how selections were found"
      onBack={onBack}
      action={
        <Button onClick={onContinue} disabled={!selections.length}>
          {renderingEnabled ? "Use board for *TESTING* render" : "Review selections"} <ArrowRight />
        </Button>
      }
    >
      <div className="mb-4 border border-border bg-bone/25 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void populateCurrentRoomBoard()}
              disabled={!selections.length || populateState.status === "saving"}
            >
              {populateState.status === "saving" ? (
                <RefreshCw className="animate-spin" />
              ) : (
                <LayoutTemplate />
              )}
              {populateState.status === "saved" || initialStudioPageCount > 0
                ? "Update Studio Design Board"
                : "Populate Studio Design Board"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openFullProjectBoard()}
              disabled={!selections.length || populateState.status === "saving"}
            >
              Open Full Project Board <ExternalLink />
            </Button>
            {!showFullProjectBoard && (
              <>
                <Button
                  size="sm"
                  variant={boardView === "studio" ? "default" : "outline"}
                  onClick={() => changeBoardView("studio")}
                >
                  Studio cutout board
                </Button>
                <Button
                  size="sm"
                  variant={boardView === "grid" ? "default" : "outline"}
                  onClick={() => changeBoardView("grid")}
                >
                  Clean grid
                </Button>
              </>
            )}
          </div>
          {!showFullProjectBoard && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={addBoardPage}
                disabled={!selections.length || boardPageCount >= selections.length}
              >
                <Plus /> Add Page & Split Items
              </Button>
              {boardPageCount > 1 && (
                <Button size="sm" variant="ghost" onClick={removeBoardPage}>
                  <Trash2 /> Remove Page
                </Button>
              )}
            </div>
          )}
        </div>
        {populateState.message && (
          <p
            className={cn(
              "mt-3 text-xs",
              populateState.status === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {populateState.message}
          </p>
        )}
        {!populateState.message && initialStudioPageCount > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {ready
              ? "Shared board saved. Open it to send this room to Materials."
              : "Selections changed. Update the Studio Design Board before sending it to Materials."}
          </p>
        )}
        {!showFullProjectBoard && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[9px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
                {boardView === "studio" ? "Cutout pages" : "Clean grid pages"}
              </span>
              {boardPages.map((pageSelections, pageIndex) => (
                <Button
                  key={pageIndex}
                  size="sm"
                  variant={activeBoardPage === pageIndex ? "default" : "outline"}
                  onClick={() => {
                    updateCurrentPagination((current) => ({
                      ...current,
                      activePage: pageIndex,
                    }));
                    setSelectedId(null);
                    setReplaceState({ status: "idle" });
                  }}
                >
                  Page {pageIndex + 1} · {pageSelections.length} items
                </Button>
              ))}
              <span className="text-xs text-muted-foreground">
                Items redistribute evenly across every page.
              </span>
            </div>
            {boardView === "studio" && (
              <div className="flex flex-wrap items-center gap-3">
                {(preparedCutoutCount > 0 || materialSwatchCount > 0 || cutoutProgress.running) && (
                  <span className="text-xs text-muted-foreground">
                    {preparedCutoutCount} of {cuttableSelections.length} fixtures cut out
                    {materialSwatchCount ? ` · ${materialSwatchCount} material swatches kept` : ""}
                    {cutoutFailures
                      ? ` · ${cutoutFailures} original${cutoutFailures === 1 ? "" : "s"} preserved`
                      : ""}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={prepareStudioCutouts}
                  disabled={
                    cutoutProgress.running || !selections.some((selection) => selection.imageUrl)
                  }
                >
                  {cutoutProgress.running ? (
                    <RefreshCw className="animate-spin" />
                  ) : (
                    <WandSparkles />
                  )}
                  {cutoutProgress.running
                    ? "Removing backgrounds..."
                    : "Remove product backgrounds"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {!showFullProjectBoard && selectedSelection && (
        <div className="mb-4 border border-border bg-background p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
                Edit {selectedSelection.category}
              </div>
              <div className="mt-1 font-medium">{selectedSelection.productName}</div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedId(null);
                setReplaceState({ status: "idle" });
              }}
            >
              Close
            </Button>
          </div>
          <div className="mt-4 border border-border bg-bone/25 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
              Room Selection Set quantity
            </div>
            <QuantityEditor selection={selectedSelection} onUpdate={onUpdate} />
            <ProductDetailsEditor
              selection={selectedSelection}
              onUpdate={onUpdate}
              onReview={onReview}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              This quantity follows the product into Materials, Specs, and Procurement. The board
              still shows one representative image.
            </p>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="space-y-2">
              <Label htmlFor="board-replacement-url">New product link or direct image URL</Label>
              <Input
                id="board-replacement-url"
                value={replacementUrl}
                onChange={(event) => setReplacementUrl(event.target.value)}
                placeholder="https://vendor.com/product"
                disabled={replaceState.status === "working"}
              />
            </div>
            <Button
              className="self-end"
              onClick={replaceFromProductLink}
              disabled={!replacementUrl.trim() || replaceState.status === "working"}
            >
              {replaceState.status === "working" ? (
                <RefreshCw className="animate-spin" />
              ) : (
                <Link2 />
              )}
              Gather + replace
            </Button>
            <Button
              className="self-end"
              variant="outline"
              onClick={replaceFromImageUrl}
              disabled={!replacementUrl.trim() || replaceState.status === "working"}
            >
              <FileImage /> Use image only
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {cutouts[selectedSelection.id] && (
              <Button
                size="sm"
                variant="outline"
                onClick={restoreOriginalBackground}
                disabled={replaceState.status === "working"}
              >
                <Undo2 /> Restore original background
              </Button>
            )}
            <Label className="inline-flex cursor-pointer items-center gap-2 border border-border px-3 py-2 text-xs font-medium hover:bg-muted">
              <Upload className="h-4 w-4" /> Upload image
              <Input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={uploadReplacementImage}
                disabled={replaceState.status === "working"}
              />
            </Label>
            <span
              className={cn(
                "text-xs",
                replaceState.status === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {replaceState.message || "The category and board position stay the same."}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-border bg-bone/25 p-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
                Materials sync
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {materialsSent
                  ? "This item came from the current Materials record."
                  : "Populate the shared board, then use its existing Send Page to Materials action."}
              </p>
            </div>
            <Button size="sm" variant="outline" asChild>
              <Link to="/projects/$id/design-boards" params={{ id: projectId }}>
                Open Studio Design Board <ExternalLink />
              </Link>
            </Button>
          </div>
        </div>
      )}
      <div className="bg-[#d9d4cc] p-4 sm:p-8">
        {showFullProjectBoard ? (
          <FullProjectBoardOverview projectName={projectName} rooms={projectRooms} />
        ) : boardView === "studio" ? (
          <StudioCutoutBoard
            selections={currentPageSelections}
            cutouts={cutouts}
            projectName={projectName}
            roomName={roomName}
            pageLabel={
              boardPages.length > 1
                ? `Page ${activeBoardPage + 1} of ${boardPages.length}`
                : undefined
            }
            selectedId={selectedId}
            draggingId={draggingSelectionId}
            onSelect={selectBoardItem}
            onPointerDown={handleBoardPointerDown}
            onPointerMove={handleBoardPointerMove}
            onPointerUp={finishBoardDrag}
            onPointerCancel={finishBoardDrag}
          />
        ) : (
          <div className="mx-auto max-w-[1180px] overflow-hidden bg-[#faf9f6] p-5 shadow-2xl sm:p-9">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 pb-5">
              <div>
                <div className="text-[9px] uppercase tracking-[.35em] text-stone-500">
                  {projectName}
                </div>
                <div className="mt-1 font-display text-xl uppercase sm:text-3xl">{roomName}</div>
              </div>
              <div className="text-[9px] uppercase tracking-[.22em] text-stone-500">
                Page {activeBoardPage + 1} of {boardPages.length} · {currentPageSelections.length}{" "}
                selections
              </div>
            </div>
            <div
              className={cn(
                "mt-5 grid items-start gap-3 sm:gap-4",
                currentPageSelections.length <= 8
                  ? "grid-cols-2 sm:grid-cols-4"
                  : currentPageSelections.length <= 15
                    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
                    : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6",
              )}
            >
              {currentPageSelections.map((selection) => (
                <button
                  type="button"
                  key={selection.id}
                  data-board-selection-id={selection.id}
                  onClick={() => selectBoardItem(selection)}
                  onPointerDown={(event) => handleBoardPointerDown(event, selection)}
                  onPointerMove={handleBoardPointerMove}
                  onPointerUp={finishBoardDrag}
                  onPointerCancel={finishBoardDrag}
                  style={{ touchAction: "none" }}
                  className={cn(
                    "relative cursor-grab overflow-hidden border bg-white p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing sm:p-3",
                    selectedId === selection.id
                      ? "border-stone-800 ring-1 ring-stone-800"
                      : "border-stone-200",
                    draggingSelectionId === selection.id &&
                      "z-20 scale-[1.03] opacity-75 shadow-xl",
                  )}
                >
                  <GripVertical className="absolute right-1 top-1 z-10 h-4 w-4 bg-white/85 p-0.5 text-stone-400" />
                  <SelectionVisual
                    selection={selection}
                    className="aspect-[4/3] w-full object-contain"
                  />
                  <div className="mt-2 min-h-7 border-t border-stone-100 pt-2 text-[8px] font-medium uppercase leading-3 tracking-[.12em] sm:text-[9px]">
                    {selection.category}
                  </div>
                  <div className="mt-1 text-[8px] text-stone-500">
                    Qty {roomDesignQuantityLabel(selection.quantity)}{" "}
                    {selectionQuantityUnit(selection)}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-7 text-center text-[8px] uppercase tracking-[.28em] text-stone-400">
              MERAV INTERIORS
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Drag any item to a new position; the surrounding products rearrange automatically. Click
          an item to edit it.
        </p>
        {projectId && !projectId.startsWith("local-") && (
          <Button
            variant="outline"
            onClick={() => void openFullProjectBoard()}
            disabled={!selections.length || populateState.status === "saving"}
          >
            Open full manual editor <ExternalLink />
          </Button>
        )}
      </div>
      {!ready && (
        <p className="mt-3 text-xs text-amber-700">
          Previewing current selections. Compose from the previous step to mark this board ready.
        </p>
      )}
    </StepFrame>
  );
}

function isStudioMaterialSwatch(category: string) {
  return /flooring|wall finish|ceiling finish|vanity finish|countertop|backsplash|shower wall tile|shower floor tile/i.test(
    category,
  );
}

function studioBoardSize(category: string) {
  if (
    /drain|rough.?in|switch|outlet|plate|hardware|hook|accessor|transition|door hardware/i.test(
      category,
    )
  ) {
    return "scale-[.72]";
  }
  if (
    /flooring|wall finish|ceiling finish|vanity layout|vanity construction|countertop|backsplash|shower wall|freestanding tub|mirror/i.test(
      category,
    )
  ) {
    return "scale-105";
  }
  return "scale-90";
}

function studioBoardGrid(itemCount: number) {
  if (itemCount <= 1) return { columns: 1, rows: 1 };
  if (itemCount <= 4) return { columns: 2, rows: 2 };
  if (itemCount <= 6) return { columns: 3, rows: 2 };
  if (itemCount <= 8) return { columns: 4, rows: 2 };
  if (itemCount <= 9) return { columns: 3, rows: 3 };
  if (itemCount <= 10) return { columns: 5, rows: 2 };
  if (itemCount <= 12) return { columns: 4, rows: 3 };
  if (itemCount <= 15) return { columns: 5, rows: 3 };
  if (itemCount <= 16) return { columns: 4, rows: 4 };
  if (itemCount <= 20) return { columns: 5, rows: 4 };
  if (itemCount <= 24) return { columns: 6, rows: 4 };
  return { columns: 6, rows: Math.ceil(itemCount / 6) };
}

function StudioCutoutBoard({
  selections,
  cutouts,
  projectName,
  roomName,
  pageLabel,
  selectedId,
  draggingId,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  selections: DemoSelection[];
  cutouts: Record<string, string>;
  projectName: string;
  roomName: string;
  pageLabel?: string;
  selectedId: string | null;
  draggingId: string | null;
  onSelect: (selection: DemoSelection) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, selection: DemoSelection) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const grid = studioBoardGrid(selections.length);

  return (
    <div className="relative mx-auto aspect-[14/9] max-w-[1180px] overflow-hidden bg-[#faf9f6] shadow-2xl">
      <div className="absolute left-1/2 top-[4.5%] -translate-x-1/2 text-center">
        <div className="text-[7px] uppercase tracking-[.35em] text-stone-500 sm:text-[9px]">
          {projectName}
        </div>
        <div className="mt-1 whitespace-nowrap font-display text-base uppercase sm:text-2xl">
          {roomName}
        </div>
        {pageLabel && (
          <div className="mt-0.5 text-[6px] font-medium uppercase tracking-[.24em] text-stone-400 sm:text-[8px]">
            {pageLabel}
          </div>
        )}
      </div>
      <div className="absolute left-[5%] right-[5%] top-[14%] h-px bg-stone-200" />
      <div
        className="absolute inset-x-[5%] bottom-[10%] top-[16%] grid gap-x-[1.6%] gap-y-[1.5%]"
        style={{
          gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
        }}
      >
        {selections.map((selection) => {
          const isMaterial = isStudioMaterialSwatch(selection.category);
          return (
            <button
              type="button"
              key={selection.id}
              data-board-selection-id={selection.id}
              onClick={() => onSelect(selection)}
              onPointerDown={(event) => onPointerDown(event, selection)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              style={{ touchAction: "none" }}
              aria-label={`Edit ${selection.category}: ${selection.productName}`}
              className={cn(
                "group relative flex min-h-0 cursor-grab flex-col items-center justify-center transition hover:z-20 hover:scale-105 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-700",
                selectedId === selection.id &&
                  "z-20 rounded-sm ring-2 ring-stone-700 ring-offset-2",
                draggingId === selection.id && "z-30 scale-105 opacity-75 drop-shadow-xl",
              )}
            >
              <GripVertical className="absolute right-0 top-0 z-20 h-3.5 w-3.5 bg-white/80 p-0.5 text-stone-400 opacity-0 transition group-hover:opacity-100" />
              <div
                className={cn(
                  "flex min-h-0 flex-1 items-center justify-center",
                  studioBoardSize(selection.category),
                  isMaterial && "h-full w-[82%] overflow-hidden",
                )}
              >
                <img
                  src={
                    isMaterial ? selection.imageUrl : cutouts[selection.id] || selection.imageUrl
                  }
                  alt={selection.productName || selection.category}
                  className={cn(
                    "drop-shadow-[0_8px_10px_rgba(45,37,28,.12)]",
                    isMaterial
                      ? "h-[76%] w-full border border-stone-200 object-cover"
                      : "max-h-full max-w-full object-contain",
                  )}
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="relative z-10 -mt-1 max-w-full bg-white/95 px-1.5 py-1 text-center shadow-sm">
                <div className="line-clamp-2 text-[5px] font-semibold uppercase leading-[1.15] tracking-[.08em] text-stone-800 sm:text-[7px]">
                  {selection.category}
                </div>
                <div className="mt-0.5 text-[5px] text-stone-500 sm:text-[6px]">
                  Qty {roomDesignQuantityLabel(selection.quantity)}{" "}
                  {selectionQuantityUnit(selection)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="absolute bottom-[3.5%] left-1/2 -translate-x-1/2 whitespace-nowrap text-[6px] uppercase tracking-[.32em] text-stone-400 sm:text-[8px]">
        MERAV INTERIORS
      </div>
    </div>
  );
}

function RenderStep({
  boardState,
  selections,
  method,
  projectId,
  roomId,
  projectName,
  roomName,
  conceptPreview,
  roomPreview,
  planPreview,
  sketchupPreview,
  onRoom,
  onPlan,
  onSketchup,
  completedRenderPreview,
  onCompletedRender,
  projectRooms,
  onProjectRenders,
  onSaveToStudio,
  ready,
  onBack,
  onContinue,
}: {
  boardState?: unknown;
  selections: DemoSelection[];
  method: StartMethod;
  projectId: string;
  roomId: string;
  projectName: string;
  roomName: string;
  conceptPreview: string;
  roomPreview: string;
  planPreview: string;
  sketchupPreview: string;
  onRoom: (value: string) => void;
  onPlan: (value: string) => void;
  onSketchup: (value: string) => void;
  completedRenderPreview: string;
  onCompletedRender: (value: string) => void;
  projectRooms: ProjectRenderRoom[];
  onProjectRenders: (renders: Array<{ roomId: string; dataUrl: string }>) => void | Promise<void>;
  onSaveToStudio: () => Promise<void>;
  ready: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [handoffStatus, setHandoffStatus] = useState<
    "idle" | "preparing" | "downloaded" | "copied" | "failed"
  >("idle");
  const [handoffError, setHandoffError] = useState("");
  const [projectHandoffStatus, setProjectHandoffStatus] = useState<
    "idle" | "downloaded" | "imported" | "partial"
  >("idle");
  const [projectImportMessage, setProjectImportMessage] = useState("");
  const [studioSaveStatus, setStudioSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">(
    "idle",
  );
  const [studioSaveMessage, setStudioSaveMessage] = useState("");
  const preparedProjectRooms = projectRooms.filter((room) => room.selections.length > 0);
  const unpreparedRoomCount = projectRooms.length - preparedProjectRooms.length;

  const prepareImage = async (imageUrl: string, targetRoomId: string) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Sign in again before preparing the handoff.");
    const response = await fetch("/api/room-design-image-source", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({
        projectId,
        roomId: targetRoomId,
        imageUrl,
        purpose: "render-handoff",
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.sourceDataUrl)
      throw new Error(result.error || "A reference image could not be downloaded.");
    return result.sourceDataUrl as string;
  };
  const buildHandoff = () =>
    buildRoomHandoffPackage({
      projectName,
      prepareImage,
      boardState,
      room: {
        id: roomId,
        name: roomName,
        outputFilename: `${codexRenderHandoffBaseName(projectName, roomName)}-render.png`,
        method,
        links: [],
        linksRoomName: roomName,
        selections,
        conceptPreview,
        roomPreview,
        planPreview,
        sketchupPreview,
        boardReady: ready,
        renderReady: ready,
        completedRenderPreview,
        materialsSent: false,
      },
    });

  const downloadHandoff = async () => {
    setHandoffStatus("preparing");
    setHandoffError("");
    try {
      const { handoff, markdown, packagedImages, boardSnapshot } = await buildHandoff();
      const files: Record<string, Uint8Array> = {
        "README.md": strToU8(markdown),
        "render-manifest.json": strToU8(JSON.stringify(handoff, null, 2)),
        "design-board.json": strToU8(JSON.stringify(boardSnapshot, null, 2)),
      };
      packagedImages.forEach((image) => {
        files[image.attachment.filename] = image.bytes;
      });
      const archive = zipSync(files, { level: 6 });
      downloadBrowserFile(
        `${codexRenderHandoffBaseName(projectName, roomName)}.zip`,
        archive,
        "application/zip",
      );
      setHandoffStatus("downloaded");
    } catch (error) {
      setHandoffStatus("failed");
      setHandoffError(
        error instanceof Error ? error.message : "The handoff could not be prepared.",
      );
    }
  };

  const copyHandoff = async () => {
    try {
      await navigator.clipboard.writeText((await buildHandoff()).markdown);
      setHandoffStatus("copied");
    } catch {
      setHandoffStatus("failed");
    }
  };

  const downloadProjectHandoff = async () => {
    setHandoffStatus("preparing");
    setHandoffError("");
    try {
      const roomPackages = await Promise.all(
        preparedProjectRooms.map(async (room) => ({
          room,
          package: await buildRoomHandoffPackage({ projectName, room, prepareImage, boardState }),
        })),
      );
      const projectHandoff = createCodexProjectRenderHandoff({
        projectName,
        handoffs: roomPackages.map(({ package: roomPackage }) => roomPackage.handoff),
      });
      const files: Record<string, Uint8Array> = {
        "README.md": strToU8(buildCodexProjectRenderHandoffMarkdown(projectHandoff)),
        "project-render-manifest.json": strToU8(JSON.stringify(projectHandoff, null, 2)),
      };
      projectHandoff.rooms.forEach(({ folder }, index) => {
        const roomPackage = roomPackages[index].package;
        files[`${folder}/README.md`] = strToU8(roomPackage.markdown);
        files[`${folder}/render-manifest.json`] = strToU8(
          JSON.stringify(roomPackage.handoff, null, 2),
        );
        files[`${folder}/design-board.json`] = strToU8(
          JSON.stringify(roomPackage.boardSnapshot, null, 2),
        );
        roomPackage.packagedImages.forEach((image) => {
          files[`${folder}/${image.attachment.filename}`] = image.bytes;
        });
      });
      downloadBrowserFile(
        `${codexProjectRenderHandoffBaseName(projectName)}.zip`,
        zipSync(files, { level: 6 }),
        "application/zip",
      );
      setProjectHandoffStatus("downloaded");
      setHandoffStatus("idle");
    } catch (error) {
      setHandoffStatus("failed");
      setHandoffError(
        error instanceof Error ? error.message : "The project handoff could not be prepared.",
      );
    }
  };

  const importProjectRenderFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosenFiles = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    const expectedRooms = new Map(
      preparedProjectRooms.map((room) => {
        return [room.outputFilename.toLowerCase().replace(/\.[^.]+$/, ""), room] as const;
      }),
    );
    const matches = chosenFiles.flatMap((file) => {
      const room = expectedRooms.get(file.name.toLowerCase().replace(/\.[^.]+$/, ""));
      return room ? [{ file, room }] : [];
    });
    const imported = await Promise.all(
      matches.map(
        ({ file, room }) =>
          new Promise<{ roomId: string; dataUrl: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ roomId: room.id, dataUrl: String(reader.result || "") });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    );
    if (imported.length) await onProjectRenders(imported);
    const unmatchedCount = chosenFiles.length - imported.length;
    setProjectImportMessage(
      imported.length
        ? `${imported.length} render${imported.length === 1 ? "" : "s"} matched to rooms${unmatchedCount ? `; ${unmatchedCount} filename${unmatchedCount === 1 ? "" : "s"} did not match` : ""}.`
        : "No filenames matched the required room output names in the handoff.",
    );
    setProjectHandoffStatus(unmatchedCount || !imported.length ? "partial" : "imported");
    event.target.value = "";
  };

  const saveRenderToStudioPresentation = async () => {
    if (!completedRenderPreview && !sketchupPreview) return;
    setStudioSaveStatus("saving");
    setStudioSaveMessage("Saving the room images as review drafts…");
    try {
      await onSaveToStudio();
      setStudioSaveStatus("saved");
      setStudioSaveMessage(
        completedRenderPreview && sketchupPreview
          ? "Saved as review drafts with the linked Design Model. Approve them in the room before including them in a client presentation."
          : completedRenderPreview
            ? "Saved as a rendering draft. Review it in the room before including it in a client presentation."
            : "Saved as a Design Model reference draft.",
      );
    } catch (error) {
      setStudioSaveStatus("failed");
      setStudioSaveMessage(
        error instanceof Error ? error.message : "The rendering could not be saved to Studio.",
      );
    }
  };

  return (
    <StepFrame
      eyebrow="Room Render"
      title={
        roomPreview
          ? "The room layout stays fixed while products change"
          : "A first room concept built from the selected products"
      }
      onBack={onBack}
      action={
        <Button onClick={onContinue} disabled={!selections.length}>
          Review for approval <ArrowRight />
        </Button>
      }
    >
      <div className="mb-5 border border-border bg-bone/25 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Room inputs</div>
            <div className="mt-1 font-display text-2xl">Attach or replace the room references</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              These are packaged with the selected products when you download the AI rendering
              handoff.
            </p>
          </div>
          {!roomPreview && (
            <span className="border border-amber-300 bg-amber-50 px-3 py-1.5 text-[10px] uppercase tracking-[.12em] text-amber-900">
              No room photo yet
            </span>
          )}
        </div>
        <div className="mt-4 grid max-w-5xl gap-3 sm:grid-cols-3">
          <UploadTile
            label="Room photo"
            helper="Upload the existing room"
            value={roomPreview}
            onChange={onRoom}
            icon={<ImagePlus />}
          />
          <UploadTile
            label="Floor plan"
            helper="Optional layout reference"
            value={planPreview}
            onChange={onPlan}
            icon={<FileImage />}
          />
          <UploadTile
            label="CAD / SketchUp view"
            helper="Appears as the linked Design Model"
            value={sketchupPreview}
            onChange={(value) => {
              onSketchup(value);
              setStudioSaveStatus("idle");
              setStudioSaveMessage("");
            }}
            icon={<LayoutTemplate />}
          />
        </div>
      </div>
      <div className="relative aspect-[16/9] overflow-hidden border border-border bg-[#d8d1c6]">
        {completedRenderPreview ? (
          <img
            src={completedRenderPreview}
            alt="Completed Codex rendering"
            className="h-full w-full object-cover"
          />
        ) : roomPreview ? (
          <img src={roomPreview} alt="Uploaded room" className="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#e8e3db_0%,#f7f4ee_52%,#c9bca9_52.5%,#ded5c8_100%)]">
            <div className="absolute bottom-[14%] left-[13%] h-[28%] w-[42%] bg-[#9f7b59] shadow-xl" />
            <div className="absolute bottom-[42%] left-[19%] h-[34%] w-[14%] rounded-t-full border-[7px] border-[#ac8951] bg-[#f3f1eb]" />
            <div className="absolute bottom-[42%] left-[36%] h-[34%] w-[14%] rounded-t-full border-[7px] border-[#ac8951] bg-[#f3f1eb]" />
            <div className="absolute bottom-[12%] right-[9%] h-[25%] w-[30%] rounded-[50%_50%_18%_18%] bg-white shadow-xl" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-2 bg-gradient-to-t from-black/75 to-transparent px-5 pb-5 pt-14">
          {selections
            .filter((selection) => selection.state !== "draft")
            .slice(0, 6)
            .map((selection) => (
              <span
                key={selection.id}
                className="border border-white/35 bg-black/40 px-2 py-1 text-[10px] text-white backdrop-blur"
              >
                {selection.category}: {selection.productName}
              </span>
            ))}
        </div>
        <div className="absolute left-4 top-4 border border-white/50 bg-white/90 px-3 py-2 text-[10px] uppercase tracking-[.15em]">
          {completedRenderPreview
            ? "Completed Codex render"
            : roomPreview
              ? "Protected room layout"
              : "Concept render · no room photo"}
        </div>
      </div>
      <div className="mt-4 border-l-2 border-brass bg-bone/40 px-4 py-3 text-sm text-muted-foreground">
        {roomPreview
          ? "The room photo controls the architecture and camera. Only the selected products and finishes are replaced."
          : "No room photo is attached, so this is a product-led concept render rather than a fixed-layout edit."}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="border border-border bg-bone/25 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-brass">
              <Archive className="h-5 w-5" />
            </div>
            <div>
              <div className="eyebrow">Use a ChatGPT / Codex plan</div>
              <h3 className="mt-1 font-display text-2xl">*TESTING* · Prepare the render handoff</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The package includes a ready-to-run assignment, product links, a structured
                manifest, and any uploaded room, plan, or concept images. Preparing it sends no paid
                API request.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              onClick={downloadHandoff}
              disabled={!selections.length || handoffStatus === "preparing"}
            >
              <Archive />{" "}
              {handoffStatus === "preparing"
                ? "Preparing reference images…"
                : "Download AI Rendering Handoff"}
            </Button>
            <Button
              variant="outline"
              onClick={copyHandoff}
              disabled={!selections.length || handoffStatus === "preparing"}
            >
              <ClipboardCopy /> Copy instructions
            </Button>
          </div>
          {handoffStatus !== "idle" && (
            <p
              className={cn(
                "mt-3 text-xs",
                handoffStatus === "failed" ? "text-red-700" : "text-emerald-700",
              )}
            >
              {handoffStatus === "preparing"
                ? "Downloading the exact selected images and room references. No image generation is running."
                : handoffStatus === "failed"
                  ? handoffError || "Could not prepare the handoff. Try again."
                  : handoffStatus === "downloaded"
                    ? "Handoff downloaded. Add the ZIP to a Codex task and ask it to complete README.md."
                    : handoffStatus === "copied"
                      ? "Instructions copied. Paste them into an employee's Codex task."
                      : "Clipboard access was unavailable. Download the handoff instead."}
            </p>
          )}
        </div>
        <UploadTile
          label={
            completedRenderPreview ? "Replace completed render" : "Import completed Codex render"
          }
          helper={completedRenderPreview ? "Render imported" : "PNG, JPG, or WebP"}
          value={completedRenderPreview}
          onChange={(value) => {
            onCompletedRender(value);
            setStudioSaveStatus("idle");
            setStudioSaveMessage("");
          }}
          icon={completedRenderPreview ? <CheckCircle2 /> : <ImagePlus />}
        />
      </div>
      {(completedRenderPreview || sketchupPreview) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-border bg-background p-4">
          <div>
            <div className="text-sm font-medium">Ready to keep this rendering?</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Saving creates approved room images and places them on the existing Studio
              presentation layout. When both are supplied, the CAD / SketchUp image appears as the
              linked Design Model view.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {studioSaveMessage && (
              <span
                className={cn(
                  "text-xs",
                  studioSaveStatus === "failed" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {studioSaveMessage}
              </span>
            )}
            <Button
              onClick={saveRenderToStudioPresentation}
              disabled={studioSaveStatus === "saving" || studioSaveStatus === "saved"}
            >
              {studioSaveStatus === "saving" ? (
                <RefreshCw className="animate-spin" />
              ) : studioSaveStatus === "saved" ? (
                <CheckCircle2 />
              ) : (
                <Send />
              )}
              {studioSaveStatus === "saving"
                ? "Saving…"
                : studioSaveStatus === "saved"
                  ? "Saved to Studio"
                  : completedRenderPreview && sketchupPreview
                    ? "Save Render + Design Model"
                    : sketchupPreview
                      ? "Save Design Model draft"
                      : "Save rendering draft"}
            </Button>
            {studioSaveStatus === "saved" && (
              <a
                href={`/presentations/${encodeURIComponent(projectId)}`}
                className="inline-flex h-10 items-center gap-2 border border-ink px-4 text-sm text-ink transition-colors hover:bg-ink hover:text-white"
              >
                <LayoutTemplate className="h-4 w-4" /> Open Studio Presentation
              </a>
            )}
          </div>
        </div>
      )}
      <div className="mt-4 border border-border bg-ink p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="eyebrow text-white/60">All rooms at once</div>
            <h3 className="mt-1 font-display text-2xl">Prepare one project render handoff</h3>
            <p className="mt-2 text-sm leading-6 text-white/65">
              Studio gives every prepared room its own folder, prompt, attachments, selections, and
              required output filename. Codex completes the rooms separately, then Studio matches
              the returned images by filename.
            </p>
          </div>
          <div className="border border-white/20 px-4 py-3 text-right">
            <div className="font-display text-2xl">
              {preparedProjectRooms.length}/{projectRooms.length}
            </div>
            <div className="text-[9px] uppercase tracking-[.14em] text-white/55">Rooms ready</div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            className="bg-white text-ink hover:bg-bone"
            onClick={downloadProjectHandoff}
            disabled={!preparedProjectRooms.length || handoffStatus === "preparing"}
          >
            <Archive />
            {unpreparedRoomCount
              ? `Download ${preparedProjectRooms.length} prepared room${preparedProjectRooms.length === 1 ? "" : "s"}`
              : "Download all-room handoff"}
          </Button>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 border border-white/35 px-4 text-sm font-medium transition hover:bg-white/10">
            <Upload className="h-4 w-4" /> Import project renders
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={importProjectRenderFiles}
            />
          </label>
        </div>
        {unpreparedRoomCount > 0 && (
          <p className="mt-3 text-xs text-amber-200">
            {unpreparedRoomCount} room{unpreparedRoomCount === 1 ? " is" : "s are"} not included
            yet. Choose each room above and add its selections before downloading the complete
            project.
          </p>
        )}
        {projectHandoffStatus === "downloaded" && (
          <p className="mt-3 text-xs text-emerald-200">
            Project handoff downloaded. Add the ZIP to one Codex task and ask it to complete
            README.md.
          </p>
        )}
        {(projectHandoffStatus === "imported" || projectHandoffStatus === "partial") && (
          <p
            className={cn(
              "mt-3 text-xs",
              projectHandoffStatus === "imported" ? "text-emerald-200" : "text-amber-200",
            )}
          >
            {projectImportMessage}
          </p>
        )}
      </div>
      {!ready && (
        <p className="mt-3 text-xs text-amber-700">
          This is a flow preview; no paid rendering request has been sent.
        </p>
      )}
    </StepFrame>
  );
}

function ApprovalStep({
  selections,
  onBack,
  onContinue,
}: {
  selections: DemoSelection[];
  onBack: () => void;
  onContinue: () => void;
}) {
  const unresolved = selections.filter(
    (item) =>
      item.state === "draft" ||
      roomDesignConfirmationMessage(item) ||
      roomDesignSelectionIssues(item).length,
  );
  return (
    <StepFrame
      eyebrow="Approval"
      title="Review selected products before handoff"
      onBack={onBack}
      action={
        <Button onClick={onContinue} disabled={!selections.length || unresolved.length > 0}>
          <ArrowRight /> Save reviewed selections
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_270px]">
        <div className="divide-y divide-border border-y border-border">
          {selections.map((selection) => (
            <SelectionRow
              key={selection.id}
              selection={selection}
              action={
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[.12em]",
                    selection.state === "locked"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-amber-300 bg-amber-50 text-amber-800",
                  )}
                >
                  {selection.state === "locked" ? (
                    <>
                      <Lock className="h-3 w-3" /> Approved
                    </>
                  ) : selection.state === "draft" ? (
                    "Draft · needs product details"
                  ) : (
                    "Review required"
                  )}
                </span>
              }
            />
          ))}
        </div>
        <div className="border border-border bg-bone/30 p-5">
          <BadgeCheck className="h-7 w-7 text-brass" />
          <div className="mt-5 font-display text-2xl">Room approval</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Save an immutable record of these reviewed products. Editing a selection reopens its
            review. This reviews selected products only; unselected checklist items and room layout
            still need separate review. Client approval and ordering remain separate.
          </p>
          <div className="mt-5 text-xs font-medium">
            {unresolved.length
              ? `${unresolved.length} selections need confirmed details or quantities. Return to Selections to resolve them.`
              : "Selected products are ready to record as reviewed."}
          </div>
        </div>
      </div>
    </StepFrame>
  );
}

function MaterialsStep({
  renderingEnabled,
  selections,
  materialItems,
  sent,
  completedRenderPreview,
  projectName,
  roomName,
  projectId,
  onBack,
}: {
  renderingEnabled: boolean;
  selections: DemoSelection[];
  materialItems: MaterialItem[];
  sent: boolean;
  completedRenderPreview: string;
  projectName: string;
  roomName: string;
  projectId: string;
  onBack: () => void;
}) {
  const draftCount = selections.filter((selection) => selection.state === "draft").length;
  const procurementReady = selections.filter(roomDesignOrderReady);
  const procurementReviewCount = selections.length - procurementReady.length;
  const quantityDefinedCount = selections.filter(
    (selection) => (selection.quantity ?? 0) > 0,
  ).length;
  return (
    <StepFrame
      eyebrow="Studio outputs"
      title={sent ? "Continue through the current Studio process" : "Review the downstream handoff"}
      onBack={onBack}
    >
      <div className="mb-5 border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <div className="font-medium">The existing Studio tools stay in control</div>
        <p className="mt-1 text-xs leading-5 text-emerald-900/75">
          {materialItems.length} products are currently saved in this room's Materials and Spec
          Book. Use “Send Page to Materials” in the shared board to save new selections or updates.
          The preview below is your selection draft, not confirmation that those updates were saved.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <Link to="/projects/$id/design-boards" params={{ id: projectId }}>
              Open Design Board <ArrowRight />
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/projects/$id/materials" params={{ id: projectId }}>
              Materials
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/specbooks/$id" params={{ id: projectId }}>
              Spec Book
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`/procurement?project=${encodeURIComponent(projectId)}`}>Procurement</a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/projects/$id/presentation" params={{ id: projectId }}>
              Presentation
            </Link>
          </Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HandoffCard
          icon={<LayoutTemplate />}
          title="Presentation"
          body={
            !renderingEnabled
              ? "The saved Design Board and approved selections can be included in the project presentation."
              : completedRenderPreview
                ? "The imported room render is included with the approved selection summary."
                : "The board can be included after saving it to Studio; the render remains flagged as missing."
          }
          complete={sent}
        />
        <HandoffCard
          icon={<PackageCheck />}
          title="Materials"
          body={`${selections.length} room items carry category, vendor, finish, link, image, and approval state.`}
          complete={sent}
        />
        <HandoffCard
          icon={<BookOpen />}
          title="Spec Book"
          body="Approved Materials remain the shared source for the room's specification pages."
          complete={sent}
        />
        <HandoffCard
          icon={<Send />}
          title="Procurement"
          body="Exact variants and quantities can continue through the existing procurement workflow."
          complete={sent}
        />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.4fr)]">
        <section className="overflow-hidden border border-border bg-background">
          <div className="border-b border-border p-4">
            <div className="text-[10px] uppercase tracking-[.18em] text-muted-foreground">
              Presentation preview
            </div>
            <div className="mt-1 font-display text-2xl">{roomName}</div>
            <div className="text-xs text-muted-foreground">{projectName}</div>
          </div>
          <div className="aspect-[16/10] bg-bone/40">
            {completedRenderPreview ? (
              <img
                src={completedRenderPreview}
                alt={`${roomName} presentation render`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                Import a completed render in the Render step to place it on this presentation page.
              </div>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 border-t border-border p-4">
            {selections.slice(0, 4).map((selection) => (
              <SelectionVisual
                key={selection.id}
                selection={selection}
                className="aspect-square w-full border border-border"
              />
            ))}
          </div>
        </section>

        <section className="overflow-hidden border border-border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <div className="text-[10px] uppercase tracking-[.18em] text-muted-foreground">
                Selection details preview
              </div>
              <div className="mt-1 font-display text-2xl">Room specifications</div>
            </div>
            <div className="text-xs text-muted-foreground">{selections.length} selections</div>
          </div>
          <div className="max-h-[500px] overflow-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="sticky top-0 bg-bone text-[9px] uppercase tracking-[.12em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">SKU / Finish</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Waste / Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {selections.map((selection) => (
                  <tr key={selection.id}>
                    <td className="px-3 py-2 font-medium">{selection.category}</td>
                    <td className="max-w-[220px] truncate px-3 py-2">{selection.productName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{selection.vendor}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {selection.sku || selection.finish || "Needs review"}
                    </td>
                    <td className="px-3 py-2">{roomDesignQuantityLabel(selection.quantity)}</td>
                    <td className="px-3 py-2">{selectionQuantityUnit(selection)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {quantityUnitUsesWaste(selectionQuantityUnit(selection))
                        ? `${selection.wastePercent ?? defaultWastePercent(selection.category)}% / ${roomDesignQuantityLabel(selectionOrderQuantity(selection))}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <div className="mt-5 grid gap-4 border border-border bg-bone/25 p-5 sm:grid-cols-3">
        <Metric value={procurementReady.length} label="Order details complete" />
        <Metric value={procurementReviewCount} label="Needs review" />
        <Metric value={quantityDefinedCount} label="Qty defined" />
      </div>
      <div className="mt-5 border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
        <div className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-5 w-5" />{" "}
          {sent && draftCount
            ? `Materials handoff is current · ${draftCount} draft${draftCount === 1 ? "" : "s"} need review`
            : sent
              ? "Local presentation, spec, and procurement outputs are current"
              : "The Studio handoff is ready to review"}
        </div>
        <p className="mt-2 text-sm leading-6 text-emerald-900/75">
          Manual-board items without enough product information remain reviewable drafts. Linked and
          concept-sourced products retain their product references in the Room Design workflow.
        </p>
      </div>
    </StepFrame>
  );
}

function StepFrame({
  eyebrow,
  title,
  children,
  onBack,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  onBack: () => void;
  action?: ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border p-6">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2 className="mt-2 font-display text-3xl sm:text-4xl">{title}</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          {action}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function SelectionVisual({
  selection,
  className,
}: {
  selection: DemoSelection;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  if (selection.imageUrl && !imageFailed) {
    return (
      <img
        src={selection.imageUrl}
        alt={selection.productName || selection.category}
        className={cn("bg-white object-contain", className)}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <div
      className={className}
      style={{
        background: selection.swatch,
        backgroundSize: selection.category.includes("Floor") ? "22px 22px" : undefined,
      }}
    />
  );
}

function ProductDetailsEditor({
  selection,
  onUpdate,
  onReview,
}: {
  selection: DemoSelection;
  onUpdate: (id: string, patch: Partial<DemoSelection>) => void;
  onReview: (id: string) => void;
}) {
  const blockers = roomDesignReviewBlockers(selection);
  const gaps = roomDesignProductGaps(selection);
  const confirmation = roomDesignConfirmationMessage(selection);
  const gapKey = gaps.map((gap) => gap.field).join("|");
  const [expanded, setExpanded] = useState(gaps.length > 0);
  useEffect(() => {
    if (gapKey) setExpanded(true);
  }, [selection.id, gapKey]);
  return (
    <div className="w-full min-w-0 space-y-3 text-xs">
      {roomItemNeedsProduct(selection) && (
        <RoomDesignDisclosure
          title="Product details"
          label={`${selection.category} product details`}
          status={
            gaps.length
              ? `${gaps.length} missing ${gaps.length === 1 ? "detail" : "details"}`
              : confirmation
                ? "Confirm changes"
                : "Complete"
          }
          description="Name, vendor, color, dimensions, price and links"
          attention={gaps.length > 0}
          expanded={expanded}
          onExpandedChange={setExpanded}
        >
          {gaps.length > 0 && (
            <div role="status" className="mt-3 border-l-2 border-amber-500 pl-3 text-amber-950">
              <p className="font-medium">
                {selection.category}: missing or unconfirmed information
              </p>
              <p className="mt-1">
                {gaps.map((gap) => gap.label).join(" · ")}. Enter the selected product’s details
                below.
              </p>
              {selection.url && (
                <a
                  className="mt-2 inline-block underline underline-offset-2"
                  href={selection.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open product link ↗
                </a>
              )}
            </div>
          )}
          {confirmation && (
            <p role="status" className="mt-3 text-sm text-ink">
              {confirmation}
            </p>
          )}
          {roomItemNeedsProduct(selection) && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["productName", "Product name"],
                  ["vendor", "Vendor"],
                  ["finish", "Color / finish"],
                  ["sku", "SKU / model"],
                  ["dimensions", "Product dimensions"],
                  ["price", "Price"],
                  ["url", "Exact product link"],
                  ["imageUrl", "Selected image URL"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  {key === "price" ? " (optional)" : ""}
                  <Input
                    aria-label={`${selection.category} ${label}`}
                    aria-invalid={gaps.some((gap) => gap.field === key) || undefined}
                    className={
                      gaps.some((gap) => gap.field === key)
                        ? "border-amber-500 bg-amber-50"
                        : undefined
                    }
                    value={selection[key] || ""}
                    placeholder={key === "finish" ? "Selected color / finish or TBD" : undefined}
                    onChange={(event) => onUpdate(selection.id, { [key]: event.target.value })}
                  />
                </label>
              ))}
            </div>
          )}
          {(selection.sizeOptions?.length ?? 0) > 1 && (
            <p className="mt-3 text-muted-foreground">
              Published sizes: {selection.sizeOptions!.join(" · ")}. Enter the selected size in
              Product dimensions.
            </p>
          )}
        </RoomDesignDisclosure>
      )}
      <div className="space-y-3">
        <RoomDesignItemDetails
          category={selection.category}
          itemStatus={roomItemStatus(selection)}
          productName={selection.productName}
          notes={selection.notes}
          productSource={[selection.productId, selection.url].filter(Boolean).join("|")}
          showFitConfirmationAction={false}
          onChange={(notes) => onUpdate(selection.id, { notes })}
        />
        {roomItemShowsTileFields(selection) && (
          <RoomDesignTileFields
            category={selection.category}
            productName={selection.productName}
            notes={selection.notes}
            productSource={[selection.productId, selection.url].filter(Boolean).join("|")}
            onChange={(notes) => onUpdate(selection.id, { notes })}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <Button
          size="sm"
          disabled={blockers.length > 0 || selection.state === "locked"}
          title={blockers.join(" ")}
          onClick={() => onReview(selection.id)}
        >
          {selection.state === "locked" ? <CheckCircle2 /> : <Check />}
          {selection.state === "locked" ? "Reviewed" : "Confirm & mark reviewed"}
        </Button>
        {!!blockers.length && (
          <p role="status" className="text-amber-800">
            Complete the missing details listed above to mark this item reviewed.
          </p>
        )}
      </div>
    </div>
  );
}

function QuantityEditor({
  selection,
  onUpdate,
  compact = false,
}: {
  selection: DemoSelection;
  onUpdate: (id: string, patch: Partial<DemoSelection>) => void;
  compact?: boolean;
}) {
  const unit = selection.quantityUnit ?? defaultQuantityUnit(selection.category);
  const quantity = selection.quantity === null ? null : (selection.quantity ?? 1);
  const wastePercent = selection.wastePercent ?? defaultWastePercent(selection.category);
  const showWaste = quantityUnitUsesWaste(unit);
  const orderQuantity =
    quantity === null
      ? null
      : showWaste
        ? Math.round(quantity * (1 + wastePercent / 100) * 100) / 100
        : quantity;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-[9px] font-medium uppercase tracking-[.12em] text-muted-foreground">
          Qty
          <RoomDesignQuantityInput
            aria-label={`${selection.category} quantity`}
            value={quantity}
            onValueChange={(quantity) =>
              onUpdate(selection.id, {
                quantity,
              })
            }
            className={cn(
              "mt-1 block h-9 border border-border bg-background px-2 text-xs text-ink",
              compact ? "w-16" : "w-24",
            )}
          />
        </label>
        <label className="block text-[9px] font-medium uppercase tracking-[.12em] text-muted-foreground">
          Unit
          <select
            aria-label={`${selection.category} quantity unit`}
            value={unit}
            onChange={(event) => {
              const nextUnit = event.target.value as QuantityUnit;
              onUpdate(selection.id, {
                quantityUnit: nextUnit,
                wastePercent: quantityUnitUsesWaste(nextUnit) ? wastePercent : 0,
              });
            }}
            className={cn(
              "mt-1 block h-9 border border-border bg-background px-2 text-xs normal-case tracking-normal text-ink",
              compact ? "w-24" : "w-32",
            )}
          >
            {QUANTITY_UNITS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {showWaste && (
          <label className="block text-[9px] font-medium uppercase tracking-[.12em] text-muted-foreground">
            Waste %
            <input
              aria-label={`${selection.category} waste percent`}
              type="number"
              min={0}
              max={100}
              step={1}
              value={wastePercent}
              onChange={(event) =>
                onUpdate(selection.id, {
                  wastePercent: Math.max(0, Number(event.target.value) || 0),
                })
              }
              className={cn(
                "mt-1 block h-9 border border-border bg-background px-2 text-xs text-ink",
                compact ? "w-16" : "w-24",
              )}
            />
          </label>
        )}
      </div>
      {!compact && showWaste && (
        <div className="mt-2 text-xs text-muted-foreground">
          Order quantity with waste: {roomDesignQuantityLabel(orderQuantity)} {unit}
        </div>
      )}
    </div>
  );
}

function SelectionRow({
  selection,
  action,
  stackAction = false,
}: {
  selection: DemoSelection;
  action: ReactNode;
  stackAction?: boolean;
}) {
  const gaps = roomDesignProductGaps(selection);
  const issues = roomDesignSelectionIssues(selection);
  const confirmation = roomDesignConfirmationMessage(selection);
  const otherIssues = issues.filter((issue) => !gaps.some((gap) => gap.message === issue));
  const flagged = issues.length > 0 || Boolean(confirmation);
  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center">
      <SelectionVisual selection={selection} className="h-14 w-14 border border-border" />
      <div className={cn("min-w-0", stackAction && "sm:col-span-2")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{selection.category}</span>
          <span className="border border-border bg-bone/30 px-2 py-0.5 text-[9px] uppercase tracking-[.1em] text-muted-foreground">
            {roomItemNeedsProduct(selection) ? selection.source : roomItemStatus(selection)}
          </span>
          {roomItemNeedsProduct(selection) && (
            <span
              title={[...issues, confirmation].filter(Boolean).join(" ")}
              className={cn(
                "border px-2 py-0.5 text-[9px] uppercase tracking-[.1em]",
                issues.length
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : confirmation
                    ? "border-border bg-bone/30 text-ink"
                    : selection.state === "locked"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-border text-muted-foreground",
              )}
            >
              {gaps.length
                ? "Missing information"
                : issues.length
                  ? "Decisions needed"
                  : confirmation
                    ? "Confirm changes"
                    : selection.state === "locked"
                      ? "Reviewed"
                      : "Ready to review"}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {!roomItemNeedsProduct(selection) ? (
            selection.notes || "Add item instructions"
          ) : (
            <>
              {selection.productName} · {selection.vendor} · {selection.finish}
              {selection.quantity !== undefined
                ? ` · Qty ${roomDesignQuantityLabel(selection.quantity)} ${selection.quantityUnit ?? defaultQuantityUnit(selection.category)}`
                : ""}
              {quantityUnitUsesWaste(
                selection.quantityUnit ?? defaultQuantityUnit(selection.category),
              )
                ? ` · ${selection.wastePercent ?? defaultWastePercent(selection.category)}% waste`
                : ""}
              {selection.savedToTemplate ? " · Saved to room template" : ""}
            </>
          )}
        </div>
        {(selection.price || selection.sku || selection.dimensions) && (
          <div className="mt-1 text-xs text-muted-foreground">
            {[selection.price, selection.sku ? `SKU ${selection.sku}` : "", selection.dimensions]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
        {flagged && (
          <div className="mt-2 space-y-1 text-xs" role="status">
            {gaps.length > 0 && (
              <p className="text-amber-800">Missing: {gaps.map((gap) => gap.label).join(", ")}.</p>
            )}
            {otherIssues.map((issue) => (
              <p key={issue} className="text-amber-800">
                {issue}
              </p>
            ))}
            {confirmation && <p className="text-ink">{confirmation}</p>}
          </div>
        )}
      </div>
      <div className={stackAction ? "sm:col-span-full" : undefined}>{action}</div>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="border border-dashed border-border bg-bone/20 p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
        {icon}
      </div>
      <div className="mt-4 font-display text-2xl">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="p-3 text-center">
      <div className="font-display text-2xl">{value}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-[.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function HandoffCard({
  icon,
  title,
  body,
  complete,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  complete: boolean;
}) {
  return (
    <div className="border border-border p-5">
      <div className="flex items-center justify-between">
        <div className="text-brass">{icon}</div>
        {complete && <CheckCircle2 className="h-4 w-4 text-emerald-700" />}
      </div>
      <div className="mt-5 font-display text-2xl">{title}</div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
