import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  MousePointer2,
  Plus,
  Search,
  Scissors,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
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
  zIndex: number;
  src?: string;
  label?: string;
  text?: string;
  background?: string;
  color?: string;
  fontSize?: number;
  letterSpacing?: number;
  link?: string;
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
};

type DragMode =
  | {
      kind: "move";
      pageId: string;
      id: string;
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
  | null;

const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.25;

function ProjectDesignBoardsPage() {
  const { id } = Route.useParams();
  const boardStripRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const copiedElementRef = useRef<BoardElement | null>(null);
  const undoStackRef = useRef<BoardState[]>([]);
  const hasCustomZoomRef = useRef(false);
  const scrollSelectionRef = useRef<number | null>(null);
  const [boardState, setBoardState] = useState<BoardState>(() => loadBoardState(id));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [boardScale, setBoardScale] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ProductCategory | "All">("All");
  const [removingBackground, setRemovingBackground] = useState(false);

  const { data: project } = useQuery({ queryKey: ["project", id], queryFn: () => db.getProject(id) });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms", id], queryFn: async () => (await db.listRooms(id)) ?? [] });
  const { data: products = [] } = useQuery({
    queryKey: ["catalog", search],
    queryFn: async () => (await db.listCatalog(search)) ?? [],
  });
  const { data: roomImages = [] } = useQuery({
    queryKey: ["projectImages", id],
    queryFn: async () => (await db.listProjectRoomImages(id)) ?? [],
  });

  const pages = boardState.pages.length ? boardState.pages : defaultPages();
  const selectedPageId = pages.some((page) => page.id === boardState.selectedPageId) ? boardState.selectedPageId : pages[0].id;
  const activePage = pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const elements = activePage.elements;
  const selected = elements.find((element) => element.id === selectedId) ?? null;
  const orderedElements = useMemo(() => [...elements].sort((a, b) => a.zIndex - b.zIndex), [elements]);
  const filteredProducts = useMemo(
    () => (category === "All" ? products : products.filter((product) => product.category === category)),
    [category, products],
  );
  const linkedProductCount = elements.filter((element) => element.productId).length;
  const imageElements = elements.filter((element) => element.type === "image");
  const allBoardDetailsHidden = imageElements.length > 0 && imageElements.every((element) => element.hideDetails);

  const pushUndo = useCallback(() => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), cloneBoardState(boardState)];
  }, [boardState]);

  const undoLastChange = useCallback(() => {
    const previous = undoStackRef.current.at(-1);
    if (!previous) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setBoardState(previous);
    setSelectedId(null);
    setDragMode(null);
  }, []);

  const setElementsForPage = (pageId: string, updater: BoardElement[] | ((current: BoardElement[]) => BoardElement[])) => {
    setBoardState((current) => {
      const safePages = current.pages.length ? current.pages : defaultPages();
      const safeSelectedPageId = safePages.some((page) => page.id === current.selectedPageId) ? current.selectedPageId : safePages[0].id;
      return {
        selectedPageId: safeSelectedPageId,
        pages: safePages.map((page) =>
          page.id === pageId
            ? { ...page, elements: typeof updater === "function" ? updater(page.elements) : updater }
            : page,
        ),
      };
    });
  };

  const setElements = (updater: BoardElement[] | ((current: BoardElement[]) => BoardElement[])) => {
    setElementsForPage(selectedPageId, updater);
  };

  useEffect(() => {
    setBoardState(loadBoardState(id));
    setSelectedId(null);
    undoStackRef.current = [];
  }, [id]);

  useEffect(() => {
    window.localStorage.setItem(storageKey(id), JSON.stringify(boardState));
  }, [boardState, id]);

  useEffect(() => {
    const updateScale = () => {
      const width = boardStripRef.current?.clientWidth ?? BOARD_WIDTH;
      if (!hasCustomZoomRef.current) setBoardScale(Math.min(1, Math.max(MIN_ZOOM, (width - 24) / BOARD_WIDTH)));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
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
          if (element.id !== dragMode.id) return element;
          return {
            ...element,
            width: Math.max(40, dragMode.originalWidth + dx),
            height: Math.max(40, dragMode.originalHeight + dy),
          };
        }),
      );
    };
    const onPointerUp = () => setDragMode(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [boardScale, dragMode, selectedPageId]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingText = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isEditingText) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (file) {
        event.preventDefault();
        void addFile(file);
        return;
      }
      const copiedElement = copiedElementRef.current;
      if (!copiedElement) return;
      event.preventDefault();
      pushUndo();
      const copyItem = {
        ...copiedElement,
        id: crypto.randomUUID(),
        x: copiedElement.x + 32,
        y: copiedElement.y + 32,
      };
      setElements((current) => [...current, { ...copyItem, zIndex: nextZIndex(current) }]);
      setSelectedId(copyItem.id);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pushUndo, selectedPageId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingText = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isEditingText) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastChange();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        const copiedElement = copiedElementRef.current;
        if (!copiedElement) return;
        event.preventDefault();
        pushUndo();
        const copyItem = {
          ...copiedElement,
          id: crypto.randomUUID(),
          x: copiedElement.x + 32,
          y: copiedElement.y + 32,
        };
        setElements((current) => [...current, { ...copyItem, zIndex: nextZIndex(current) }]);
        setSelectedId(copyItem.id);
        return;
      }
      if (!selectedId) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && selected) {
        event.preventDefault();
        copiedElementRef.current = selected;
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pushUndo, selected, selectedId, undoLastChange]);

  const updateElement = (elementId: string, patch: Partial<BoardElement>, pageId = selectedPageId) => {
    pushUndo();
    setElementsForPage(pageId, (current) => current.map((element) => (element.id === elementId ? { ...element, ...patch } : element)));
  };

  const toggleBoardDetails = () => {
    const shouldHide = !allBoardDetailsHidden;
    pushUndo();
    setElements((current) =>
      current.map((element) => (element.type === "image" ? { ...element, hideDetails: shouldHide } : element)),
    );
  };

  const addElement = (element: Omit<BoardElement, "id" | "zIndex">, pageId = selectedPageId) => {
    const pageElements = pages.find((page) => page.id === pageId)?.elements ?? elements;
    const next: BoardElement = { ...element, id: crypto.randomUUID(), zIndex: nextZIndex(pageElements) };
    pushUndo();
    setElementsForPage(pageId, (current) => [...current, next]);
    setBoardState((current) => ({ ...current, selectedPageId: pageId }));
    setSelectedId(next.id);
  };

  const addPage = () => {
    const nextPage: BoardPage = { id: crypto.randomUUID(), title: `Board ${pages.length + 1}`, roomId: null, elements: [] };
    pushUndo();
    setBoardState((current) => ({
      selectedPageId: nextPage.id,
      pages: [...(current.pages.length ? current.pages : defaultPages()), nextPage],
    }));
    setSelectedId(null);
  };

  const updateZoom = (zoomPercent: number) => {
    hasCustomZoomRef.current = true;
    setBoardScale(clamp(zoomPercent / 100, MIN_ZOOM, MAX_ZOOM));
  };

  const selectPage = (pageId: string, scrollToPage = true) => {
    setBoardState((current) => ({ ...current, selectedPageId: pageId }));
    setSelectedId(null);
    if (scrollToPage) {
      requestAnimationFrame(() => {
        pageRefs.current[pageId]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      });
    }
  };

  const updateActivePage = (patch: Partial<BoardPage>) => {
    pushUndo();
    setBoardState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === selectedPageId ? { ...page, ...patch } : page)),
    }));
  };

  const addFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const src = await fileToDataUrl(file);
    addElement({ type: "image", src, label: file.name.replace(/\.[^.]+$/, ""), x: 480, y: 250, width: 340, height: 260 });
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const copyItem = { ...selected, id: crypto.randomUUID(), x: selected.x + 32, y: selected.y + 32, zIndex: nextZIndex(elements) };
    pushUndo();
    setElements((current) => [...current, copyItem]);
    setSelectedId(copyItem.id);
  };

  const moveLayer = (direction: "front" | "back") => {
    if (!selected) return;
    const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
    const nextSorted = sorted.filter((element) => element.id !== selected.id);
    if (direction === "front") nextSorted.push(selected);
    else nextSorted.unshift(selected);
    const normalizedZ = new Map(nextSorted.map((element, index) => [element.id, (index + 1) * 10]));
    pushUndo();
    setElements((current) => current.map((element) => ({ ...element, zIndex: normalizedZ.get(element.id) ?? element.zIndex })));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    pushUndo();
    setElements((current) => current.filter((element) => element.id !== selectedId));
    setSelectedId(null);
  };

  const removeSelectedBackground = async () => {
    if (!selected || selected.type !== "image" || !selected.src) return;
    pushUndo();
    setRemovingBackground(true);
    try {
      const source = await imageSourceForCanvas(selected.src);
      const cutout = await removeFlatImageBackground(source);
      updateElement(selected.id, { src: cutout });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not remove background.");
    } finally {
      setRemovingBackground(false);
    }
  };

  const handleBoardDrop = async (event: ReactDragEvent<HTMLDivElement>, pageId = selectedPageId) => {
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
      addElement({
        type: "image",
        src: image.url,
        label: image.caption || "Project image",
        x: x - 160,
        y: y - 115,
        width: 320,
        height: 230,
      }, pageId);
      return;
    }

    const file = Array.from(event.dataTransfer.files ?? []).find((item) => item.type.startsWith("image/"));
    if (file) {
      const src = await fileToDataUrl(file);
      addElement({ type: "image", src, label: file.name.replace(/\.[^.]+$/, ""), x: x - 170, y: y - 130, width: 340, height: 260 }, pageId);
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
        setBoardState((current) => ({ ...current, selectedPageId: closestPageId }));
        setSelectedId(null);
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

  return (
    <AppShell>
      <div className="min-h-screen bg-[#f4f1ec] text-ink">
        <div className="border-b border-stone-200 bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-4 px-5 py-5">
            <div>
              <Link to="/projects/$id" params={{ id }} className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink">
                <ArrowLeft className="h-3.5 w-3.5" /> {project.name}
              </Link>
              <div className="eyebrow">Studio Design Boards</div>
              <h1 className="font-display text-4xl leading-tight">{activePage.title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-stone-600">
                Build the board here so product links, labels, vendor info, pricing, and finish details stay connected instead of being trapped inside a PDF.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToolbarButton onClick={() => addElement({ type: "text", text: "Add text", x: 540, y: 90, width: 300, height: 56, color: "#1f1d1b", fontSize: 30, letterSpacing: 2 })}>
                <Type className="h-4 w-4" /> Text
              </ToolbarButton>
              <ToolbarButton onClick={() => addElement({ type: "shape", x: 280, y: 250, width: 430, height: 160, background: "#dcd9ce" })}>
                <MousePointer2 className="h-4 w-4" /> Color Block
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
              <ToolbarButton onClick={duplicateSelected} disabled={!selected}>
                <Copy className="h-4 w-4" /> Duplicate
              </ToolbarButton>
              <ToolbarButton onClick={() => moveLayer("front")} disabled={!selected}>
                <ArrowUp className="h-4 w-4" /> Front
              </ToolbarButton>
              <ToolbarButton onClick={() => moveLayer("back")} disabled={!selected}>
                <ArrowDown className="h-4 w-4" /> Back
              </ToolbarButton>
              <ToolbarButton onClick={removeSelectedBackground} disabled={!selected || selected.type !== "image" || removingBackground}>
                <Scissors className="h-4 w-4" /> {removingBackground ? "Cutting..." : "Remove BG"}
              </ToolbarButton>
              <ToolbarButton onClick={toggleBoardDetails} disabled={!imageElements.length}>
                {allBoardDetailsHidden ? "Show Text / Links" : "Hide Text / Links"}
              </ToolbarButton>
              <ToolbarButton onClick={removeSelected} disabled={!selected} destructive>
                <Trash2 className="h-4 w-4" /> Delete
              </ToolbarButton>
            </div>
          </div>
        </div>

        <main className="relative mx-auto max-w-[1680px] px-5 py-5 pb-40 pr-16">
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
                        selectPage(page.id, false);
                        if (event.target === event.currentTarget) setSelectedId(null);
                      }}
                    >
                      {pageElements.length === 0 && (
                        <div className="pointer-events-none absolute inset-8 flex items-center justify-center border border-dashed border-stone-200 text-center text-stone-300">
                          <div>
                            <div className="font-display text-4xl">Blank board</div>
                            <div className="mt-2 text-xs uppercase tracking-[0.28em]">Page {pageIndex + 1} · drag products, project images, or uploads here</div>
                          </div>
                        </div>
                      )}

                      {sortedPageElements.map((element) => (
                        <BoardObject
                          key={element.id}
                          element={element}
                          selected={isActivePage && element.id === selectedId}
                          onSelect={() => {
                            selectPage(page.id, false);
                            setSelectedId(element.id);
                          }}
                          onChange={(patch) => updateElement(element.id, patch, page.id)}
                          onStartMove={(event) => {
                            pushUndo();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            selectPage(page.id, false);
                            setSelectedId(element.id);
                            setDragMode({
                              kind: "move",
                              pageId: page.id,
                              id: element.id,
                              startX: event.clientX,
                              startY: event.clientY,
                              originalPositions: { [element.id]: { x: element.x, y: element.y } },
                            });
                          }}
                          onStartResize={(event) => {
                            event.stopPropagation();
                            pushUndo();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            selectPage(page.id, false);
                            setSelectedId(element.id);
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
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-stone-200 bg-[#f6f4f0]/95 shadow-[0_-16px_50px_rgba(40,34,25,0.12)] backdrop-blur print:hidden">
            <div className="flex items-center gap-4 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto pb-1">
                {pages.map((page, index) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => selectPage(page.id)}
                    className={cn(
                      "group shrink-0 rounded-xl border bg-white p-1 text-left shadow-sm transition",
                      page.id === selectedPageId ? "border-[#6d4cff] ring-2 ring-[#6d4cff]" : "border-stone-200 hover:border-ink",
                    )}
                  >
                    <PageThumbnail page={page} pageNumber={index + 1} />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addPage}
                  className="flex h-[82px] w-[130px] shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white text-sm text-ink transition hover:border-ink"
                >
                  <Plus className="h-4 w-4" /> Page
                </button>
              </div>

              <div className="hidden shrink-0 items-center gap-3 md:flex">
                <input
                  type="range"
                  min={Math.round(MIN_ZOOM * 100)}
                  max={Math.round(MAX_ZOOM * 100)}
                  value={Math.round(boardScale * 100)}
                  onChange={(event) => updateZoom(Number(event.target.value))}
                  className="w-44 accent-ink"
                  aria-label="Board zoom"
                />
                <div className="w-12 text-right text-sm font-medium text-stone-600">{Math.round(boardScale * 100)}%</div>
                <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700">Pages</div>
                <div className="w-16 text-sm font-medium text-stone-600">
                  {pages.findIndex((page) => page.id === selectedPageId) + 1} / {pages.length}
                </div>
              </div>
            </div>
          </div>

          <aside className="group fixed right-0 top-0 z-50 flex h-screen translate-x-[360px] transition-transform duration-200 hover:translate-x-0 focus-within:translate-x-0 print:hidden">
            <div className="mt-32 flex h-32 w-12 items-center justify-center rounded-l-xl border border-r-0 border-stone-200 bg-white shadow-sm">
              <div className="-rotate-90 whitespace-nowrap text-xs uppercase tracking-[0.22em] text-stone-500">Board Tools</div>
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
                    <option key={room.id} value={room.id}>{room.name}</option>
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
              </div>

            {selected && (
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
                  <option key={productCategory} value={productCategory}>{productCategory}</option>
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
                        event.dataTransfer.setData("application/x-merav-room-image", JSON.stringify({ url: image.url, caption: image.caption }))
                      }
                      className="cursor-grab rounded-lg border border-stone-200 bg-[#faf9f5] p-2 active:cursor-grabbing"
                    >
                      <div className="flex aspect-square items-center justify-center overflow-hidden bg-white">
                        <img src={image.url} alt={image.caption ?? ""} className="max-h-full max-w-full object-contain" />
                      </div>
                      <div className="mt-1 truncate text-[11px] text-stone-500">{image.caption || image.kind}</div>
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
  const scale = 0.075;
  const sortedElements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="flex items-end gap-2">
      <div className="relative h-[68px] w-[106px] overflow-hidden rounded-lg border border-stone-100 bg-[#fbfaf7]">
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
              {element.type === "image" && element.src && <img src={element.src} alt="" className="h-full w-full object-contain" draggable={false} />}
              {element.type === "shape" && <div className="h-full w-full" style={{ background: element.background ?? "#dcd9ce" }} />}
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
      <div className="max-w-[72px] pb-1">
        <div className="text-sm font-medium text-ink">{pageNumber}</div>
        <div className="truncate text-[11px] text-stone-500">{page.title || `Board ${pageNumber}`}</div>
      </div>
    </div>
  );
}

function BoardObject({
  element,
  selected,
  onSelect,
  onChange,
  onStartMove,
  onStartResize,
}: {
  element: BoardElement;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<BoardElement>) => void;
  onStartMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className={cn("absolute select-none", selected && "outline outline-2 outline-offset-2 outline-[#1f4e5f]", element.type !== "text" && "cursor-move")}
      style={{ left: element.x, top: element.y, width: element.width, height: element.height, zIndex: element.zIndex }}
      onPointerDown={onStartMove}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {element.type === "image" && element.src && (
        <>
          <img src={element.src} alt={element.label ?? ""} className="h-full w-full object-contain" draggable={false} />
          {!element.hideDetails && (element.label || element.productName) && (
            element.link ? (
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
            )
          )}
          {!element.hideDetails && element.productId && (
            <div className="pointer-events-none absolute left-1 top-1 rounded-full bg-[#1f4e5f] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white shadow-sm">
              Product
            </div>
          )}
        </>
      )}
      {element.type === "shape" && <div className="h-full w-full" style={{ background: element.background ?? "#dcd9ce" }} />}
      {element.type === "text" && (
        <>
          {selected && (
            <div
              onPointerDown={(event) => {
                event.stopPropagation();
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
              onSelect();
            }}
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
      {selected && (
        <button
          type="button"
          aria-label="Resize selected item"
          onPointerDown={onStartResize}
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
  const linkedProduct = selected.productId ? products.find((product) => product.id === selected.productId) : null;

  return (
    <div className="border-t border-stone-200 pt-4">
      <div className="eyebrow mb-3">Selected Item</div>
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
            <Scissors className="h-4 w-4" /> {removingBackground ? "Removing background..." : "Remove Background"}
          </button>
          <p className="text-xs leading-relaxed text-stone-500">
            Best for product images on white or solid backgrounds. Messy lifestyle photos may still need manual cleanup later.
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
            {allBoardDetailsHidden ? "Show All Text / Links on Board" : "Hide All Text / Links on Board"}
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
          {linkedProduct && (
            <div className="rounded-lg border border-stone-200 bg-[#faf9f5] p-3 text-sm text-stone-600">
              <div className="eyebrow mb-2">Connected Catalog Product</div>
              <div className="font-medium text-ink">{linkedProduct.name}</div>
              {linkedProduct.vendor && <div>{linkedProduct.vendor}</div>}
              {linkedProduct.finish && <div>Finish: {linkedProduct.finish}</div>}
              {linkedProduct.price && <div>Client price: {linkedProduct.price}</div>}
              {linkedProduct.product_url && (
                <a href={linkedProduct.product_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs underline">
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
      onDragStart={(event) => event.dataTransfer.setData("application/x-merav-product", JSON.stringify(product))}
      className="group cursor-grab rounded-lg border border-stone-200 bg-[#faf9f5] p-3 active:cursor-grabbing"
    >
      <div className="flex gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden bg-white">
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="max-h-full max-w-full object-contain transition group-hover:scale-105" />
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
        destructive ? "border-red-200 bg-white text-red-700 hover:border-red-400" : "border-stone-300 bg-white text-ink hover:border-ink",
      )}
    >
      {children}
    </button>
  );
}

function productToBoardElement(product: Product, x: number, y: number): Omit<BoardElement, "id" | "zIndex"> {
  return {
    type: "image",
    src: product.image_url || productPlaceholderDataUrl(product.name),
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

function productPlaceholderDataUrl(name: string) {
  const safeName = name.replace(/[<>&]/g, "").slice(0, 80);
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 420">
      <rect width="520" height="420" fill="#f4f1ec"/>
      <rect x="36" y="36" width="448" height="348" fill="#fbfaf7" stroke="#d9d3c8"/>
      <text x="260" y="198" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="#302a24">${safeName}</text>
      <text x="260" y="238" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" letter-spacing="6" fill="#9b9389">PRODUCT IMAGE</text>
    </svg>
  `.replace(/\s+/g, " ").trim())}`;
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

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = src;
  });
}

async function removeFlatImageBackground(src: string) {
  const image = await loadCanvasImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not edit image.");

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  removeFlatBackgroundPixels(imageData.data, canvas.width, canvas.height);
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function removeFlatBackgroundPixels(data: Uint8ClampedArray, width: number, height: number, tolerance = 44) {
  const background = averageCornerColor(data, width, height);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixel = y * width + x;
    if (visited[pixel]) return;
    const index = pixel * 4;
    if (data[index + 3] === 0) return;
    if (colorDistance(data, index, background) > tolerance) return;
    visited[pixel] = 1;
    queue.push(pixel);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queue.length) {
    const pixel = queue.shift()!;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const index = pixel * 4;
    const distance = colorDistance(data, index, background);
    data[index + 3] = Math.max(0, Math.round(((tolerance - distance) / tolerance) * 40));

    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }
}

function averageCornerColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const sampleSize = Math.max(4, Math.round(Math.min(width, height) * 0.025));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const corners = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize],
  ];

  for (const [startX, startY] of corners) {
    for (let y = startY; y < Math.min(height, startY + sampleSize); y += 1) {
      for (let x = startX; x < Math.min(width, startX + sampleSize); x += 1) {
        const index = (y * width + x) * 4;
        r += data[index];
        g += data[index + 1];
        b += data[index + 2];
        count += 1;
      }
    }
  }

  return [r / count, g / count, b / count];
}

function colorDistance(data: Uint8ClampedArray, index: number, color: [number, number, number]) {
  const dr = data[index] - color[0];
  const dg = data[index + 1] - color[1];
  const db = data[index + 2] - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function loadBoardState(projectId: string): BoardState {
  if (typeof window === "undefined") return defaultBoardState();
  const stored = window.localStorage.getItem(storageKey(projectId));
  if (!stored) return defaultBoardState();

  try {
    const parsed = JSON.parse(stored) as BoardState;
    if (Array.isArray(parsed.pages) && parsed.pages.length) {
      const selectedPageId = parsed.pages.some((page) => page.id === parsed.selectedPageId) ? parsed.selectedPageId : parsed.pages[0].id;
      return { pages: parsed.pages, selectedPageId };
    }
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
