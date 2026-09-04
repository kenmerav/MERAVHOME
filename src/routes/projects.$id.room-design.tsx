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
import { classifyBoardGroup, SELECTION_ROOM_TEMPLATES } from "@/lib/selectionChecklist";
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
  roomDesignGeneratedPageCount,
  type RoomDesignWorkflowState,
} from "@/lib/roomDesignWorkflow";
import { canManageStudio } from "@/lib/permissions";
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
  | "each"
  | "pair"
  | "set"
  | "sq ft"
  | "linear ft"
  | "box"
  | "carton"
  | "slab"
  | "roll"
  | "gallon";

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
  quantity?: number;
  quantityUnit?: QuantityUnit;
  wastePercent?: number;
  notes?: string;
  savedToTemplate?: boolean;
  imageUrl?: string;
  originalImageUrl?: string;
  price?: string;
  sku?: string;
  dimensions?: string;
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
  quantity: number;
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

const GENERIC_ROOM_ITEMS = [
  "Flooring",
  "Transitions",
  "Wall finish",
  "Ceiling finish",
  "Lighting",
  "Window treatments",
  "Furniture",
  "Fixtures",
  "Hardware",
  "Accessories",
];

const POWDER_BATHROOM_ITEMS = [
  "Flooring",
  "Transitions",
  "Wall finish",
  "Ceiling finish",
  "Baseboard",
  "Casing",
  "Doors",
  "Door hardware",
  "Vanity layout",
  "Vanity construction + door style",
  "Vanity finish",
  "Vanity hardware",
  "Countertop",
  "Backsplash",
  "Sink",
  "Faucet",
  "Sink drain",
  "Toilet",
  "Mirror",
  "Vanity sconces",
  "Decorative ceiling lighting",
  "Bath accessories",
  "Hooks",
  "Switches",
  "Outlets",
  "Wall plates",
];

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
  const template = SELECTION_ROOM_TEMPLATES.find((candidate) => {
    if (/primary.*bath/i.test(roomName)) return candidate.key === "primary-bathroom";
    if (/kitchen/i.test(roomName)) return candidate.key === "kitchen";
    return candidate.name.toLowerCase() === roomName.toLowerCase();
  });
  const labels = /powder.*bath/i.test(roomName)
    ? POWDER_BATHROOM_ITEMS
    : (template?.items.map((item) => item.label) ?? GENERIC_ROOM_ITEMS);
  return labels.map((category) => {
    const id = itemKey(category);
    return {
      id,
      category,
      url: "",
      group: classifyBoardGroup(category),
      quantity: 1,
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
  const normalized = normalizeRoomDesignWorkflowState(savedState, {
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
  });

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
      normalized.completedRenderImageUrl || latestRoomImage(roomImages, roomId, "rendering"),
    boardReady: normalized.boardReady,
    renderReady: normalized.renderReady,
    materialsSent: normalized.materialsSent,
  };
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

function buildRoomHandoffPackage({
  projectName,
  room,
}: {
  projectName: string;
  room: ProjectRenderRoom;
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
  const packagedImages = imageInputs.map(handoffImageFile).filter(Boolean) as Array<
    NonNullable<ReturnType<typeof handoffImageFile>>
  >;
  const handoff = createCodexRenderHandoff({
    projectName,
    roomName: room.name,
    outputFilename: room.outputFilename,
    attachments: packagedImages.map((image) => image.attachment),
    selections: room.selections.map((selection) => ({
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
    })),
  });
  return {
    handoff,
    markdown: buildCodexRenderHandoffMarkdown(handoff),
    packagedImages,
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
    enabled: project?.design_workflow_version === "room_design_v2",
  });
  const { data: roomImages = [] } = useQuery({
    queryKey: ["projectRoomImages", id],
    queryFn: async () => (await db.listProjectRoomImages(id)) ?? [],
    enabled: project?.design_workflow_version === "room_design_v2",
  });
  const { data: materialItems = [] } = useQuery({
    queryKey: ["materialItems", id],
    queryFn: async () => (await db.listMaterialItemsByProject(id)) ?? [],
    enabled: project?.design_workflow_version === "room_design_v2",
  });
  const { data: featureFlag } = useQuery({
    queryKey: ["studioFeatureFlag", "room_design_v2"],
    queryFn: () => db.getStudioFeatureFlag("room_design_v2"),
  });
  const { data: designBoard } = useQuery({
    queryKey: ["designBoard", id],
    queryFn: () => db.getDesignBoard(id),
    enabled: project?.design_workflow_version === "room_design_v2",
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

  if (!canManageStudio(profile as UserProfile | null)) {
    return (
      <AppShell>
        <div className="page-pad">
          <div className="eyebrow">Room Design Pilot</div>
          <h1 className="mt-3 font-display text-5xl">Admin access required</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            The pilot is limited to Studio administrators during production testing.
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
  const [rooms, setRooms] = useState(initialRooms);
  const [roomId, setRoomId] = useState(initialRoom.id);
  const [method, setMethod] = useState<StartMethod>(initialDraft.method);
  const [step, setStep] = useState(() => {
    if (search.stage === "render") return 3;
    const savedStage = workflowByRoom.get(initialRoom.id)?.state?.stage;
    return typeof savedStage === "number" ? Math.min(5, Math.max(0, savedStage)) : 0;
  });
  const [links, setLinks] = useState(initialDraft.links);
  const [linksRoomName, setLinksRoomName] = useState(initialDraft.linksRoomName);
  const [selections, setSelections] = useState<DemoSelection[]>(initialDraft.selections);
  const [conceptPreview, setConceptPreview] = useState(initialDraft.conceptPreview);
  const [roomPreview, setRoomPreview] = useState(initialDraft.roomPreview);
  const [planPreview, setPlanPreview] = useState(initialDraft.planPreview);
  const [sketchupPreview, setSketchupPreview] = useState(initialDraft.sketchupPreview);
  const [sourcing, setSourcing] = useState(false);
  const [conceptSourceMessage, setConceptSourceMessage] = useState("");
  const [gathering, setGathering] = useState(false);
  const [gatherProgress, setGatherProgress] = useState(EMPTY_GATHER_PROGRESS);
  const [linkScrapeStates, setLinkScrapeStates] = useState<Record<string, LinkScrapeState>>({});
  const [boardReady, setBoardReady] = useState(initialDraft.boardReady);
  const [renderReady, setRenderReady] = useState(initialDraft.renderReady);
  const [completedRenderPreview, setCompletedRenderPreview] = useState(
    initialDraft.completedRenderPreview,
  );
  const [materialsSent, setMaterialsSent] = useState(initialDraft.materialsSent);
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
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualBoardHydratedRef = useRef(false);

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
      await db.upsertRoomDesignWorkflow(
        projectId,
        targetRoomId,
        serializeRoomWorkflowDraft(draft, stage),
        profile.id,
      );
      setSaveStatus("saved");
      queryClient.invalidateQueries({ queryKey: ["roomDesignWorkflows", projectId] });
    } catch (error) {
      console.error("Could not save Room Design workflow", error);
      setSaveStatus("error");
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
        id: `manual-material:${item.id}`,
        category: item.item_label,
        productName: item.client_product_name || item.product?.name || item.item_label,
        vendor: item.product?.vendor || "",
        finish: item.product?.finish || item.color || "",
        source: "Manual board",
        state: item.product_url || item.product_id ? "selected" : "draft",
        swatch: swatchForGroup(classifyBoardGroup(item.item_label)),
        url: item.product_url || item.product?.product_url || undefined,
        imageUrl: item.image_url || item.product?.image_url || undefined,
        group: classifyBoardGroup(item.item_label),
        quantity: item.quantity || 1,
        quantityUnit: defaultQuantityUnit(item.item_label),
        notes: item.notes || undefined,
        price: item.product?.price || undefined,
        sku: item.product?.sku || undefined,
        dimensions: item.product?.dimensions || undefined,
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
    (room) => !/^(materials throughout|appliance package)$/i.test(room.name.trim()),
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
          is_approved: true,
          review_status: "approved",
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
          is_approved: true,
          review_status: "approved",
          revision_number: 1,
        }));
      renderingId = rendering?.id ?? renderingId;
    }

    await db.updateRoom(roomId, {
      presentation_sketchup_image_id: sketchupId,
      presentation_rendering_image_id: renderingId,
    });
    await db.appendRoomDesignEvent(
      projectId,
      roomId,
      "presentation_images_saved",
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
      incoming.forEach((selection) => next.set(selection.id, selection));
      return Array.from(next.values());
    });
  };

  const chooseMethod = (next: StartMethod) => {
    setMethod(next);
    setConceptSourceMessage("");
    setStep(0);
    setMaterialsSent(false);
  };

  const gatherLinks = async (failedOnly = false) => {
    const linkedItems = links.filter(
      (link) =>
        (link.url.trim() || link.productId) &&
        (!failedOnly || linkScrapeStates[link.id]?.status === "failed"),
    );
    if (!linkedItems.length) return;

    setGathering(true);
    setGatherProgress({ ...EMPTY_GATHER_PROGRESS, total: linkedItems.length });
    setLinkScrapeStates((current) => ({
      ...(failedOnly ? current : {}),
      ...Object.fromEntries(linkedItems.map((link) => [link.id, { status: "waiting" as const }])),
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
    const linksNeedingScrape = linkedItems.filter(
      (link) => link.url.trim() && !catalogByLinkId.has(link.id),
    );
    let batchResults: Awaited<ReturnType<typeof scrapeProductUrlsBatch>> = [];
    let batchError = "";
    if (linksNeedingScrape.length) {
      try {
        const requestOptions = await pilotRequestOptions();
        batchResults = await scrapeProductUrlsBatch(
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
      const fallbackVendor = inferVendorFromUrl(link.url) || "Linked vendor";
      setLinkScrapeStates((current) => ({
        ...current,
        [link.id]: { status: "scraping" },
      }));

      const batchResult = batchByUrl.get(link.url.trim());
      const catalogProduct = catalogByLinkId.get(link.id);
      let scraped: ScrapedProductData = catalogProduct
        ? {
            name: catalogProduct.name,
            vendor: catalogProduct.vendor || undefined,
            sku: catalogProduct.sku || undefined,
            finish: catalogProduct.finish || undefined,
            dimensions: catalogProduct.dimensions || undefined,
            price: catalogProduct.price || undefined,
            image_url: catalogProduct.image_url || undefined,
          }
        : (batchResult?.product ?? {});
      let scrapeStatus: "complete" | "partial" | "failed" = "failed";
      let scrapeError = batchResult?.error || batchError;
      if (!catalogProduct && !batchResult?.product) {
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
      if (Object.keys(scraped).length) scrapeStatus = scrapedProductStatus(scraped);
      const reviewMessage =
        Object.keys(scraped).length && !link.productId
          ? productScrapeReviewMessage(link.url, link.category, scraped)
          : "";
      if (reviewMessage) {
        scrapeStatus = "partial";
        scrapeError = reviewMessage;
      }

      setLinkScrapeStates((current) => ({
        ...current,
        [link.id]: {
          status: scrapeStatus,
          message:
            scrapeStatus === "partial"
              ? "Some details need review"
              : scrapeStatus === "failed"
                ? scrapeError
                : undefined,
        },
      }));
      setGatherProgress((current) => ({
        ...current,
        completed: Math.max(current.completed, index + 1),
        successful: current.successful + (scrapeStatus === "complete" ? 1 : 0),
        partial: current.partial + (scrapeStatus === "partial" ? 1 : 0),
        failed: current.failed + (scrapeStatus === "failed" ? 1 : 0),
      }));

      let productId = catalogProduct?.id ?? null;
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
          price: scraped.price || null,
          notes: `Created by the Room Design V2 pilot for ${project.name}.`,
        });
        productId = created?.id ?? null;
      }

      gathered.push({
        id: `link-${link.id}`,
        category: link.category,
        productName: scraped.name || `${link.category} selection`,
        vendor: scraped.vendor || fallbackVendor,
        finish: scraped.finish || "Finish needs review",
        source: link.productId ? ("Product catalog" as const) : ("Product link" as const),
        state: "selected" as const,
        swatch: swatchForGroup(link.group),
        url: link.url || catalogProduct?.product_url || undefined,
        group: link.group,
        quantity: link.quantity,
        quantityUnit: defaultQuantityUnit(link.category),
        wastePercent: defaultWastePercent(link.category),
        notes: link.notes,
        savedToTemplate: link.saveToTemplate,
        imageUrl: scraped.image_url,
        price: scraped.price,
        sku: scraped.sku,
        dimensions: scraped.dimensions,
        scrapeStatus,
        scrapeError: scrapeError || undefined,
        productId,
      });
    }

    addSelections(gathered);
    setGathering(false);
    setStep(1);
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
      finish: scraped.finish || current.finish,
      url,
      imageUrl: scraped.image_url || current.imageUrl,
      price: scraped.price || current.price,
      sku: scraped.sku || current.sku,
      dimensions: scraped.dimensions || current.dimensions,
      scrapeStatus: reviewMessage ? "partial" : scrapeStatus,
      scrapeError: reviewMessage || undefined,
      materialsSyncStatus: materialsSent ? "changed" : current.materialsSyncStatus,
      productId,
    };
    setSelections((items) => items.map((selection) => (selection.id === id ? updated : selection)));
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
      materialsSyncStatus: materialsSent ? ("changed" as const) : current.materialsSyncStatus,
    };
    setSelections((items) => items.map((selection) => (selection.id === id ? updated : selection)));
    return updated;
  };

  const updateSelection = (id: string, patch: Partial<DemoSelection>) => {
    const materialFieldsChanged = Object.keys(patch).some((key) =>
      ["quantity", "quantityUnit", "wastePercent", "notes", "finish"].includes(key),
    );
    setSelections((items) =>
      items.map((selection) =>
        selection.id === id
          ? {
              ...selection,
              ...patch,
              ...(materialsSent && materialFieldsChanged
                ? { materialsSyncStatus: "changed" as const }
                : {}),
            }
          : selection,
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

  const composeBoard = () => {
    setBoardReady(true);
    setStep(2);
  };

  const prepareRender = () => {
    setRenderReady(true);
    setStep(3);
  };

  const approveAll = () => {
    setSelections((current) =>
      current.map((selection) => ({
        ...selection,
        state: selection.state === "draft" ? "draft" : ("locked" as const),
      })),
    );
    setStep(4);
  };

  const sendToMaterials = () => {
    setStep(5);
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
            <div className="eyebrow mb-3">{project.name} · Room Design V2 Pilot</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">Room Design</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
              Begin manually, from product links, or from a concept. Every path builds one room
              selection set for the board, render, approval, Materials, Specs, and Procurement.
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

        <WorkflowRail step={step} onStep={setStep} />

        <div>
          <div className="min-w-0 border border-border bg-background">
            {step === 0 && (
              <StartStep
                method={method}
                onMethod={chooseMethod}
                links={links}
                onLinks={setLinks}
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
                onToggle={(id) =>
                  setSelections((current) =>
                    current.map((selection) =>
                      selection.id === id
                        ? {
                            ...selection,
                            state: selection.state === "locked" ? "selected" : "locked",
                          }
                        : selection,
                    ),
                  )
                }
                onBack={() => setStep(0)}
                onContinue={composeBoard}
              />
            )}
            {step === 2 && (
              <BoardStep
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
                onPopulateBoard={populateStudioDesignBoard}
                onRemoveBackground={removeSelectionBackground}
                initialStudioPageCount={roomDesignGeneratedPageCount(designBoardState, roomId)}
                materialsSent={materialsSent}
                onBack={() => setStep(1)}
                onContinue={prepareRender}
              />
            )}
            {step === 3 && (
              <RenderStep
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
                onContinue={approveAll}
              />
            )}
            {step === 4 && (
              <ApprovalStep
                selections={selections}
                onBack={() => setStep(3)}
                onContinue={sendToMaterials}
              />
            )}
            {step === 5 && (
              <MaterialsStep
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

function WorkflowRail({ step, onStep }: { step: number; onStep: (step: number) => void }) {
  return (
    <div className="mobile-card-scroll mb-5 border-y border-border bg-background">
      <div className="flex min-w-[900px] items-center px-4 py-3">
        {STEPS.map((label, index) => (
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
                {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-xs",
                  index === step ? "font-medium text-ink" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </button>
            {index < STEPS.length - 1 && <div className="mx-3 h-px flex-1 bg-border" />}
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
  method: StartMethod;
  onMethod: (method: StartMethod) => void;
  links: DemoLink[];
  onLinks: (links: DemoLink[]) => void;
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
  const [newSelectionQuantity, setNewSelectionQuantity] = useState(1);
  const [newSelectionNotes, setNewSelectionNotes] = useState("");

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
        quantity: Math.max(1, newSelectionQuantity),
        notes: newSelectionNotes.trim(),
        custom: true,
        saveToTemplate: false,
      },
    ]);
    setNewSelectionName("");
    setNewSelectionGroup("Architecture / Other");
    setNewSelectionQuantity(1);
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
              <div className="eyebrow">{props.roomName} checklist</div>
              <h3 className="mt-2 font-display text-3xl">
                Paste a product link or choose from the catalog
              </h3>
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
                  <Input
                    type="number"
                    min={1}
                    value={newSelectionQuantity}
                    onChange={(event) => setNewSelectionQuantity(Number(event.target.value) || 1)}
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
          <div className="mt-5 divide-y divide-border border-y border-border">
            {props.links.map((item) => (
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
                <Input
                  aria-label={`${item.category} quantity`}
                  type="number"
                  min={1}
                  value={item.quantity}
                  disabled={props.gathering}
                  onChange={(event) =>
                    props.onLinks(
                      props.links.map((link) =>
                        link.id === item.id
                          ? { ...link, quantity: Number(event.target.value) || 1 }
                          : link,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`${item.category} product link`}
                  value={item.url}
                  disabled={props.gathering}
                  onChange={(event) =>
                    props.onLinks(
                      props.links.map((link) =>
                        link.id === item.id
                          ? {
                              ...link,
                              url: event.target.value,
                              productId: undefined,
                              catalogProductName: undefined,
                            }
                          : link,
                      ),
                    )
                  }
                  placeholder="Paste product link"
                />
                <CatalogPickerButton
                  item={item}
                  disabled={props.gathering}
                  onSelect={(product) =>
                    props.onLinks(
                      props.links.map((link) =>
                        link.id === item.id
                          ? {
                              ...link,
                              productId: product.id,
                              catalogProductName: product.name,
                              url: product.product_url || "",
                            }
                          : link,
                      ),
                    )
                  }
                />
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
              </div>
            ))}
          </div>
          <div className="mt-6 border border-border bg-bone/25 p-4">
            <div className="eyebrow">Room inputs for rendering</div>
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
                props.gathering || !props.links.some((item) => item.url.trim() || item.productId)
              }
            >
              {props.gathering ? <RefreshCw className="animate-spin" /> : <Sparkles />}
              {props.gathering
                ? "Gathering product details..."
                : "Gather products into selection set"}
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
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <p className="max-w-xl text-xs leading-5 text-muted-foreground">
              Studio matches real saved catalog products to this room's categories. Review each
              product's style and finish against the concept before locking it. The concept image is
              also included in the rendering handoff.
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
  onToggle,
  onBack,
  onContinue,
}: {
  selections: DemoSelection[];
  gathering: boolean;
  onRetryFailed: () => void;
  onUpdate: (id: string, patch: Partial<DemoSelection>) => void;
  onToggle: (id: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const failedCount = selections.filter((selection) => selection.scrapeStatus === "failed").length;
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
        <div className="divide-y divide-border border-y border-border">
          {selections.map((selection) => (
            <SelectionRow
              key={selection.id}
              selection={selection}
              action={
                <div className="flex flex-wrap items-end justify-end gap-2">
                  <QuantityEditor selection={selection} onUpdate={onUpdate} compact />
                  <Button
                    size="sm"
                    variant={selection.state === "locked" ? "default" : "outline"}
                    onClick={() => onToggle(selection.id)}
                  >
                    {selection.state === "locked" ? <Lock /> : <Check />}{" "}
                    {selection.state === "locked" ? "Locked" : "Select"}
                  </Button>
                </div>
              }
            />
          ))}
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
  onPopulateBoard,
  onRemoveBackground,
  initialStudioPageCount,
  materialsSent,
  onBack,
  onContinue,
}: {
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
      let boardImageUrl = cutouts[selection.id] || selection.imageUrl;
      if (boardImageUrl && !cutouts[selection.id] && !isStudioMaterialSwatch(selection.category)) {
        setPopulateState({
          status: "saving",
          message: `Removing the background from ${selection.category}…`,
        });
        try {
          boardImageUrl = await onRemoveBackground(boardImageUrl);
          setCutouts((current) => ({ ...current, [selection.id]: boardImageUrl! }));
        } catch {
          // Keep the original image when a vendor blocks image access or the free model fails.
        }
      }
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
      return;
    }
    setPopulateState({ status: "saving", message: "Adding this room to the Studio board…" });
    try {
      await onPopulateBoard(boardPagination.studio.pageCount, boardSelections);
      setPopulateState({
        status: "saved",
        message: "This room is current on the shared Studio design board.",
      });
    } catch (error) {
      setPopulateState({
        status: "error",
        message: error instanceof Error ? error.message : "The Studio board could not be updated.",
      });
    }
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
          Use board for render <ArrowRight />
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
              {populateState.status === "saved"
                ? "Update Studio Design Board"
                : "Populate Studio Design Board"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/projects/$id/design-boards" params={{ id: projectId }}>
                Open Full Project Board <ExternalLink />
              </Link>
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
                    Qty {selection.quantity ?? 1} {selectionQuantityUnit(selection)}
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
          <Button variant="outline" asChild>
            <Link to="/projects/$id/design-boards" params={{ id: projectId }}>
              Open full manual editor <ExternalLink />
            </Link>
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
                  Qty {selection.quantity ?? 1} {selectionQuantityUnit(selection)}
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
  const [handoffStatus, setHandoffStatus] = useState<"idle" | "downloaded" | "copied" | "failed">(
    "idle",
  );
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

  const buildHandoff = () =>
    buildRoomHandoffPackage({
      projectName,
      room: {
        id: "active-room",
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

  const downloadHandoff = () => {
    const { handoff, markdown, packagedImages } = buildHandoff();
    const files: Record<string, Uint8Array> = {
      "README.md": strToU8(markdown),
      "render-manifest.json": strToU8(JSON.stringify(handoff, null, 2)),
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
  };

  const copyHandoff = async () => {
    try {
      await navigator.clipboard.writeText(buildHandoff().markdown);
      setHandoffStatus("copied");
    } catch {
      setHandoffStatus("failed");
    }
  };

  const downloadProjectHandoff = () => {
    const roomPackages = preparedProjectRooms.map((room) => ({
      room,
      package: buildRoomHandoffPackage({ projectName, room }),
    }));
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
    setStudioSaveMessage("Saving the approved room images to Studio…");
    try {
      await onSaveToStudio();
      setStudioSaveStatus("saved");
      setStudioSaveMessage(
        completedRenderPreview && sketchupPreview
          ? "Saved. The render and linked Design Model view are now on this room's presentation page."
          : completedRenderPreview
            ? "Saved. The render is now on this room's presentation page."
            : "Saved. The Design Model view is now on this room's presentation page.",
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
              <h3 className="mt-1 font-display text-2xl">Prepare the render handoff</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The package includes a ready-to-run assignment, product links, a structured
                manifest, and any uploaded room, plan, or concept images. Preparing it sends no paid
                API request.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={downloadHandoff} disabled={!selections.length}>
              <Archive /> Download AI Rendering Handoff
            </Button>
            <Button variant="outline" onClick={copyHandoff} disabled={!selections.length}>
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
              {handoffStatus === "downloaded"
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
                      ? "Save Design Model to Presentation"
                      : "Save to Studio Presentation"}
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
            disabled={!preparedProjectRooms.length}
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
  const draftCount = selections.filter((selection) => selection.state === "draft").length;
  return (
    <StepFrame
      eyebrow="Approval"
      title="Freeze the room selections before handoff"
      onBack={onBack}
      action={
        <Button onClick={onContinue} disabled={!selections.length}>
          <ArrowRight /> Continue to Studio outputs
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
                    "Will be locked"
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
            Approval freezes this version of the board, render, and product set. Later changes
            create a new version.
          </p>
          <div className="mt-5 text-xs font-medium">
            {draftCount
              ? `${draftCount} manual draft${draftCount === 1 ? "" : "s"} will remain flagged for review`
              : "All selected items are ready to approve"}
          </div>
        </div>
      </div>
    </StepFrame>
  );
}

function MaterialsStep({
  selections,
  sent,
  completedRenderPreview,
  projectName,
  roomName,
  projectId,
  onBack,
}: {
  selections: DemoSelection[];
  sent: boolean;
  completedRenderPreview: string;
  projectName: string;
  roomName: string;
  projectId: string;
  onBack: () => void;
}) {
  const draftCount = selections.filter((selection) => selection.state === "draft").length;
  const procurementReady = selections.filter(
    (selection) =>
      selection.state === "locked" && selection.url && selection.scrapeStatus !== "failed",
  );
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
          Open the shared design board and use its existing “Send Page to Materials” action. The
          current Materials, Spec Book, Procurement, and Presentation pages continue from there.
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
            completedRenderPreview
              ? "The imported room render is included with the approved selection summary."
              : "The approved design board is included; the render remains flagged as missing."
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
                    <td className="px-3 py-2">{selection.quantity || 1}</td>
                    <td className="px-3 py-2">{selectionQuantityUnit(selection)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {quantityUnitUsesWaste(selectionQuantityUnit(selection))
                        ? `${selection.wastePercent ?? defaultWastePercent(selection.category)}% / ${selectionOrderQuantity(selection)}`
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
        <Metric value={procurementReady.length} label="Order ready" />
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
  const quantity = selection.quantity ?? 1;
  const wastePercent = selection.wastePercent ?? defaultWastePercent(selection.category);
  const showWaste = quantityUnitUsesWaste(unit);
  const orderQuantity = showWaste
    ? Math.round(quantity * (1 + wastePercent / 100) * 100) / 100
    : quantity;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-[9px] font-medium uppercase tracking-[.12em] text-muted-foreground">
          Qty
          <input
            aria-label={`${selection.category} quantity`}
            type="number"
            min={1}
            step={unit === "each" || unit === "pair" || unit === "set" ? 1 : 0.1}
            value={quantity}
            onChange={(event) =>
              onUpdate(selection.id, {
                quantity: Math.max(1, Number(event.target.value) || 1),
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
          Order quantity with waste: {orderQuantity} {unit}
        </div>
      )}
    </div>
  );
}

function SelectionRow({ selection, action }: { selection: DemoSelection; action: ReactNode }) {
  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center">
      <SelectionVisual selection={selection} className="h-14 w-14 border border-border" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{selection.category}</span>
          <span className="border border-border bg-bone/30 px-2 py-0.5 text-[9px] uppercase tracking-[.1em] text-muted-foreground">
            {selection.source}
          </span>
          {selection.scrapeStatus && (
            <span
              title={selection.scrapeError}
              className={cn(
                "border px-2 py-0.5 text-[9px] uppercase tracking-[.1em]",
                selection.scrapeStatus === "complete" &&
                  "border-emerald-300 bg-emerald-50 text-emerald-800",
                selection.scrapeStatus === "partial" &&
                  "border-amber-300 bg-amber-50 text-amber-800",
                selection.scrapeStatus === "failed" && "border-red-300 bg-red-50 text-red-800",
              )}
            >
              {selection.scrapeStatus === "complete"
                ? "Scraped"
                : selection.scrapeStatus === "partial"
                  ? "Needs review"
                  : "Scrape failed"}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {selection.productName} · {selection.vendor} · {selection.finish}
          {selection.quantity
            ? ` · Qty ${selection.quantity} ${selection.quantityUnit ?? defaultQuantityUnit(selection.category)}`
            : ""}
          {quantityUnitUsesWaste(selection.quantityUnit ?? defaultQuantityUnit(selection.category))
            ? ` · ${selection.wastePercent ?? defaultWastePercent(selection.category)}% waste`
            : ""}
          {selection.savedToTemplate ? " · Saved to room template" : ""}
        </div>
        {(selection.price || selection.sku || selection.dimensions) && (
          <div className="mt-1 text-xs text-muted-foreground">
            {[selection.price, selection.sku ? `SKU ${selection.sku}` : "", selection.dimensions]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
        {selection.scrapeError && (
          <div
            className={cn(
              "mt-1 text-xs",
              selection.scrapeStatus === "partial" ? "text-amber-800" : "text-red-700",
            )}
          >
            {selection.scrapeError}
          </div>
        )}
      </div>
      <div>{action}</div>
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
