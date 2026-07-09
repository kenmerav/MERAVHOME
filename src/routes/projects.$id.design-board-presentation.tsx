import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/db";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { canViewProjectSurface } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects/$id/design-board-presentation")({
  head: () => ({ meta: [{ title: "Design Board Presentation — MERAV Studio" }] }),
  component: DesignBoardPresentationPage,
});

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
  label?: string;
  productName?: string | null;
  link?: string;
  hideDetails?: boolean;
  text?: string;
  background?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  letterSpacing?: number;
  visible?: boolean;
  imageBrightness?: number | null;
  imageContrast?: number | null;
  imageSaturation?: number | null;
  imageWarmth?: number | null;
};

type PresentationBoardPage = {
  id: string;
  title: string;
  hidden?: boolean;
  elements: PresentationBoardElement[];
};

type PresentationBoardState = {
  pages: PresentationBoardPage[];
  selectedPageId: string;
};

const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const DEFAULT_BOARD_TEXT_FONT = "var(--font-montserrat)";
const DEFAULT_BOARD_TEXT_COLOR = "#000000";

function DesignBoardPresentationPage() {
  const { id } = Route.useParams();
  const [activeIndex, setActiveIndex] = useState(0);
  const [scale, setScale] = useState(1);

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ["project", id],
    queryFn: () => db.getProject(id),
  });
  const canViewDesignBoards =
    profile?.is_active === true &&
    project != null &&
    canViewProjectSurface(profile, project, "designBoards");
  const { data: sharedBoard, isLoading: loadingBoard } = useQuery({
    queryKey: ["designBoard", id],
    queryFn: () => db.getDesignBoard(id),
    enabled: canViewDesignBoards,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const boardState = useMemo(
    () => normalizeBoardState(sharedBoard?.board_state),
    [sharedBoard?.board_state],
  );
  const pages = useMemo(
    () => boardState.pages.filter((page) => page.hidden !== true),
    [boardState.pages],
  );
  const activePage = pages[Math.min(activeIndex, Math.max(0, pages.length - 1))] ?? null;
  const loading = loadingProfile || loadingProject || loadingBoard;

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, pages.length - 1)));
  }, [pages.length]);

  useEffect(() => {
    const updateScale = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const availableWidth = viewportWidth - 48;
      const availableHeight = viewportHeight - 190;
      setScale(Math.min(1.2, availableWidth / BOARD_WIDTH, availableHeight / BOARD_HEIGHT));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        setActiveIndex((current) => Math.min(current + 1, Math.max(0, pages.length - 1)));
      }
      if (event.key === "ArrowLeft") {
        setActiveIndex((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pages.length]);

  const enterFullScreen = async () => {
    if (typeof document === "undefined" || document.fullscreenElement) return;
    await document.documentElement.requestFullscreen().catch(() => undefined);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f4f0] text-sm text-stone-500">
        Loading design board...
      </div>
    );
  }

  if (!canViewDesignBoards) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f4f0] px-6 text-center">
        <div>
          <div className="eyebrow">Design Board Presentation</div>
          <h1 className="mt-3 font-display text-4xl text-ink">Not available</h1>
          <p className="mt-3 text-sm text-stone-500">
            You do not have access to view this project design board.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f4f0] text-ink">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-white/90 px-5 py-3 print:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/projects/$id/design-boards"
            params={{ id }}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-stone-300 bg-white transition hover:border-ink"
            aria-label="Back to design board"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="eyebrow truncate">{project?.name ?? "Design Board"}</div>
            <h1 className="truncate font-display text-2xl text-ink">
              {activePage?.title ?? "Design Board Presentation"}
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-stone-500 sm:block">
            {pages.length ? `${activeIndex + 1} of ${pages.length}` : "No pages"}
          </div>
          <button
            type="button"
            onClick={enterFullScreen}
            className="inline-flex h-10 w-10 items-center justify-center border border-stone-300 bg-white transition hover:border-ink"
            aria-label="Enter full screen"
            title="Enter full screen"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-6">
          {activePage ? (
            <>
              <button
                type="button"
                onClick={() => setActiveIndex((current) => Math.max(0, current - 1))}
                disabled={activeIndex === 0}
                className="absolute left-4 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-stone-300 bg-white/90 shadow-sm transition hover:border-ink disabled:cursor-not-allowed disabled:opacity-30 md:inline-flex"
                aria-label="Previous design board page"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <div
                className="shrink-0"
                style={{ width: BOARD_WIDTH * scale, height: BOARD_HEIGHT * scale }}
              >
                <div
                  className="relative origin-top-left bg-[#fbfaf7] shadow-[0_30px_90px_rgba(40,34,25,0.18)]"
                  style={{
                    width: BOARD_WIDTH,
                    height: BOARD_HEIGHT,
                    transform: `scale(${scale})`,
                  }}
                >
                  <DesignBoardPagePreview page={activePage} pageNumber={activeIndex + 1} />
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setActiveIndex((current) => Math.min(current + 1, pages.length - 1))
                }
                disabled={activeIndex >= pages.length - 1}
                className="absolute right-4 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-stone-300 bg-white/90 shadow-sm transition hover:border-ink disabled:cursor-not-allowed disabled:opacity-30 md:inline-flex"
                aria-label="Next design board page"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white px-8 py-10 text-center">
              <div className="font-display text-4xl text-ink">No visible design board pages</div>
              <p className="mt-3 text-sm text-stone-500">
                Show a hidden page or add a design board page to present it here.
              </p>
            </div>
          )}
        </div>

        {pages.length > 1 && (
          <footer className="flex shrink-0 gap-2 overflow-x-auto border-t border-stone-200 bg-white/90 px-4 py-3 print:hidden">
            {pages.map((page, pageIndex) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setActiveIndex(pageIndex)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg border bg-white p-1.5 text-left transition",
                  pageIndex === activeIndex
                    ? "border-[#6d4cff] ring-2 ring-[#6d4cff]"
                    : "border-stone-200 hover:border-ink",
                )}
              >
                <DesignBoardThumbnail page={page} pageNumber={pageIndex + 1} />
              </button>
            ))}
          </footer>
        )}
      </main>
    </div>
  );
}

function DesignBoardPagePreview({
  page,
  pageNumber,
}: {
  page: PresentationBoardPage;
  pageNumber: number;
}) {
  const sortedElements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

  if (sortedElements.length === 0) {
    return (
      <div className="absolute inset-8 flex items-center justify-center border border-dashed border-stone-200 text-center text-stone-300">
        <div>
          <div className="font-display text-7xl">{pageNumber}</div>
          <div className="mt-3 max-w-[520px] truncate font-[var(--font-montserrat)] text-xs uppercase tracking-[0.26em] text-stone-400">
            {page.title || `Board ${pageNumber}`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {sortedElements.map((element) => (
        <DesignBoardElementPreview key={element.id} element={element} />
      ))}
    </>
  );
}

function DesignBoardElementPreview({ element }: { element: PresentationBoardElement }) {
  if (element.visible === false) return null;
  const elementLinkHref = externalHref(element.link);

  return (
    <div
      className="absolute select-none"
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.zIndex,
        transform: element.type === "image" ? undefined : `rotate(${element.rotation ?? 0}deg)`,
      }}
    >
      {element.type === "image" && (
        <>
          {element.src ? (
            <OptimizedBoardImage
              src={normalizeSupabaseImageUrl(element.src)}
              alt={element.label ?? ""}
              kind="preview"
              className="h-full w-full object-contain"
              draggable={false}
              loading="eager"
              style={{
                ...imageAdjustmentStyle(element),
                transform: `rotate(${element.rotation ?? 0}deg)`,
              }}
            />
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
                className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap bg-white/90 px-2 py-1 text-center font-[var(--font-montserrat)] text-[12px] uppercase tracking-[0.12em] text-stone-700 underline decoration-stone-400 underline-offset-4 shadow-sm"
              >
                {element.label || element.productName}
              </a>
            ) : (
              <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap bg-white/90 px-2 py-1 text-center font-[var(--font-montserrat)] text-[12px] uppercase tracking-[0.12em] text-stone-700 shadow-sm">
                {element.label || element.productName}
              </div>
            ))}
        </>
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

function DesignBoardThumbnail({
  page,
  pageNumber,
}: {
  page: PresentationBoardPage;
  pageNumber: number;
}) {
  const scale = 0.058;
  const sortedElements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <>
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
                <OptimizedBoardImage
                  src={normalizeSupabaseImageUrl(element.src)}
                  alt=""
                  kind="thumbnail"
                  className="h-full w-full object-contain"
                  draggable={false}
                  loading="lazy"
                  style={imageAdjustmentStyle(element)}
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
      <div className="max-w-[80px] pb-0.5">
        <div className="text-xs font-medium text-ink">{pageNumber}</div>
        <div className="truncate text-[10px] text-stone-500">
          {page.title || `Board ${pageNumber}`}
        </div>
      </div>
    </>
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
}: {
  src: string;
  alt: string;
  kind: "thumbnail" | "preview" | "original";
  className?: string;
  draggable?: boolean;
  loading?: "eager" | "lazy";
  style?: CSSProperties;
}) {
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

function imageVariantUrl(src: string, kind: "thumbnail" | "preview" | "original") {
  const normalizedSrc = normalizeSupabaseImageUrl(src);
  if (kind === "original") return normalizedSrc;
  return normalizedSrc;
}

function imageAdjustmentStyle(element: PresentationBoardElement): CSSProperties | undefined {
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

function normalizeBoardState(value: unknown): PresentationBoardState {
  if (!value || typeof value !== "object") return defaultBoardState();
  const candidate = value as Partial<PresentationBoardState>;
  if (!Array.isArray(candidate.pages) || candidate.pages.length === 0) return defaultBoardState();

  const pages = candidate.pages
    .map((page, pageIndex) => normalizeBoardPage(page, pageIndex))
    .filter((page): page is PresentationBoardPage => Boolean(page));
  if (!pages.length) return defaultBoardState();

  const selectedPageId =
    typeof candidate.selectedPageId === "string" &&
    pages.some((page) => page.id === candidate.selectedPageId)
      ? candidate.selectedPageId
      : pages[0].id;

  return { pages, selectedPageId };
}

function normalizeBoardPage(value: unknown, pageIndex: number): PresentationBoardPage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Partial<PresentationBoardPage>;
  const id = typeof page.id === "string" && page.id ? page.id : crypto.randomUUID();
  const title = typeof page.title === "string" ? page.title : `Design Board ${pageIndex + 1}`;
  const elements = Array.isArray(page.elements)
    ? page.elements
        .map(normalizeBoardElement)
        .filter((element): element is PresentationBoardElement => Boolean(element))
    : [];
  return { id, title, hidden: page.hidden === true, elements };
}

function normalizeBoardElement(value: unknown): PresentationBoardElement | null {
  if (!value || typeof value !== "object") return null;
  const element = value as Partial<PresentationBoardElement>;
  if (element.type !== "image" && element.type !== "text" && element.type !== "shape") {
    return null;
  }
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

function defaultBoardState(): PresentationBoardState {
  return {
    pages: [
      {
        id: "board-1",
        title: "Design Board 1",
        elements: [],
      },
    ],
    selectedPageId: "board-1",
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
