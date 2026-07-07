import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Printer,
  Maximize2,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Download,
  Type,
  Plus,
  Trash2,
  GripVertical,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, type MaterialItem, type RoomImage } from "@/lib/db";
import { clientProductName } from "@/lib/clientProductName";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { materialImageUrl } from "@/lib/materialImages";
import { canViewProjectSurface } from "@/lib/permissions";
import type { CSSProperties } from "react";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/presentations/$id")({
  head: () => ({ meta: [{ title: "Presentation — MERAV Studio" }] }),
  component: PresentationPage,
});

type RoomData = {
  views: { hero?: RoomImage; sketch?: RoomImage; label?: string; visible: boolean }[];
  renderingOptions: RoomImage[];
  sketchupOptions: RoomImage[];
  materials: MaterialItem[];
  paletteMaterials: MaterialItem[];
  cabinetProduct: any;
  cabinetMaterial: MaterialItem | null;
  counter: MaterialItem | null;
  faucet: MaterialItem | any;
};

type PresentationBoardElement = {
  id: string;
  type: "image" | "text" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex: number;
  src?: string;
  backgroundRemovedUrl?: string | null;
  text?: string;
  background?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  letterSpacing?: number;
  visible?: boolean;
};

type PresentationBoardPage = {
  id: string;
  title: string;
  roomId: string | null;
  presentationVisible: boolean;
  elements: PresentationBoardElement[];
};

type PresentationExtraPageSlot = {
  id: string;
  afterSlideKey: string;
  boardPageId: string | null;
};

type PresentationSidebarSection = "palette" | "cabinet" | "counter" | "faucet";

type PresentationBaseSlide =
  | { kind: "cover"; slideKey: string }
  | {
      kind: "view";
      slideKey: string;
      room: any;
      data: RoomData;
      view: RoomData["views"][number];
      viewIndex: number;
      viewCount: number;
      anchor?: string;
    };

type PresentationSlide =
  | PresentationBaseSlide
  | {
      kind: "board-page";
      slideKey: string;
      slotId?: string;
      page: PresentationBoardPage;
      pageIndex: number;
      pageCount: number;
    };

type PresentationSlideDraft =
  | PresentationBaseSlide
  | {
      kind: "board-page";
      slideKey: string;
      slotId?: string;
      page: PresentationBoardPage;
    };

const DESIGN_BOARD_PRESENTATION_WIDTH = 1400;
const DESIGN_BOARD_PRESENTATION_HEIGHT = 900;

const DEFAULT_OVERLAY_LABEL = "Photoreal Visualization";
const DEFAULT_OVERLAY_BODY =
  "A true-to-life preview of your space, designed to give you confidence in every material, finish, and detail.";
const DEFAULT_PRESENTATION_SECTION_LABELS = {
  palette: "Material Palette",
  cabinet: "Cabinetry",
  counter: "Countertop",
  faucet: "Faucet",
} as const;

function hasMeaningfulMaterialInput(material: MaterialItem) {
  const product = material.product;
  const hasProductDetails = [
    material.image_url,
    product?.image_url,
    product?.name,
    product?.vendor,
    product?.sku,
    product?.finish,
    product?.dimensions,
  ].some((value) => typeof value === "string" && value.trim().length > 0);
  const hasProductPrice =
    typeof product?.price === "number" ||
    typeof product?.unit_cost === "number" ||
    typeof product?.shipping === "number";
  const hasMaterialDetails = [material.product_url, material.color, material.notes].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );

  return material.not_needed !== true && Boolean(material.product_id || hasProductDetails || hasProductPrice || hasMaterialDetails);
}

function buildRoomData(
  room: any,
  images: any[],
  selections: any[],
  materials: MaterialItem[],
): RoomData {
  const approvedRenders = images
    .filter(
      (i) =>
        i.kind === "rendering" &&
        i.status === "complete" &&
        (i.is_approved === true || i.review_status === "approved"),
    )
    .sort(compareRenderingPageOrder);
  const sketchups = images.filter((i) => i.kind === "sketchup");
  const fallbackSketch = room.presentation_sketchup_image_id
    ? sketchups.find((image) => image.id === room.presentation_sketchup_image_id) || sketchups[0]
    : sketchups[0];

  const views: RoomData["views"] = [];
  const renderedIds = new Set<string>();
  for (const s of sketchups) {
    const linked = approvedRenders.filter((rendering) => rendering.linked_sketchup_id === s.id);
    for (const r of linked) {
      renderedIds.add(r.id);
      views.push({ hero: r, sketch: s, label: r.caption, visible: true });
    }
  }
  for (const r of approvedRenders) {
    if (!renderedIds.has(r.id)) {
      views.push({ hero: r, sketch: fallbackSketch, label: r.caption, visible: true });
    }
  }
  // Sketchups not linked to any rendering — show on their own page
  for (const s of sketchups) {
    if (!approvedRenders.some((r) => r.linked_sketchup_id === s.id) && !views.some((v) => v.sketch?.id === s.id && !v.hero)) {
      // only add as standalone if there are no renderings (so we don't duplicate the fallback)
      if (approvedRenders.length === 0)
        views.push({ sketch: s, visible: s.presentation_visible !== false });
    }
  }
  if (views.length === 0)
    views.push({ sketch: fallbackSketch, visible: fallbackSketch?.presentation_visible !== false });
  const orderedApprovedRenders = views
    .map((view) => view.hero)
    .filter((rendering): rendering is RoomImage => Boolean(rendering));

  const key = selections.filter((s) => s.is_key_selection);
  const pickProduct = (cat: string) =>
    key.find((s) => s.product?.category === cat) ||
    selections.find((s) => s.product?.category === cat);
  const presentationMaterials = materials.filter(hasMeaningfulMaterialInput);
  const pickMaterialItem = (...labels: string[]) => {
    const wanted = labels.map((label) => label.toLowerCase());
    return (
      presentationMaterials.find((m) => wanted.includes(m.item_label.toLowerCase())) ||
      presentationMaterials.find((m) => wanted.some((label) => m.category?.toLowerCase().includes(label)))
    );
  };
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const pickById = (id?: string | null) => (id ? (materialById.get(id) ?? null) : null);
  const paletteMaterials = room.presentation_palette_item_ids?.length
    ? (room.presentation_palette_item_ids
        .map((id: string) => materialById.get(id))
        .filter((material): material is MaterialItem => Boolean(material && hasMeaningfulMaterialInput(material)))
        .filter(Boolean)
        .slice(0, 4) as MaterialItem[])
    : presentationMaterials.slice(0, 4);

  return {
    views,
    renderingOptions: orderedApprovedRenders,
    sketchupOptions: sketchups,
    materials: presentationMaterials,
    paletteMaterials,
    cabinetProduct: pickProduct("Hardware"),
    cabinetMaterial:
      pickById(room.presentation_cabinet_item_id) ||
      pickMaterialItem("Cabinet Finish", "Cabinet Hardware", "Cabinetry") ||
      null,
    counter:
      pickById(room.presentation_counter_item_id) ||
      pickMaterialItem("Countertop", "Countertops") ||
      null,
    faucet:
      pickById(room.presentation_faucet_item_id) ||
      pickMaterialItem("Faucet") ||
      pickProduct("Plumbing"),
  };
}

function compareRenderingPageOrder(a: RoomImage, b: RoomImage) {
  const versionDiff = (b.revision_number || 1) - (a.revision_number || 1);
  if (versionDiff !== 0) return versionDiff;
  return b.id.localeCompare(a.id);
}

function normalizePresentationBoardElement(value: unknown): PresentationBoardElement | null {
  if (!value || typeof value !== "object") return null;
  const element = value as Partial<PresentationBoardElement>;
  if (element.type !== "image" && element.type !== "text" && element.type !== "shape") return null;
  return {
    ...element,
    id: typeof element.id === "string" && element.id ? element.id : crypto.randomUUID(),
    type: element.type,
    x: typeof element.x === "number" ? element.x : 0,
    y: typeof element.y === "number" ? element.y : 0,
    width: typeof element.width === "number" ? element.width : 240,
    height: typeof element.height === "number" ? element.height : 180,
    zIndex: typeof element.zIndex === "number" ? element.zIndex : 0,
    rotation: typeof element.rotation === "number" ? element.rotation : 0,
    visible: element.visible === false ? false : true,
  };
}

function normalizePresentationBoardPages(boardState: unknown): PresentationBoardPage[] {
  if (!boardState || typeof boardState !== "object") return [];
  const candidate = boardState as { pages?: unknown[] };
  if (!Array.isArray(candidate.pages)) return [];
  return candidate.pages
    .map((page, pageIndex) => {
      if (!page || typeof page !== "object") return null;
      const current = page as Partial<PresentationBoardPage>;
      const elements = Array.isArray(current.elements)
        ? current.elements
            .map(normalizePresentationBoardElement)
            .filter((element): element is PresentationBoardElement => Boolean(element))
        : [];
      return {
        id: typeof current.id === "string" && current.id ? current.id : crypto.randomUUID(),
        title:
          typeof current.title === "string" && current.title.trim()
            ? current.title
            : `Board ${pageIndex + 1}`,
        roomId: typeof current.roomId === "string" && current.roomId ? current.roomId : null,
        presentationVisible: current.presentationVisible === true,
        elements,
      } satisfies PresentationBoardPage;
    })
    .filter((page): page is PresentationBoardPage => Boolean(page));
}

function normalizePresentationExtraPageSlots(boardState: unknown): PresentationExtraPageSlot[] {
  if (!boardState || typeof boardState !== "object") return [];
  const candidate = boardState as { presentationExtraPages?: unknown[] };
  if (!Array.isArray(candidate.presentationExtraPages)) return [];
  return candidate.presentationExtraPages
    .map((slot) => {
      if (!slot || typeof slot !== "object") return null;
      const current = slot as Partial<PresentationExtraPageSlot>;
      const afterSlideKey =
        typeof current.afterSlideKey === "string" && current.afterSlideKey.trim()
          ? current.afterSlideKey.trim()
          : null;
      if (!afterSlideKey) return null;
      return {
        id: typeof current.id === "string" && current.id ? current.id : crypto.randomUUID(),
        afterSlideKey,
        boardPageId:
          typeof current.boardPageId === "string" && current.boardPageId ? current.boardPageId : null,
      } satisfies PresentationExtraPageSlot;
    })
    .filter((slot): slot is PresentationExtraPageSlot => Boolean(slot));
}

function normalizePresentationSlideOrder(boardState: unknown) {
  if (!boardState || typeof boardState !== "object") return [];
  const candidate = boardState as { presentationSlideOrder?: unknown[] };
  if (!Array.isArray(candidate.presentationSlideOrder)) return [];
  const seen = new Set<string>();
  return candidate.presentationSlideOrder.filter((value): value is string => {
    if (typeof value !== "string" || !value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function normalizePresentationHiddenSlideKeys(boardState: unknown) {
  if (!boardState || typeof boardState !== "object") return [];
  const candidate = boardState as { presentationHiddenSlideKeys?: unknown[] };
  if (!Array.isArray(candidate.presentationHiddenSlideKeys)) return [];
  const seen = new Set<string>();
  return candidate.presentationHiddenSlideKeys.filter((value): value is string => {
    if (typeof value !== "string" || !value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function normalizePresentationRenderingOverrides(boardState: unknown) {
  if (!boardState || typeof boardState !== "object") return {};
  const candidate = boardState as { presentationRenderingOverrides?: unknown };
  if (!candidate.presentationRenderingOverrides || typeof candidate.presentationRenderingOverrides !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(candidate.presentationRenderingOverrides as Record<string, unknown>).filter(
      (entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1]),
    ),
  );
}

function isPresentationSidebarSection(value: unknown): value is PresentationSidebarSection {
  return value === "palette" || value === "cabinet" || value === "counter" || value === "faucet";
}

function normalizePresentationHiddenSections(boardState: unknown) {
  if (!boardState || typeof boardState !== "object") return {};
  const candidate = boardState as { presentationHiddenSections?: unknown };
  if (!candidate.presentationHiddenSections || typeof candidate.presentationHiddenSections !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(candidate.presentationHiddenSections as Record<string, unknown>)
      .map(([slideKey, value]) => [
        slideKey,
        Array.isArray(value) ? value.filter(isPresentationSidebarSection) : [],
      ])
      .filter(([slideKey, sections]) => Boolean(slideKey) && sections.length > 0),
  ) as Record<string, PresentationSidebarSection[]>;
}

function applyPresentationRenderingOverrides(
  slides: PresentationSlideDraft[],
  overrides: Record<string, string>,
) {
  if (!Object.keys(overrides).length) return slides;
  return slides.map((slide) => {
    if (slide.kind !== "view") return slide;
    const overrideId = overrides[slide.slideKey];
    if (!overrideId || overrideId === slide.view.hero?.id) return slide;
    const overrideHero = slide.data.renderingOptions.find((rendering) => rendering.id === overrideId);
    if (!overrideHero) return slide;
    const overrideSketch =
      slide.data.sketchupOptions.find((sketchup) => sketchup.id === overrideHero.linked_sketchup_id) ||
      slide.view.sketch;
    return {
      ...slide,
      view: {
        ...slide.view,
        hero: overrideHero,
        sketch: overrideSketch,
        label: overrideHero.caption,
      },
    };
  });
}

function applyPresentationSlideOrder(slides: PresentationSlideDraft[], order: string[]) {
  if (!order.length) return slides;
  const slideByKey = new Map(slides.map((slide) => [slide.slideKey, slide]));
  const ordered = order
    .map((slideKey) => slideByKey.get(slideKey))
    .filter((slide): slide is PresentationSlideDraft => Boolean(slide));
  const orderedKeys = new Set(ordered.map((slide) => slide.slideKey));
  return [...ordered, ...slides.filter((slide) => !orderedKeys.has(slide.slideKey))];
}

function numberPresentationSlides(slides: PresentationSlideDraft[]) {
  const boardSlideCount = slides.filter((item) => item.kind === "board-page").length;
  let boardSlideIndex = 0;
  return slides.map((item) =>
    item.kind === "board-page"
      ? {
          ...item,
          pageIndex: boardSlideIndex++,
          pageCount: boardSlideCount,
        }
      : item,
  ) as PresentationSlide[];
}

function buildViewSlideKey(roomId: string, view: RoomData["views"][number], viewIndex: number) {
  const imageId = view.hero?.id ?? view.sketch?.id ?? `view-${viewIndex + 1}`;
  return `room:${roomId}:view:${imageId}`;
}

type PresentationImageLayout =
  | "ai-with-sketchup"
  | "sketchup-with-ai"
  | "ai-only"
  | "sketchup-only";

function presentationImageLayout(view: RoomData["views"][number]): PresentationImageLayout {
  if (!view.hero || !view.sketch) return "ai-with-sketchup";
  if (view.hero.role === "sketchup_single_hero") return "sketchup-only";
  if (view.hero.role === "single_hero") return "ai-only";
  if (view.hero.role === "sketchup_hero") return "sketchup-with-ai";
  return "ai-with-sketchup";
}

function roleForPresentationImageLayout(layout: PresentationImageLayout) {
  if (layout === "sketchup-with-ai") return "sketchup_hero";
  if (layout === "ai-only") return "single_hero";
  if (layout === "sketchup-only") return "sketchup_single_hero";
  return null;
}

function viewUsesSketchupAsHero(view: RoomData["views"][number]) {
  const layout = presentationImageLayout(view);
  return layout === "sketchup-with-ai" || layout === "sketchup-only";
}

function viewHidesComparisonImage(view: RoomData["views"][number]) {
  const layout = presentationImageLayout(view);
  return layout === "ai-only" || layout === "sketchup-only";
}

function primaryPresentationImage(view: RoomData["views"][number]) {
  if (viewUsesSketchupAsHero(view)) return view.sketch;
  return view.hero ?? view.sketch;
}

function comparisonPresentationImage(view: RoomData["views"][number]) {
  if (!view.hero || !view.sketch) return null;
  if (viewHidesComparisonImage(view)) return null;
  return viewUsesSketchupAsHero(view)
    ? {
        image: view.hero,
        label: "AI Rendering",
        emptyLabel: "No AI rendering yet",
      }
    : {
        image: view.sketch,
        label: "Design Model",
        emptyLabel: "No SketchUp yet",
      };
}

function boardElementIsMeaningful(element: PresentationBoardElement) {
  if (element.visible === false) return false;
  if (element.type === "image") return Boolean(element.backgroundRemovedUrl || element.src);
  if (element.type === "text") return Boolean(element.text?.trim());
  if (element.type === "shape") return true;
  return false;
}

function boardPageHasRenderableContent(page: PresentationBoardPage) {
  return page.elements.some(boardElementIsMeaningful);
}

function presentationSlideLabel(slide: PresentationSlide) {
  if (slide.kind === "cover") return "Cover";
  if (slide.kind === "board-page") return `Extra Page · ${slide.page.title}`;
  const viewLabel = slide.viewCount > 1 ? ` · View ${slide.viewIndex + 1}` : "";
  return `${slide.room.name}${viewLabel}`;
}

function sanitizePresentationFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[^\w\s.-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "presentation"
  );
}

async function waitForPresentationImages(nodes: HTMLElement[]) {
  const images = nodes.flatMap((node) => Array.from(node.querySelectorAll("img")));
  await Promise.all(
    images.map(async (image) => {
      image.loading = "eager";
      if (image.complete && image.naturalWidth > 0) return;
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
        setTimeout(done, 8000);
      });
      try {
        await image.decode?.();
      } catch {}
    }),
  );
}

function PresentationPage() {
  const { id: projectId } = Route.useParams();
  const qc = useQueryClient();
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => db.getProject(projectId),
  });
  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms", projectId],
    queryFn: async () => (await db.listRooms(projectId)) ?? [],
  });
  const { data: materialItems = [] } = useQuery({
    queryKey: ["materialItems", projectId],
    queryFn: async () => (await db.listMaterialItemsByProject(projectId)) ?? [],
  });
  const { data: sharedBoard } = useQuery({
    queryKey: ["designBoard", projectId],
    queryFn: () => db.getDesignBoard(projectId),
  });

  // Fetch data for all rooms in parallel
  const roomQueries = useQueries({
    queries: rooms.flatMap((r) => [
      {
        queryKey: ["roomImages", r.id],
        queryFn: async () => (await db.listRoomImages(r.id)) ?? [],
      },
      {
        queryKey: ["roomProducts", r.id],
        queryFn: async () => (await db.listRoomProducts(r.id)) ?? [],
      },
    ]),
  });

  const roomData = useMemo(() => {
    return rooms.map((r, idx) => {
      const images = (roomQueries[idx * 2]?.data as any[]) || [];
      const selections = (roomQueries[idx * 2 + 1]?.data as any[]) || [];
      const materials = materialItems.filter((m) => m.room_id === r.id && !m.not_needed);
      return { room: r, data: buildRoomData(r, images, selections, materials) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, materialItems, roomQueries.map((q) => q.dataUpdatedAt).join(",")]);

  const designBoardPages = useMemo(
    () =>
      normalizePresentationBoardPages(sharedBoard?.board_state).filter(boardPageHasRenderableContent),
    [sharedBoard?.board_state, sharedBoard?.updated_at],
  );
  const presentationExtraPages = useMemo(
    () => normalizePresentationExtraPageSlots(sharedBoard?.board_state),
    [sharedBoard?.board_state, sharedBoard?.updated_at],
  );
  const presentationSlideOrder = useMemo(
    () => normalizePresentationSlideOrder(sharedBoard?.board_state),
    [sharedBoard?.board_state, sharedBoard?.updated_at],
  );
  const presentationHiddenSlideKeys = useMemo(
    () => normalizePresentationHiddenSlideKeys(sharedBoard?.board_state),
    [sharedBoard?.board_state, sharedBoard?.updated_at],
  );
  const presentationHiddenSlideKeySet = useMemo(
    () => new Set(presentationHiddenSlideKeys),
    [presentationHiddenSlideKeys],
  );
  const presentationRenderingOverrides = useMemo(
    () => normalizePresentationRenderingOverrides(sharedBoard?.board_state),
    [sharedBoard?.board_state, sharedBoard?.updated_at],
  );
  const presentationHiddenSections = useMemo(
    () => normalizePresentationHiddenSections(sharedBoard?.board_state),
    [sharedBoard?.board_state, sharedBoard?.updated_at],
  );
  const includedBoardPages = useMemo(
    () => designBoardPages.filter((page) => page.presentationVisible),
    [designBoardPages],
  );

  const updatePresentationPicks = async (
    roomId: string,
    patch: Record<string, string | string[] | null>,
  ) => {
    await db.updateRoom(roomId, patch as any);
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
  };

  const updateRenderingSketchLink = async (
    roomId: string,
    renderingId: string,
    linkedSketchupId: string | null,
  ) => {
    await db.updateRoomImage(renderingId, { linked_sketchup_id: linkedSketchupId });
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
  };

  const updateViewRendering = async (slideKey: string, renderingId: string) => {
    if (!renderingId) return;
    const latestBoard = await db.getDesignBoard(projectId);
    const baseState =
      latestBoard?.board_state && typeof latestBoard.board_state === "object"
        ? (latestBoard.board_state as Record<string, unknown>)
        : {};
    const currentOverrides = normalizePresentationRenderingOverrides(baseState);
    const nextState = {
      ...baseState,
      presentationRenderingOverrides: {
        ...currentOverrides,
        [slideKey]: renderingId,
      },
    };

    const saved = latestBoard?.updated_at
      ? await db.updateDesignBoardIfFresh(projectId, nextState, latestBoard.updated_at)
      : await db.upsertDesignBoard(projectId, nextState);

    if (!saved) {
      toast.error("Presentation image changed while saving. Please try again.");
      qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
      return;
    }
    qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
  };

  const updatePresentationHiddenSection = async (
    slideKey: string,
    section: PresentationSidebarSection,
    hidden: boolean,
  ) => {
    const latestBoard = await db.getDesignBoard(projectId);
    const baseState =
      latestBoard?.board_state && typeof latestBoard.board_state === "object"
        ? (latestBoard.board_state as Record<string, unknown>)
        : {};
    const currentHidden = normalizePresentationHiddenSections(baseState);
    const currentSections = new Set(currentHidden[slideKey] ?? []);
    if (hidden) currentSections.add(section);
    else currentSections.delete(section);
    const nextHidden = { ...currentHidden };
    const nextSections = Array.from(currentSections);
    if (nextSections.length) nextHidden[slideKey] = nextSections;
    else delete nextHidden[slideKey];
    const nextState = {
      ...baseState,
      presentationHiddenSections: nextHidden,
    };

    const saved = latestBoard?.updated_at
      ? await db.updateDesignBoardIfFresh(projectId, nextState, latestBoard.updated_at)
      : await db.upsertDesignBoard(projectId, nextState);

    if (!saved) {
      toast.error("Presentation section changed while saving. Please try again.");
      qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
      return;
    }
    qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
  };

  const updateViewVisibility = async (roomId: string, imageId: string, visible: boolean) => {
    await db.updateRoomImage(imageId, { presentation_visible: visible });
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
  };

  const updateViewImageLayout = async (
    roomId: string,
    renderingId: string,
    layout: PresentationImageLayout,
  ) => {
    await db.updateRoomImage(renderingId, { role: roleForPresentationImageLayout(layout) });
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
  };

  const updateSlideText = async (roomId: string, patch: Record<string, string | null>) => {
    await db.updateRoom(roomId, patch as any);
    qc.invalidateQueries({ queryKey: ["rooms", projectId] });
  };

  const updateCoverText = async (patch: Record<string, string | null>) => {
    await db.updateProject(projectId, patch as any);
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const updateBoardPageVisibility = async (pageId: string, visible: boolean) => {
    const latestBoard = await db.getDesignBoard(projectId);
    if (!latestBoard?.board_state) {
      toast.error("No design board found for this project yet.");
      return;
    }

    const currentPages = normalizePresentationBoardPages(latestBoard.board_state);
    const pageExists = currentPages.some((page) => page.id === pageId);
    if (!pageExists) {
      toast.error("That design board page could not be found.");
      return;
    }

    const baseState =
      latestBoard.board_state && typeof latestBoard.board_state === "object"
        ? (latestBoard.board_state as Record<string, unknown>)
        : {};
    const nextState = {
      ...baseState,
      pages: currentPages.map((page) =>
        page.id === pageId ? { ...page, presentationVisible: visible } : page,
      ),
    };

    const saved = latestBoard.updated_at
      ? await db.updateDesignBoardIfFresh(projectId, nextState, latestBoard.updated_at)
      : await db.upsertDesignBoard(projectId, nextState);

    if (!saved) {
      toast.error("That board changed while saving. Please try again.");
      qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
      return;
    }

    qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
    toast.success(visible ? "Added to presentation" : "Removed from presentation");
  };

  const savePresentationExtraPages = useCallback(
    async (
      updater: (context: {
        baseState: Record<string, unknown>;
        pages: PresentationBoardPage[];
        slots: PresentationExtraPageSlot[];
      }) => Record<string, unknown>,
      successMessage?: string,
    ) => {
      const latestBoard = await db.getDesignBoard(projectId);
      if (!latestBoard?.board_state) {
        toast.error("No design board found for this project yet.");
        return false;
      }

      const pages = normalizePresentationBoardPages(latestBoard.board_state);
      const slots = normalizePresentationExtraPageSlots(latestBoard.board_state);
      const baseState =
        latestBoard.board_state && typeof latestBoard.board_state === "object"
          ? (latestBoard.board_state as Record<string, unknown>)
          : {};
      const nextState = updater({ baseState, pages, slots });

      const saved = latestBoard.updated_at
        ? await db.updateDesignBoardIfFresh(projectId, nextState, latestBoard.updated_at)
        : await db.upsertDesignBoard(projectId, nextState);

      if (!saved) {
        toast.error("That board changed while saving. Please try again.");
        qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
        return false;
      }

      qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
      if (successMessage) toast.success(successMessage);
      return true;
    },
    [projectId, qc],
  );

  const addPresentationExtraPage = useCallback(
    async (afterSlideKey: string) => {
      if (!designBoardPages.length) {
        toast.error("Create a Design Board page first, then add it here.");
        return;
      }

      await savePresentationExtraPages(
        ({ baseState, pages, slots }) => ({
          ...baseState,
          pages,
          presentationExtraPages: [
            ...slots,
            {
              id: crypto.randomUUID(),
              afterSlideKey,
              boardPageId: pages[0]?.id ?? null,
            },
          ],
        }),
        "Extra page added",
      );
    },
    [designBoardPages.length, savePresentationExtraPages],
  );

  const updatePresentationExtraPage = useCallback(
    async (slotId: string, boardPageId: string) => {
      await savePresentationExtraPages(
        ({ baseState, pages, slots }) => ({
          ...baseState,
          pages: pages.map((page) =>
            page.id === boardPageId ? { ...page, presentationVisible: true } : page,
          ),
          presentationExtraPages: slots.map((slot) =>
            slot.id === slotId ? { ...slot, boardPageId } : slot,
          ),
        }),
        "Extra page updated",
      );
    },
    [savePresentationExtraPages],
  );

  const removePresentationExtraPage = useCallback(
    async (slotId: string) => {
      await savePresentationExtraPages(
        ({ baseState, pages, slots }) => {
          const removed = slots.find((slot) => slot.id === slotId);
          if (!removed) return { ...baseState, pages, presentationExtraPages: slots };
          return {
            ...baseState,
            pages,
            presentationExtraPages: slots
              .filter((slot) => slot.id !== slotId)
              .map((slot) =>
                slot.afterSlideKey === `slot:${slotId}`
                  ? { ...slot, afterSlideKey: removed.afterSlideKey }
                  : slot,
              ),
          };
        },
        "Extra page removed",
      );
    },
    [savePresentationExtraPages],
  );

  const savePresentationSlideOrder = useCallback(
    async (nextOrder: string[]) => {
      const latestBoard = await db.getDesignBoard(projectId);
      const baseState =
        latestBoard?.board_state && typeof latestBoard.board_state === "object"
          ? (latestBoard.board_state as Record<string, unknown>)
          : {};
      const nextState = {
        ...baseState,
        presentationSlideOrder: nextOrder,
      };

      const saved = latestBoard?.updated_at
        ? await db.updateDesignBoardIfFresh(projectId, nextState, latestBoard.updated_at)
        : await db.upsertDesignBoard(projectId, nextState);

      if (!saved) {
        toast.error("Presentation order changed while saving. Please try again.");
        qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
        return false;
      }

      qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
      toast.success("Presentation order updated");
      return true;
    },
    [projectId, qc],
  );

  const updatePresentationSlideHidden = useCallback(
    async (slideKey: string, hidden: boolean) => {
      if (slideKey === "cover") return false;
      const latestBoard = await db.getDesignBoard(projectId);
      const baseState =
        latestBoard?.board_state && typeof latestBoard.board_state === "object"
          ? (latestBoard.board_state as Record<string, unknown>)
          : {};
      const currentHidden = new Set(normalizePresentationHiddenSlideKeys(baseState));
      if (hidden) currentHidden.add(slideKey);
      else currentHidden.delete(slideKey);
      const nextState = {
        ...baseState,
        presentationHiddenSlideKeys: Array.from(currentHidden),
      };

      const saved = latestBoard?.updated_at
        ? await db.updateDesignBoardIfFresh(projectId, nextState, latestBoard.updated_at)
        : await db.upsertDesignBoard(projectId, nextState);

      if (!saved) {
        toast.error("Presentation pages changed while saving. Please try again.");
        qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
        return false;
      }

      qc.invalidateQueries({ queryKey: ["designBoard", projectId] });
      toast.success(hidden ? "Presentation page hidden" : "Presentation page shown");
      return true;
    },
    [projectId, qc],
  );

  const deletePresentationSlide = useCallback(
    async (item: PresentationSlide) => {
      if (item.kind === "cover") return;
      if (item.kind === "board-page") {
        if (item.slotId) {
          await removePresentationExtraPage(item.slotId);
          return;
        }
        await updateBoardPageVisibility(item.page.id, false);
        return;
      }
      await updatePresentationSlideHidden(item.slideKey, true);
    },
    [removePresentationExtraPage, updateBoardPageVisibility, updatePresentationSlideHidden],
  );

  const baseSlides = useMemo<PresentationBaseSlide[]>(() => {
    const list: PresentationBaseSlide[] = [{ kind: "cover", slideKey: "cover" }];
    roomData.forEach(({ room, data }) => {
      const visibleViews = data.views.filter((view) => view.visible);
      visibleViews.forEach((view, vi) => {
        list.push({
          kind: "view",
          slideKey: buildViewSlideKey(room.id, view, vi),
          room,
          data,
          view,
          viewIndex: vi,
          viewCount: visibleViews.length,
          anchor: vi === 0 ? `room-${room.id}` : undefined,
        });
      });
    });
    return list;
  }, [roomData]);

  const slotsByAfterKey = useMemo(() => {
    const next = new Map<string, PresentationExtraPageSlot[]>();
    presentationExtraPages.forEach((slot) => {
      const current = next.get(slot.afterSlideKey) ?? [];
      current.push(slot);
      next.set(slot.afterSlideKey, current);
    });
    return next;
  }, [presentationExtraPages]);

  const naturalSlides = useMemo<PresentationSlideDraft[]>(() => {
    const pageMap = new Map(designBoardPages.map((page) => [page.id, page] as const));
    const slottedBoardPageIds = new Set(
      presentationExtraPages
        .map((slot) => slot.boardPageId)
        .filter((boardPageId): boardPageId is string => Boolean(boardPageId)),
    );
    const legacyIncludedPages = includedBoardPages.filter((page) => !slottedBoardPageIds.has(page.id));
    const list: PresentationSlideDraft[] = [];
    const visitedSlotIds = new Set<string>();

    const appendExtraSlides = (afterSlideKey: string) => {
      const slots = slotsByAfterKey.get(afterSlideKey) ?? [];
      slots.forEach((slot) => {
        if (visitedSlotIds.has(slot.id)) return;
        visitedSlotIds.add(slot.id);
        const selectedPage = slot.boardPageId ? pageMap.get(slot.boardPageId) : null;
        if (selectedPage && boardPageHasRenderableContent(selectedPage)) {
          list.push({
            kind: "board-page",
            slideKey: `slot:${slot.id}`,
            slotId: slot.id,
            page: selectedPage,
          });
        }
        appendExtraSlides(`slot:${slot.id}`);
      });
    };

    baseSlides.forEach((baseSlide) => {
      list.push(baseSlide);
      appendExtraSlides(baseSlide.slideKey);
    });

    legacyIncludedPages.forEach((page) => {
      list.push({
        kind: "board-page",
        slideKey: `legacy:${page.id}`,
        page,
      });
    });

    return list;
  }, [baseSlides, designBoardPages, includedBoardPages, presentationExtraPages, slotsByAfterKey]);

  const allSlides = useMemo(
    () =>
      numberPresentationSlides(
        applyPresentationSlideOrder(
          applyPresentationRenderingOverrides(naturalSlides, presentationRenderingOverrides),
          presentationSlideOrder,
        ),
      ),
    [naturalSlides, presentationRenderingOverrides, presentationSlideOrder],
  );

  const slides = useMemo(
    () =>
      allSlides.filter(
        (item) => item.kind === "cover" || !presentationHiddenSlideKeySet.has(item.slideKey),
      ),
    [allSlides, presentationHiddenSlideKeySet],
  );

  const reorderPresentationSlide = useCallback(
    async (draggedSlideKey: string, targetSlideKey: string) => {
      if (draggedSlideKey === targetSlideKey) return;
      const currentIndex = slides.findIndex((item) => item.slideKey === draggedSlideKey);
      const targetIndex = slides.findIndex((item) => item.slideKey === targetSlideKey);
      if (currentIndex <= 0 || targetIndex <= 0) return;

      const nextSlides = [...slides];
      const [moved] = nextSlides.splice(currentIndex, 1);
      nextSlides.splice(targetIndex, 0, moved);
      await savePresentationSlideOrder(nextSlides.map((item) => item.slideKey));
    },
    [savePresentationSlideOrder, slides],
  );

  const [presenting, setPresenting] = useState(false);
  const [slide, setSlide] = useState(0);
  const [editingPicks, setEditingPicks] = useState(false);
  const [editingText, setEditingText] = useState(false);
  const [pdfPickerOpen, setPdfPickerOpen] = useState(false);
  const [reorderPickerOpen, setReorderPickerOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedPdfSlideKeys, setSelectedPdfSlideKeys] = useState<string[]>([]);
  const [draggingSlideKey, setDraggingSlideKey] = useState<string | null>(null);
  const [dragOverSlideKey, setDragOverSlideKey] = useState<string | null>(null);
  const [reorderDragSlideKey, setReorderDragSlideKey] = useState<string | null>(null);
  const [reorderDragOverSlideKey, setReorderDragOverSlideKey] = useState<string | null>(null);
  const exportSlideRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (typeof window === "undefined" || presenting) return;
    const h = window.location.hash;
    if (h && rooms.length) {
      const el = document.querySelector(h);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [rooms.length, presenting]);

  useEffect(() => {
    setSelectedPdfSlideKeys((current) => {
      const currentSet = new Set(current);
      const availableKeys = slides.map((item) => item.slideKey);
      const existingSelection = availableKeys.filter((key) => currentSet.has(key));
      return existingSelection.length ? existingSelection : availableKeys;
    });
  }, [slides]);

  useEffect(() => {
    setSlide((current) => Math.min(current, Math.max(slides.length - 1, 0)));
  }, [slides.length]);

  const enterPresent = useCallback(async () => {
    setSlide(0);
    setPresenting(true);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {}
  }, []);

  const exitPresent = useCallback(async () => {
    setPresenting(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {}
    }
  }, []);

  const downloadSelectedPdf = useCallback(async () => {
    const selectedSlides = slides.filter((item) => selectedPdfSlideKeys.includes(item.slideKey));
    if (!selectedSlides.length) {
      toast.error("Choose at least one page to download.");
      return;
    }

    setExportingPdf(true);
    try {
      await waitForPresentationImages(
        selectedSlides
          .map((item) => exportSlideRefs.current.get(item.slideKey))
          .filter((node): node is HTMLDivElement => Boolean(node)),
      );
      const { toPng } = await import("html-to-image");
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "px",
        format: [1400, 900],
        compress: true,
      });

      for (const [index, item] of selectedSlides.entries()) {
        const node = exportSlideRefs.current.get(item.slideKey);
        if (!node) continue;
        const dataUrl = await toPng(node, {
          width: 1400,
          height: 900,
          pixelRatio: 2,
          cacheBust: true,
          backgroundColor: "#f6f2eb",
          style: {
            width: "1400px",
            height: "900px",
          },
        });
        if (index > 0) pdf.addPage([1400, 900], "landscape");
        pdf.addImage(dataUrl, "PNG", 0, 0, 1400, 900, undefined, "FAST");
      }

      pdf.save(`${sanitizePresentationFileName(project?.name || "presentation")}.pdf`);
      toast.success("Presentation PDF downloaded.");
      setPdfPickerOpen(false);
    } catch (error) {
      console.error(error);
      toast.error("Could not download the presentation PDF.");
    } finally {
      setExportingPdf(false);
    }
  }, [project?.name, selectedPdfSlideKeys, slides]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setSlide((s) => Math.min(s + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setSlide((s) => Math.max(s - 1, 0));
      } else if (e.key === "Escape") {
        exitPresent();
      }
    };
    const onFs = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [presenting, slides.length, exitPresent]);

  if (!project)
    return (
      <AppShell>
        <div className="p-16">Loading…</div>
      </AppShell>
    );

  const canViewPresentation =
    profile?.is_active === true && canViewProjectSurface(profile, project, "presentations");
  const canEditPresentation =
    profile?.is_active === true && (profile.role === "Admin" || profile.role === "Employee");

  if (!loadingProfile && !canViewPresentation) {
    return (
      <AppShell>
        <div className="p-16">
          <div className="eyebrow">Presentation</div>
          <h1 className="mt-3 font-display text-5xl">Not ready to view yet</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
            This presentation is not currently shared for your role on this project.
          </p>
        </div>
      </AppShell>
    );
  }

  if (presenting) {
    const total = slides.length;
    const current = slides[Math.min(slide, total - 1)];
    return (
      <div className="present-mode flex flex-col">
        <div className="flex-1 overflow-hidden flex items-center justify-center">
          {current.kind === "cover" ? (
            <CoverSlide project={project} />
          ) : current.kind === "board-page" ? (
            <DesignBoardSlide
              project={project}
              page={current.page}
              pageIndex={current.pageIndex}
              pageCount={current.pageCount}
            />
          ) : (
            <RoomSlide
              project={project}
              room={current.room}
              data={current.data}
              view={current.view}
              viewIndex={current.viewIndex}
              viewCount={current.viewCount}
              hiddenSections={presentationHiddenSections[current.slideKey] ?? []}
            />
          )}
        </div>
        <div className="absolute top-4 right-4 flex items-center gap-2 opacity-40 hover:opacity-100 transition-opacity">
          <span className="text-xs text-muted-foreground">
            {slide + 1} / {total}
          </span>
          <button onClick={exitPresent} className="p-2 hover:bg-muted rounded" aria-label="Exit">
            <X className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={() => setSlide((s) => Math.max(s - 1, 0))}
          disabled={slide === 0}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-background/60 backdrop-blur border border-border hover:bg-background disabled:opacity-20"
          aria-label="Previous"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={() => setSlide((s) => Math.min(s + 1, total - 1))}
          disabled={slide >= total - 1}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-background/60 backdrop-blur border border-border hover:bg-background disabled:opacity-20"
          aria-label="Next"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="page-pad print:p-0">
        <div className="flex items-center justify-between mb-8 print:hidden">
          <Link
            to="/projects/$id"
            params={{ id: project.id }}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to project
          </Link>
          <div className="flex items-center gap-2">
            {canEditPresentation && (
              <>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setReorderPickerOpen((value) => !value)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 border border-border text-ink text-sm hover:border-ink transition-colors"
                    aria-expanded={reorderPickerOpen}
                  >
                    <GripVertical className="w-4 h-4" /> Reorder Pages
                  </button>
                  {reorderPickerOpen && (
                    <div className="absolute right-0 top-full z-30 mt-2 w-[360px] border border-border bg-white p-2 shadow-xl">
                      <div className="max-h-[60vh] overflow-y-auto">
                        {allSlides.map((item, index) => {
                          const isCover = item.kind === "cover";
                          const isHidden = presentationHiddenSlideKeySet.has(item.slideKey);
                          const canDragRow = !isCover && !isHidden;
                          const isRowTarget =
                            reorderDragOverSlideKey === item.slideKey &&
                            reorderDragSlideKey !== item.slideKey;
                          return (
                            <div
                              key={`reorder-${item.slideKey}`}
                              draggable={canDragRow}
                              onDragStart={(event) => {
                                if (!canDragRow) return;
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", item.slideKey);
                                setReorderDragSlideKey(item.slideKey);
                              }}
                              onDragEnd={() => {
                                setReorderDragSlideKey(null);
                                setReorderDragOverSlideKey(null);
                              }}
                              onDragOver={(event) => {
                                if (!canDragRow || !reorderDragSlideKey) return;
                                event.preventDefault();
                                setReorderDragOverSlideKey(item.slideKey);
                              }}
                              onDragLeave={() => {
                                if (reorderDragOverSlideKey === item.slideKey) {
                                  setReorderDragOverSlideKey(null);
                                }
                              }}
                              onDrop={(event) => {
                                if (!canDragRow || !reorderDragSlideKey) return;
                                event.preventDefault();
                                const sourceSlideKey =
                                  event.dataTransfer.getData("text/plain") || reorderDragSlideKey;
                                setReorderDragSlideKey(null);
                                setReorderDragOverSlideKey(null);
                                void reorderPresentationSlide(sourceSlideKey, item.slideKey);
                              }}
                              className={`flex items-center gap-3 border px-3 py-2 text-left text-sm transition-colors ${
                                isRowTarget
                                  ? "border-ink bg-muted"
                                  : "border-transparent hover:border-border hover:bg-muted/40"
                              } ${canDragRow ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${
                                isHidden ? "opacity-55" : isCover ? "opacity-70" : ""
                              }`}
                            >
                              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-ink">
                                  {presentationSlideLabel(item)}
                                  {isHidden && (
                                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                                      Hidden
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">Page {index + 1}</div>
                              </div>
                              {!isCover && (
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void updatePresentationSlideHidden(item.slideKey, !isHidden);
                                    }}
                                    className="border border-border bg-white px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:border-ink hover:text-ink"
                                  >
                                    {isHidden ? "Show" : "Hide"}
                                  </button>
                                  {item.kind === "board-page" && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void deletePresentationSlide(item);
                                      }}
                                      className="border border-red-200 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-red-600 hover:border-red-300 hover:bg-red-50"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEditingPicks((value) => !value)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-border text-ink text-sm hover:border-ink transition-colors"
                >
                  {editingPicks ? "Done Editing" : "Edit Picks"}
                </button>
                <button
                  onClick={() => setEditingText((value) => !value)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-border text-ink text-sm hover:border-ink transition-colors"
                >
                  <Type className="w-4 h-4" /> {editingText ? "Done Text" : "Edit Text"}
                </button>
              </>
            )}
            <button
              onClick={enterPresent}
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
            >
              <Maximize2 className="w-4 h-4" /> Present
            </button>
            <button
              onClick={() => setPdfPickerOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-ink text-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors"
            >
              <Download className="w-4 h-4" /> Download PDF
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-primary-foreground text-sm"
            >
              <Printer className="w-4 h-4" /> Print / PDF
            </button>
          </div>
        </div>

        {pdfPickerOpen && (
          <PresentationPdfPicker
            slides={slides}
            selectedSlideKeys={selectedPdfSlideKeys}
            exporting={exportingPdf}
            onToggle={(slideKey) =>
              setSelectedPdfSlideKeys((current) =>
                current.includes(slideKey)
                  ? current.filter((key) => key !== slideKey)
                  : [...current, slideKey],
              )
            }
            onSelectAll={() => setSelectedPdfSlideKeys(slides.map((item) => item.slideKey))}
            onSelectNone={() => setSelectedPdfSlideKeys([])}
            onClose={() => {
              if (!exportingPdf) setPdfPickerOpen(false);
            }}
            onDownload={() => void downloadSelectedPdf()}
          />
        )}

        <div
          className="pointer-events-none fixed left-[-10000px] top-0 z-[-1]"
          aria-hidden="true"
        >
          {slides.map((current) => (
            <div
              key={`export-${current.slideKey}`}
              ref={(node) => {
                if (node) exportSlideRefs.current.set(current.slideKey, node);
                else exportSlideRefs.current.delete(current.slideKey);
              }}
              className="h-[900px] w-[1400px] overflow-hidden bg-bone"
            >
              {current.kind === "cover" ? (
                <CoverSlide project={project} />
              ) : current.kind === "board-page" ? (
                <DesignBoardSlide
                  project={project}
                  page={current.page}
                  pageIndex={current.pageIndex}
                  pageCount={current.pageCount}
                />
              ) : (
                <RoomSlide
                  project={project}
                  room={current.room}
                  data={current.data}
                  view={current.view}
                  viewIndex={current.viewIndex}
                  viewCount={current.viewCount}
                  hiddenSections={presentationHiddenSections[current.slideKey] ?? []}
                />
              )}
            </div>
          ))}
        </div>

        <div className="hidden print:flex print-page min-h-[9.5in] flex-col justify-between p-12">
          <BrandCover project={project} />
        </div>

        <div className="mb-10 print:hidden">
          <div className="eyebrow text-[11px]">{project.client_name}</div>
          <h1 className="editorial-hero text-5xl lg:text-7xl mt-2">{project.name}</h1>
          {rooms.length > 1 && (
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              {rooms.map((r) => (
                <a
                  key={r.id}
                  href={`#room-${r.id}`}
                  className="hover:text-ink underline-offset-4 hover:underline"
                >
                  {r.name}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-12 print:space-y-0">
          <section className="print:hidden bg-white border border-border min-h-[72vh]">
            <BrandCover
              project={project}
              onTextChange={editingText ? updateCoverText : undefined}
            />
          </section>
          {rooms.length === 0 && <div className="text-sm text-muted-foreground">No rooms yet.</div>}
          {slides.map((current) => {
            const isCover = current.kind === "cover";
            const draggable = canEditPresentation && !isCover;
            const isDragTarget = dragOverSlideKey === current.slideKey && draggingSlideKey !== current.slideKey;
            return (
              <div
                key={current.slideKey}
                className={`space-y-4 ${isDragTarget ? "outline outline-2 outline-offset-8 outline-ink" : ""}`}
                onDragOver={(event) => {
                  if (!draggable || !draggingSlideKey) return;
                  event.preventDefault();
                  setDragOverSlideKey(current.slideKey);
                }}
                onDragLeave={() => {
                  if (dragOverSlideKey === current.slideKey) setDragOverSlideKey(null);
                }}
                onDrop={(event) => {
                  if (!draggable || !draggingSlideKey) return;
                  event.preventDefault();
                  const sourceSlideKey = event.dataTransfer.getData("text/plain") || draggingSlideKey;
                  setDragOverSlideKey(null);
                  setDraggingSlideKey(null);
                  void reorderPresentationSlide(sourceSlideKey, current.slideKey);
                }}
              >
                {draggable && (
                  <div className="print:hidden flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", current.slideKey);
                        setDraggingSlideKey(current.slideKey);
                      }}
                      onDragEnd={() => {
                        setDraggingSlideKey(null);
                        setDragOverSlideKey(null);
                      }}
                      className="inline-flex cursor-grab items-center gap-2 border border-border bg-white px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-ink hover:text-ink active:cursor-grabbing"
                      aria-label={`Drag ${presentationSlideLabel(current)} to reorder`}
                    >
                      <GripVertical className="h-4 w-4" />
                      Page {slides.findIndex((item) => item.slideKey === current.slideKey) + 1}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void updatePresentationSlideHidden(current.slideKey, true)}
                        className="inline-flex h-9 items-center gap-2 border border-border bg-white px-3 text-xs uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-ink hover:text-ink"
                      >
                        <EyeOff className="h-4 w-4" /> Hide Page
                      </button>
                      {current.kind === "board-page" && (
                        <button
                          type="button"
                          onClick={() => void deletePresentationSlide(current)}
                          className="inline-flex h-9 items-center gap-2 border border-red-200 bg-white px-3 text-xs uppercase tracking-[0.14em] text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" /> Delete Page
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {isCover ? null : current.kind === "view" ? (
                  <RoomSpread
                    project={project}
                    room={current.room}
                    data={current.data}
                    view={current.view}
                    viewIndex={current.viewIndex}
                    viewCount={current.viewCount}
                    hiddenSections={presentationHiddenSections[current.slideKey] ?? []}
                    onToggleSidebarSection={
                      editingPicks
                        ? (section, hidden) =>
                            updatePresentationHiddenSection(current.slideKey, section, hidden)
                        : undefined
                    }
                    anchor={current.anchor}
                    onPick={
                      editingPicks
                        ? (patch) => updatePresentationPicks(current.room.id, patch)
                        : undefined
                    }
                    onUpdateViewSketch={
                      editingPicks && current.view.hero
                        ? (sketchupId) =>
                            updateRenderingSketchLink(current.room.id, current.view.hero!.id, sketchupId)
                        : undefined
                    }
                    onUpdateViewRendering={
                      editingPicks && current.view.hero
                        ? (renderingId) => updateViewRendering(current.slideKey, renderingId)
                        : undefined
                    }
                    onToggleViewVisibility={
                      editingPicks && !current.view.hero
                        ? () => {
                            const image = current.view.hero || current.view.sketch;
                            if (image)
                              updateViewVisibility(current.room.id, image.id, !current.view.visible);
                          }
                        : undefined
                    }
                    onChangeImageLayout={
                      editingPicks && current.view.hero && current.view.sketch
                        ? (layout) =>
                            updateViewImageLayout(
                              current.room.id,
                              current.view.hero!.id,
                              layout,
                            )
                        : undefined
                    }
                    onTextChange={
                      editingText ? (patch) => updateSlideText(current.room.id, patch) : undefined
                    }
                  />
                ) : (
                  <DesignBoardSpread
                    project={project}
                    page={current.page}
                    pageIndex={current.pageIndex}
                    pageCount={current.pageCount}
                  />
                )}

                <PresentationExtraPageManager
                  afterSlideKey={current.slideKey}
                  slots={slotsByAfterKey.get(current.slideKey) ?? []}
                  pages={designBoardPages}
                  onAdd={() => void addPresentationExtraPage(current.slideKey)}
                  onChange={(slotId, pageId) => void updatePresentationExtraPage(slotId, pageId)}
                  onRemove={(slotId) => void removePresentationExtraPage(slotId)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function CoverSlide({ project }: { project: any }) {
  return (
    <div className="w-full h-full">
      <BrandCover project={project} />
    </div>
  );
}

function BrandCover({
  project,
  onTextChange,
}: {
  project: any;
  onTextChange?: (patch: Record<string, string | null>) => void;
}) {
  const editingText = !!onTextChange;
  const conceptText = project.design_concept || "Conceptual Design";
  return (
    <div className="w-full h-full min-h-[inherit] flex items-center justify-center bg-white px-8 py-20 text-center">
      <div className="w-full">
        <div className="font-display text-ink uppercase leading-none tracking-[-0.075em] text-[clamp(4.25rem,7.6vw,10rem)] whitespace-nowrap">
          MERAV INTERIORS
        </div>
        <div className="mt-5 text-[#9b9793] uppercase tracking-[0.42em] text-[clamp(0.95rem,1.75vw,1.9rem)] font-light">
          By Katie Roberts
        </div>
        {editingText ? (
          <div className="mx-auto mt-24 max-w-3xl space-y-5 print:hidden">
            <input
              key={`cover-name-${project.name}`}
              defaultValue={project.name}
              onBlur={(event) =>
                onTextChange?.({ name: event.target.value.trim() || project.name })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="w-full border border-border bg-background px-3 py-2 text-center font-[var(--font-montserrat)] text-ink uppercase tracking-[0.12em] text-[clamp(1.4rem,2.8vw,3rem)] font-light leading-tight"
              aria-label="Cover project name"
            />
            <input
              key={`cover-concept-${conceptText}`}
              defaultValue={conceptText}
              onBlur={(event) =>
                onTextChange?.({ design_concept: event.target.value.trim() || null })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="w-full border border-border bg-background px-3 py-2 text-center font-[var(--font-montserrat)] text-ink uppercase tracking-[0.28em] text-[clamp(0.95rem,1.5vw,1.45rem)] font-light"
              aria-label="Cover subtitle"
            />
          </div>
        ) : (
          <>
            <div className="mt-24 font-[var(--font-montserrat)] text-ink uppercase tracking-[0.12em] text-[clamp(1.4rem,2.8vw,3rem)] font-light leading-tight">
              {project.name}
            </div>
            <div className="mt-5 font-[var(--font-montserrat)] text-ink uppercase tracking-[0.28em] text-[clamp(0.95rem,1.5vw,1.45rem)] font-light">
              {conceptText}
            </div>
          </>
        )}
        {editingText && (
          <div className="hidden print:block">
            <div className="mt-24 font-[var(--font-montserrat)] text-ink uppercase tracking-[0.12em] text-[clamp(1.4rem,2.8vw,3rem)] font-light leading-tight">
              {project.name}
            </div>
            <div className="mt-5 font-[var(--font-montserrat)] text-ink uppercase tracking-[0.28em] text-[clamp(0.95rem,1.5vw,1.45rem)] font-light">
              {conceptText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PresentationFooter({
  align = "center",
  sidePaddingPx = 48,
}: {
  align?: "center" | "mainColumn";
  sidePaddingPx?: number;
}) {
  const style =
    align === "mainColumn"
      ? ({
          "--presentation-footer-left": `calc(${sidePaddingPx}px + (((100% - ${sidePaddingPx * 2}px - 24px) * 1.6 / 2.6) / 2))`,
        } as CSSProperties)
      : undefined;

  return (
    <div
      style={style}
      className={`absolute bottom-5 z-10 -translate-x-1/2 text-center pointer-events-none print:bottom-4 ${
        align === "mainColumn" ? "left-1/2 lg:left-[var(--presentation-footer-left)]" : "left-1/2"
      }`}
    >
      <div className="font-display text-ink uppercase leading-none tracking-[-0.07em] text-[clamp(2rem,4vw,4.25rem)] whitespace-nowrap">
        MERAV INTERIORS
      </div>
      <div className="mt-2 text-[#9b9793] uppercase tracking-[0.38em] text-[clamp(0.45rem,0.85vw,0.75rem)] font-light">
        By Katie Roberts
      </div>
    </div>
  );
}

function PresentationBrandMark({ className = "" }: { className?: string }) {
  return (
    <div className={`text-center pointer-events-none ${className}`}>
      <div className="font-display text-ink uppercase leading-none tracking-[-0.07em] text-[clamp(2rem,3.4vw,4rem)] whitespace-nowrap">
        MERAV INTERIORS
      </div>
      <div className="mt-2 text-[#9b9793] uppercase tracking-[0.38em] text-[clamp(0.45rem,0.72vw,0.75rem)] font-light">
        By Katie Roberts
      </div>
    </div>
  );
}

function RoomSlide({
  project,
  room,
  data,
  view,
  viewIndex,
  viewCount,
  hiddenSections = [],
}: {
  project: any;
  room: any;
  data: RoomData;
  view: RoomData["views"][number];
  viewIndex: number;
  viewCount: number;
  hiddenSections?: PresentationSidebarSection[];
}) {
  const primaryImage = primaryPresentationImage(view);
  return (
    <div className="relative w-full h-full grid lg:grid-cols-[1.6fr_1fr] gap-6 bg-bone px-8 pt-8 pb-24 lg:px-12 lg:pt-12 lg:pb-28">
      <div className="flex flex-col min-h-0">
        <div className="mb-4">
          <div className="eyebrow text-[11px]">
            {project.name} · {project.client_name}
            {viewCount > 1 && (
              <span className="ml-2 opacity-60">
                · View {viewIndex + 1} of {viewCount}
              </span>
            )}
          </div>
          <h2 className="font-display text-4xl lg:text-6xl text-ink mt-2 leading-tight">
            {room.name}
          </h2>
        </div>
        <div className="relative overflow-hidden flex-1 min-h-0">
          {primaryImage ? (
            <img src={normalizeSupabaseImageUrl(primaryImage.url)} alt={room.name} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
              No image yet
            </div>
          )}
        </div>
      </div>
      <SpreadSidebar data={data} room={room} view={view} hiddenSections={hiddenSections} />
      <PresentationFooter align="mainColumn" sidePaddingPx={48} />
    </div>
  );
}

function DesignBoardSlide({
  project,
  page,
  pageIndex,
  pageCount,
}: {
  project: any;
  page: PresentationBoardPage;
  pageIndex: number;
  pageCount: number;
}) {
  return (
    <div className="relative flex h-full w-full flex-col bg-bone px-8 py-8 lg:px-12 lg:py-10">
      <div className="mb-4 shrink-0">
        <div className="eyebrow text-[11px]">
          {project.name} · {project.client_name}
          {pageCount > 1 && (
            <span className="ml-2 opacity-60">
              · Extra Page {pageIndex + 1} of {pageCount}
            </span>
          )}
        </div>
        <h2 className="mt-2 font-display text-4xl leading-tight text-ink lg:text-6xl">
          {page.title}
        </h2>
      </div>
      <div className="mx-auto min-h-0 flex-1 aspect-[14/9] max-w-full">
        <DesignBoardCanvasPreview page={page} fill />
      </div>
    </div>
  );
}

function DesignBoardSpread({
  project,
  page,
  pageIndex,
  pageCount,
}: {
  project: any;
  page: PresentationBoardPage;
  pageIndex: number;
  pageCount: number;
}) {
  return (
    <section className="relative border border-border bg-bone print:border-0 print-page">
      <div className="px-10 pb-10 pt-10 print:px-10 print:pb-8 print:pt-8">
        <div className="mb-6 flex items-start justify-between gap-8">
          <div className="min-w-0">
            <div className="eyebrow text-[11px]">
              {project.name} · {project.client_name}
              {pageCount > 1 && (
                <span className="ml-2 opacity-60">
                  · Extra Page {pageIndex + 1} of {pageCount}
                </span>
              )}
            </div>
            <h2 className="mt-2 font-display text-4xl leading-tight text-ink lg:text-5xl">
              {page.title}
            </h2>
          </div>
          <PresentationBrandMark className="hidden shrink-0 pt-1 md:block" />
        </div>
        <DesignBoardCanvasPreview page={page} />
      </div>
    </section>
  );
}

function PresentationExtraPageManager({
  slots,
  pages,
  onAdd,
  onChange,
  onRemove,
}: {
  slots: PresentationExtraPageSlot[];
  pages: PresentationBoardPage[];
  onAdd: () => void;
  onChange: (slotId: string, pageId: string) => void;
  onRemove: (slotId: string) => void;
}) {
  return (
    <section className="print:hidden">
      <div className="flex items-center gap-3 py-2">
        <div className="h-px flex-1 bg-border" />
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-2 bg-transparent px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-ink"
        >
          <Plus className="h-4 w-4" /> Add Extra Page
        </button>
        <div className="h-px flex-1 bg-border" />
      </div>

      {slots.length ? (
        <div className="space-y-2 pb-2">
          {slots.map((slot, index) => (
            <div
              key={slot.id}
              className="flex flex-col gap-2 rounded border border-border bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Extra Page {index + 1}
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <select
                  value={slot.boardPageId ?? ""}
                  onChange={(event) => onChange(slot.id, event.target.value)}
                  className="min-w-[16rem] border border-border bg-background px-3 py-2 text-sm text-ink"
                  aria-label={`Design Board page for extra page ${index + 1}`}
                >
                  {pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onRemove(slot.id)}
                  className="inline-flex items-center gap-2 border border-red-200 bg-white px-3 py-2 text-sm text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PresentationPdfPicker({
  slides,
  selectedSlideKeys,
  exporting,
  onToggle,
  onSelectAll,
  onSelectNone,
  onClose,
  onDownload,
}: {
  slides: PresentationSlide[];
  selectedSlideKeys: string[];
  exporting: boolean;
  onToggle: (slideKey: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onClose: () => void;
  onDownload: () => void;
}) {
  const selectedCount = selectedSlideKeys.length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4 print:hidden">
      <div className="w-full max-w-2xl border border-border bg-background shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <div className="eyebrow">Presentation PDF</div>
            <h2 className="mt-1 font-display text-3xl text-ink">Choose pages to download</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Each selected presentation page will export as its own high-quality PDF page.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="p-2 text-muted-foreground hover:text-ink disabled:opacity-50"
            aria-label="Close PDF picker"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="text-sm text-muted-foreground">
            {selectedCount} of {slides.length} pages selected
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSelectAll}
              disabled={exporting}
              className="border border-border px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-ink hover:border-ink disabled:opacity-50"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={onSelectNone}
              disabled={exporting}
              className="border border-border px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-ink hover:border-ink disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-5">
          <div className="space-y-2">
            {slides.map((item, index) => {
              const checked = selectedSlideKeys.includes(item.slideKey);
              return (
                <label
                  key={item.slideKey}
                  className={`flex cursor-pointer items-center gap-3 border px-4 py-3 transition-colors ${
                    checked
                      ? "border-ink bg-bone"
                      : "border-border bg-white hover:border-ink/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={exporting}
                    onChange={() => onToggle(item.slideKey)}
                    className="h-4 w-4 accent-ink"
                  />
                  <span className="w-8 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="flex-1 text-sm text-ink">{presentationSlideLabel(item)}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-border p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="border border-border px-5 py-2.5 text-sm text-ink hover:border-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={exporting || selectedCount === 0}
            className="bg-ink px-5 py-2.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {exporting ? "Building PDF..." : "Download Selected PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PresentationBoardPagesPanel({
  projectId,
  pages,
  onTogglePage,
  editing,
}: {
  projectId: string;
  pages: PresentationBoardPage[];
  onTogglePage: (pageId: string, visible: boolean) => Promise<void>;
  editing: boolean;
}) {
  return (
    <section className="print:hidden border border-border bg-white p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="eyebrow">Extra Presentation Pages</div>
          <h2 className="mt-2 font-display text-3xl text-ink">Design Board Pages</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Upload screenshots or build a custom layout on the Design Board, then turn that board
            page into a presentation slide here.
          </p>
        </div>
        <Link
          to="/projects/$id/design-boards"
          params={{ id: projectId }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
        >
          Open Design Board <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
      {!pages.length ? (
        <div className="mt-6 rounded border border-dashed border-border bg-bone/40 px-4 py-6 text-sm text-muted-foreground">
          No design board pages yet. Create a board page first, then you can add it here.
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {pages.map((page) => (
            <div key={page.id} className="border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-display text-2xl text-ink">{page.title}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {page.elements.filter(boardElementIsMeaningful).length} board items
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onTogglePage(page.id, !page.presentationVisible)}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-[0.18em] transition-colors ${
                    page.presentationVisible
                      ? "bg-ink text-primary-foreground"
                      : "border border-border bg-white text-ink hover:border-ink"
                  }`}
                >
                  {page.presentationVisible ? <Check className="h-3.5 w-3.5" /> : null}
                  {page.presentationVisible ? "In Presentation" : "Add to Presentation"}
                </button>
              </div>
              <div className="mt-4">
                <DesignBoardCanvasPreview page={page} compact />
              </div>
            </div>
          ))}
        </div>
      )}
      {!editing && pages.some((page) => page.presentationVisible) && (
        <div className="mt-4 text-xs text-muted-foreground">
          Included board pages will print, present, and show up in the online presentation.
        </div>
      )}
    </section>
  );
}

function DesignBoardCanvasPreview({
  page,
  compact = false,
  fill = false,
}: {
  page: PresentationBoardPage;
  compact?: boolean;
  fill?: boolean;
}) {
  const sortedElements = [...page.elements]
    .filter(boardElementIsMeaningful)
    .sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div
      className={`relative overflow-hidden border border-border bg-white ${
        fill
          ? "h-full w-full"
          : compact
            ? "aspect-[14/9]"
            : "aspect-[14/9] lg:min-h-[640px] print:min-h-0"
      }`}
    >
      {sortedElements.length ? (
        sortedElements.map((element) => (
          <DesignBoardCanvasElement key={element.id} element={element} compact={compact} />
        ))
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
          Empty board page
        </div>
      )}
    </div>
  );
}

function DesignBoardCanvasElement({
  element,
  compact,
}: {
  element: PresentationBoardElement;
  compact: boolean;
}) {
  const left = `${(element.x / DESIGN_BOARD_PRESENTATION_WIDTH) * 100}%`;
  const top = `${(element.y / DESIGN_BOARD_PRESENTATION_HEIGHT) * 100}%`;
  const width = `${(element.width / DESIGN_BOARD_PRESENTATION_WIDTH) * 100}%`;
  const height = `${(element.height / DESIGN_BOARD_PRESENTATION_HEIGHT) * 100}%`;
  const transform = element.rotation ? `rotate(${element.rotation}deg)` : undefined;

  if (element.type === "image") {
    const src = normalizeSupabaseImageUrl(element.backgroundRemovedUrl || element.src);
    if (!src) return null;
    return (
      <div
        className="absolute"
        style={{ left, top, width, height, transform, transformOrigin: "center center" }}
      >
        <img
          src={src}
          alt={element.text || element.id}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  if (element.type === "shape") {
    return (
      <div
        className="absolute"
        style={{
          left,
          top,
          width,
          height,
          transform,
          transformOrigin: "center center",
          background: element.background || "#e7e0d5",
        }}
      />
    );
  }

  return (
    <div
      className="absolute whitespace-pre-wrap break-words leading-tight"
      style={{
        left,
        top,
        width,
        minHeight: height,
        transform,
        transformOrigin: "center center",
        color: element.color || "#1c1814",
        fontFamily: element.fontFamily || "var(--font-montserrat)",
        fontSize: `clamp(${compact ? 7 : 10}px, ${(element.fontSize ?? 24) / 14}px, ${compact ? 22 : 40}px)`,
        letterSpacing: `${Math.max(0, element.letterSpacing ?? 0) / 10}em`,
      }}
    >
      {element.text}
    </div>
  );
}

function RoomSpread({
  project,
  room,
  data,
  view,
  viewIndex,
  viewCount,
  hiddenSections = [],
  anchor,
  onPick,
  onUpdateViewSketch,
  onUpdateViewRendering,
  onToggleSidebarSection,
  onToggleViewVisibility,
  onChangeImageLayout,
  onTextChange,
}: {
  project: any;
  room: any;
  data: RoomData;
  view: RoomData["views"][number];
  viewIndex: number;
  viewCount: number;
  hiddenSections?: PresentationSidebarSection[];
  anchor?: string;
  onPick?: (patch: Record<string, string | string[] | null>) => void;
  onUpdateViewSketch?: (sketchupId: string | null) => void;
  onUpdateViewRendering?: (renderingId: string) => void;
  onToggleSidebarSection?: (section: PresentationSidebarSection, hidden: boolean) => void;
  onToggleViewVisibility?: () => void;
  onChangeImageLayout?: (layout: PresentationImageLayout) => void;
  onTextChange?: (patch: Record<string, string | null>) => void;
}) {
  const primaryImage = primaryPresentationImage(view);
  const comparisonImage = comparisonPresentationImage(view);
  const sketchupHero = viewUsesSketchupAsHero(view);
  const comparisonHidden = viewHidesComparisonImage(view);
  const nextLargeLayout: PresentationImageLayout = sketchupHero
    ? comparisonHidden
      ? "ai-only"
      : "ai-with-sketchup"
    : comparisonHidden
      ? "sketchup-only"
      : "sketchup-with-ai";
  const nextComparisonLayout: PresentationImageLayout = comparisonHidden
    ? sketchupHero
      ? "sketchup-with-ai"
      : "ai-with-sketchup"
    : sketchupHero
      ? "sketchup-only"
      : "ai-only";
  const editingText = !!onTextChange;
  return (
    <section
      id={anchor}
      className={`relative bg-bone border border-border print:border-0 print-page scroll-mt-24 ${!view.visible ? "opacity-55" : ""}`}
    >
      <div className="px-10 lg:px-14 pt-10 pb-6 print:pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow text-[11px]">
              {project.name} · {project.client_name}
              {viewCount > 1 && (
                <span className="ml-2 opacity-60">
                  · View {viewIndex + 1} of {viewCount}
                </span>
              )}
              {!view.visible && <span className="ml-2 text-destructive">· Hidden</span>}
            </div>
            {editingText ? (
              <input
                key={`title-${room.id}-${room.name}`}
                defaultValue={room.name}
                onBlur={(event) => onTextChange?.({ name: event.target.value.trim() || room.name })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="mt-2 w-full max-w-xl border border-border bg-background px-3 py-2 font-display text-4xl lg:text-5xl text-ink leading-tight"
                aria-label="Slide room title"
              />
            ) : (
              <h2 className="font-display text-4xl lg:text-5xl text-ink mt-2 leading-tight">
                {room.name}
              </h2>
            )}
          </div>
          {(onChangeImageLayout || onToggleViewVisibility) && (
            <div className="print:hidden flex items-center gap-2">
              {onChangeImageLayout && (
                <>
                  <button
                    type="button"
                    onClick={() => onChangeImageLayout(nextLargeLayout)}
                    className="inline-flex h-10 items-center border border-border bg-background px-3 text-xs uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-ink hover:text-ink"
                  >
                    {sketchupHero ? "AI Large" : "SketchUp Large"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeImageLayout(nextComparisonLayout)}
                    className={`inline-flex h-10 items-center border px-3 text-xs uppercase tracking-[0.14em] transition-colors ${
                      comparisonHidden
                        ? "border-ink bg-ink text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-ink hover:text-ink"
                    }`}
                    aria-pressed={comparisonHidden}
                  >
                    {comparisonHidden ? "Show Corner" : "Hide Corner"}
                  </button>
                </>
              )}
              {onToggleViewVisibility && (
                <button
                  type="button"
                  title={view.visible ? "Hide view" : "Show view"}
                  aria-label={view.visible ? "Hide presentation view" : "Show presentation view"}
                  onClick={onToggleViewVisibility}
                  className={`inline-flex h-10 w-10 items-center justify-center border transition-colors ${
                    view.visible
                      ? "border-ink bg-ink text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-ink hover:text-ink"
                  }`}
                >
                  {view.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6 px-10 lg:px-14 pb-28 print:pb-24">
        <div className="relative overflow-hidden aspect-[4/3] lg:aspect-auto lg:min-h-[640px] print:min-h-0 print:aspect-[4/3]">
          {primaryImage ? (
            <img src={normalizeSupabaseImageUrl(primaryImage.url)} alt={room.name} className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
              No image yet
            </div>
          )}
          {view.hero && (
            <div
              className={`absolute bottom-0 left-0 right-0 p-6 lg:p-8 bg-gradient-to-t from-black/60 to-transparent text-primary-foreground ${editingText ? "" : "pointer-events-none"}`}
            >
              {editingText ? (
                <div className="max-w-xl space-y-2 print:hidden">
                  <input
                    key={`label-${room.id}-${room.presentation_overlay_label || ""}`}
                    defaultValue={room.presentation_overlay_label || DEFAULT_OVERLAY_LABEL}
                    onBlur={(event) =>
                      onTextChange?.({
                        presentation_overlay_label: event.target.value.trim() || null,
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="w-full border border-white/40 bg-black/30 px-2 py-1 text-[10px] uppercase tracking-[0.28em] text-primary-foreground placeholder:text-primary-foreground/50"
                    aria-label="Slide overlay label"
                  />
                  <textarea
                    key={`body-${room.id}-${room.presentation_overlay_body || ""}`}
                    defaultValue={room.presentation_overlay_body || DEFAULT_OVERLAY_BODY}
                    onBlur={(event) =>
                      onTextChange?.({
                        presentation_overlay_body: event.target.value.trim() || null,
                      })
                    }
                    rows={2}
                    className="w-full resize-none border border-white/40 bg-black/30 px-2 py-1 font-display text-sm lg:text-base leading-snug text-primary-foreground placeholder:text-primary-foreground/50"
                    aria-label="Slide overlay body"
                  />
                </div>
              ) : (
                <>
                  <div className="eyebrow text-[10px] text-primary-foreground/80">
                    {room.presentation_overlay_label || DEFAULT_OVERLAY_LABEL}
                  </div>
                  <p className="font-display text-sm lg:text-base mt-1 max-w-md leading-snug">
                    {room.presentation_overlay_body || DEFAULT_OVERLAY_BODY}
                  </p>
                </>
              )}
              {editingText && (
                <div className="hidden print:block">
                  <div className="eyebrow text-[10px] text-primary-foreground/80">
                    {room.presentation_overlay_label || DEFAULT_OVERLAY_LABEL}
                  </div>
                  <p className="font-display text-sm lg:text-base mt-1 max-w-md leading-snug">
                    {room.presentation_overlay_body || DEFAULT_OVERLAY_BODY}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <SpreadSidebar
          data={data}
          room={room}
          view={view}
          comparisonImage={comparisonImage}
          hiddenSections={hiddenSections}
          onPick={onPick}
          onUpdateViewSketch={onUpdateViewSketch}
          onUpdateViewRendering={onUpdateViewRendering}
          onToggleSidebarSection={onToggleSidebarSection}
        />
      </div>
      <PresentationFooter align="mainColumn" sidePaddingPx={56} />
    </section>
  );
}

function SpreadSidebar({
  data,
  room,
  view,
  comparisonImage,
  hiddenSections = [],
  onPick,
  onUpdateViewSketch,
  onUpdateViewRendering,
  onToggleSidebarSection,
}: {
  data: RoomData;
  room?: any;
  view: RoomData["views"][number];
  comparisonImage?: ReturnType<typeof comparisonPresentationImage>;
  hiddenSections?: PresentationSidebarSection[];
  onPick?: (patch: Record<string, string | string[] | null>) => void;
  onUpdateViewSketch?: (sketchupId: string | null) => void;
  onUpdateViewRendering?: (renderingId: string) => void;
  onToggleSidebarSection?: (section: PresentationSidebarSection, hidden: boolean) => void;
}) {
  const editing = !!onPick;
  const hiddenSectionSet = new Set(hiddenSections);
  const showPalette = !hiddenSectionSet.has("palette");
  const showCabinet = !hiddenSectionSet.has("cabinet");
  const showCounter = !hiddenSectionSet.has("counter");
  const showFaucet = !hiddenSectionSet.has("faucet");
  const activeComparisonImage = comparisonImage === undefined ? comparisonPresentationImage(view) : comparisonImage;
  const paletteItems = data.paletteMaterials
    .filter((material) => materialImageUrl(material))
    .slice(0, 4);
  const hasCabinetry = !!data.cabinetProduct?.product || !!data.cabinetMaterial;
  const hasCounter = !!data.counter;
  const hasFaucet = !!data.faucet?.item_label || !!data.faucet?.product;
  const setPaletteSlot = (index: number, id: string) => {
    const ids = Array.from({ length: 4 }, (_, i) => data.paletteMaterials[i]?.id ?? "");
    ids[index] = id;
    const trimmed = ids.map((value) => value || null);
    while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop();
    onPick?.({
      presentation_palette_item_ids: trimmed.length ? (trimmed.filter(Boolean) as string[]) : null,
    });
  };

  return (
    <div className="flex flex-col gap-6 print:gap-3">
      {onPick && view.hero && onUpdateViewRendering && (
        <Card label="Presentation Image">
          <div className="print:hidden">
            <ImagePickSelect
              label="AI Rendering"
              value={view.hero.id}
              options={data.renderingOptions}
              emptyLabel="Select rendering"
              onChange={onUpdateViewRendering}
            />
          </div>
        </Card>
      )}
      {activeComparisonImage && (
        <Card label={activeComparisonImage.label}>
          <div className="aspect-[4/3] bg-bone overflow-hidden">
            {activeComparisonImage.image ? (
              <img src={normalizeSupabaseImageUrl(activeComparisonImage.image.url)} alt="" className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[11px] text-muted-foreground">
                {activeComparisonImage.emptyLabel}
              </div>
            )}
          </div>
          {onPick && activeComparisonImage.image?.kind === "sketchup" && (
            <div className="mt-3 print:hidden">
              <ImagePickSelect
                label="Design Model"
                value={view.sketch?.id ?? ""}
                options={data.sketchupOptions}
                emptyLabel="Use default"
                onChange={(id) => {
                  if (view.hero) {
                    onUpdateViewSketch?.(id || null);
                    return;
                  }
                  onPick({ presentation_sketchup_image_id: id || null });
                }}
              />
            </div>
          )}
        </Card>
      )}

      {onPick && onToggleSidebarSection && (
        <Card label="Section Visibility">
          <div className="grid grid-cols-2 gap-2 print:hidden">
            {([
              ["palette", DEFAULT_PRESENTATION_SECTION_LABELS.palette],
              ["cabinet", DEFAULT_PRESENTATION_SECTION_LABELS.cabinet],
              ["counter", DEFAULT_PRESENTATION_SECTION_LABELS.counter],
              ["faucet", DEFAULT_PRESENTATION_SECTION_LABELS.faucet],
            ] as Array<[PresentationSidebarSection, string]>).map(([section, label]) => {
              const hidden = hiddenSectionSet.has(section);
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => onToggleSidebarSection(section, !hidden)}
                  className={`border px-2 py-2 text-[10px] uppercase tracking-[0.12em] transition-colors ${
                    hidden
                      ? "border-border bg-background text-muted-foreground hover:border-ink hover:text-ink"
                      : "border-ink bg-ink text-primary-foreground"
                  }`}
                  aria-pressed={!hidden}
                >
                  {hidden ? `Show ${label}` : `Hide ${label}`}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {(showPalette || (showCabinet && (editing || hasCabinetry))) && (
      <div className="grid grid-cols-2 gap-6 print:gap-3">
        {showPalette && (
        <Card
          label={
            <EditableSectionLabel
              value={room?.presentation_palette_label}
              fallback={DEFAULT_PRESENTATION_SECTION_LABELS.palette}
              editing={editing}
              onChange={(value) => onPick?.({ presentation_palette_label: value })}
            />
          }
        >
          <div className="grid grid-cols-2 gap-1.5">
            {paletteItems.map((m) => (
              <div key={m.id} className="aspect-square bg-bone overflow-hidden">
                {materialImageUrl(m) && (
                  <img
                    src={normalizeSupabaseImageUrl(materialImageUrl(m)!)}
                    alt={clientProductName(m, { name: "" })}
                    className="w-full h-full object-contain p-1"
                  />
                )}
              </div>
            ))}
            {!paletteItems.length && (
              <div className="col-span-2 text-[11px] text-muted-foreground">
                No palette selections yet.
              </div>
            )}
          </div>
          {onPick && (
            <div className="mt-3 space-y-1 print:hidden">
              {Array.from({ length: 4 }).map((_, i) => (
                <PresentationPickSelect
                  key={`palette-pick-${i}`}
                  value={data.paletteMaterials[i]?.id ?? ""}
                  materials={data.materials}
                  onChange={(id) => setPaletteSlot(i, id)}
                />
              ))}
            </div>
          )}
        </Card>
        )}
        {showCabinet && (editing || hasCabinetry) && (
          <Card
            label={
              <EditableSectionLabel
                value={room?.presentation_cabinet_label}
                fallback={DEFAULT_PRESENTATION_SECTION_LABELS.cabinet}
                editing={editing}
                onChange={(value) => onPick?.({ presentation_cabinet_label: value })}
              />
            }
          >
            <Detail
              product={data.cabinetMaterial ? undefined : data.cabinetProduct?.product}
              fallbackImage={materialImageUrl(data.cabinetMaterial)}
              fallbackName={
                data.cabinetMaterial
                  ? clientProductName(data.cabinetMaterial, { name: "" })
                  : "Cabinet finish + hardware"
              }
              fallbackSub={data.cabinetMaterial?.product?.vendor || data.cabinetMaterial?.color}
            />
            {onPick && (
              <PresentationPickSelect
                value={data.cabinetMaterial?.id ?? ""}
                materials={data.materials}
                onChange={(id) => onPick({ presentation_cabinet_item_id: id || null })}
              />
            )}
          </Card>
        )}
      </div>
      )}

      {((showCounter && (editing || hasCounter)) || (showFaucet && (editing || hasFaucet))) && (
        <div className="grid grid-cols-2 gap-6 print:gap-3">
          {showCounter && (editing || hasCounter) && (
            <Card
              label={
                <EditableSectionLabel
                  value={room?.presentation_counter_label}
                  fallback={DEFAULT_PRESENTATION_SECTION_LABELS.counter}
                  editing={editing}
                  onChange={(value) => onPick?.({ presentation_counter_label: value })}
                />
              }
            >
              <div className="flex gap-3">
                <div className="w-16 h-16 bg-bone overflow-hidden flex-shrink-0">
                  {materialImageUrl(data.counter) && (
                    <img
                      src={normalizeSupabaseImageUrl(materialImageUrl(data.counter)!)}
                      alt=""
                      className="w-full h-full object-contain p-1"
                    />
                  )}
                </div>
                <div className="min-w-0 self-center">
                  <div className="font-display text-sm leading-tight">
                    {data.counter ? clientProductName(data.counter, { name: "" }) : "—"}
                  </div>
                  {(data.counter?.product?.name ||
                    data.counter?.product?.vendor ||
                    data.counter?.color) && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {[
                        data.counter?.product?.name,
                        data.counter?.product?.vendor,
                        data.counter?.color,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </div>
              </div>
              {onPick && (
                <PresentationPickSelect
                  value={data.counter?.id ?? ""}
                  materials={data.materials}
                  onChange={(id) => onPick({ presentation_counter_item_id: id || null })}
                />
              )}
            </Card>
          )}
          {showFaucet && (editing || hasFaucet) && (
            <Card
              label={
                <EditableSectionLabel
                  value={room?.presentation_faucet_label}
                  fallback={DEFAULT_PRESENTATION_SECTION_LABELS.faucet}
                  editing={editing}
                  onChange={(value) => onPick?.({ presentation_faucet_label: value })}
                />
              }
            >
              <Detail
                product={data.faucet?.product}
                fallbackImage={materialImageUrl(data.faucet)}
                fallbackName={
                  data.faucet?.item_label
                    ? clientProductName(data.faucet, { name: "" })
                    : "Bridge faucet"
                }
                fallbackSub={data.faucet?.product?.vendor || data.faucet?.color}
              />
              {onPick && (
                <PresentationPickSelect
                  value={data.faucet?.item_label ? data.faucet.id : ""}
                  materials={data.materials}
                  onChange={(id) => onPick({ presentation_faucet_item_id: id || null })}
                />
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ImagePickSelect({
  label,
  value,
  options,
  emptyLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: RoomImage[];
  emptyLabel: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="block">
      <div className="eyebrow text-[10px] mb-1">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-border bg-background px-2 py-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
      >
        <option value="">{emptyLabel}</option>
        {options.map((image, index) => (
          <option key={image.id} value={image.id}>
            {image.caption?.trim() || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function PresentationPickSelect({
  value,
  materials,
  onChange,
}: {
  value: string;
  materials: MaterialItem[];
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-2 w-full border border-border bg-background px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground print:hidden"
    >
      <option value="">Default / blank</option>
      {materials.map((m) => (
        <option key={m.id} value={m.id}>
          {clientProductName(m, { name: "" })}
        </option>
      ))}
    </select>
  );
}

function EditableSectionLabel({
  value,
  fallback,
  editing,
  onChange,
}: {
  value?: string | null;
  fallback: string;
  editing: boolean;
  onChange: (value: string | null) => void;
}) {
  const label = value?.trim() || fallback;
  if (!editing) return <>{label}</>;
  return (
    <input
      key={`${fallback}-${value ?? ""}`}
      defaultValue={label}
      onBlur={(event) => onChange(event.target.value.trim() || null)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="w-full border border-border bg-background px-2 py-1 text-[10px] uppercase tracking-[0.28em] text-muted-foreground"
      aria-label={`${fallback} section label`}
    />
  );
}

function Card({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-border p-4 lg:p-5 print:p-3 bg-background">
      <div className="eyebrow text-[10px] mb-3">{label}</div>
      {children}
    </div>
  );
}

function Detail({
  product,
  fallbackName,
  fallbackImage,
  fallbackSub,
}: {
  product?: any;
  fallbackName: string;
  fallbackImage?: string | null;
  fallbackSub?: string | null;
}) {
  const img = product?.image_url || fallbackImage;
  const sub = product?.finish || product?.vendor || fallbackSub;
  return (
    <div className="flex gap-3">
      <div className="w-16 h-16 bg-bone overflow-hidden flex-shrink-0">
        {img && <img src={normalizeSupabaseImageUrl(img)} alt="" className="w-full h-full object-contain p-1" />}
      </div>
      <div className="min-w-0 self-center">
        <div className="font-display text-sm leading-tight">{product?.name || fallbackName}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}
