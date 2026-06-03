import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  MousePointer2,
  Plus,
  RotateCcw,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/prototype/design-board")({
  head: () => ({ meta: [{ title: "Design Board Prototype — MERAV Studio" }] }),
  component: DesignBoardPrototype,
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
  attachedToId?: string | null;
};

type BoardPage = {
  id: string;
  title: string;
  elements: BoardElement[];
};

type BoardState = {
  pages: BoardPage[];
  selectedPageId: string;
};

type DragMode =
  | {
      kind: "move";
      id: string;
      startX: number;
      startY: number;
      originalPositions: Record<string, { x: number; y: number }>;
    }
  | { kind: "resize"; id: string; startX: number; startY: number; originalWidth: number; originalHeight: number }
  | null;

const STORAGE_KEY = "merav-design-board-prototype-v1";
const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;

const sampleProducts = [
  {
    label: "Brass Mirror",
    src: svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 380">
        <rect width="320" height="380" fill="transparent"/>
        <path d="M70 340V130C70 72 108 36 160 36s90 36 90 94v210z" fill="#f7f7f4" stroke="#b68a39" stroke-width="12"/>
        <path d="M89 321V135c0-46 29-77 71-77s71 31 71 77v186z" fill="#f4f4f1" stroke="#d7d2c8" stroke-width="4"/>
      </svg>
    `),
  },
  {
    label: "Sconce",
    src: svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 360">
        <rect width="180" height="360" fill="transparent"/>
        <circle cx="90" cy="58" r="42" fill="#c49a49"/>
        <rect x="59" y="70" width="62" height="215" rx="31" fill="#f6dfd6"/>
        <rect x="63" y="72" width="54" height="48" rx="26" fill="#d6a84f"/>
      </svg>
    `),
  },
  {
    label: "Shower Fixture",
    src: svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 360">
        <rect width="420" height="360" fill="transparent"/>
        <g fill="none" stroke="#b68a39" stroke-width="15" stroke-linecap="round">
          <path d="M76 255V90c0-26 20-46 46-46h164c31 0 58 22 63 53"/>
          <path d="M350 97c25 0 45 20 45 45"/>
          <path d="M76 255h70"/>
          <path d="M235 44v195"/>
        </g>
        <circle cx="76" cy="255" r="28" fill="#c49a49"/>
        <circle cx="235" cy="239" r="32" fill="#c49a49"/>
        <path d="M306 135c42-18 72-13 89 7" fill="none" stroke="#b68a39" stroke-width="16" stroke-linecap="round"/>
      </svg>
    `),
  },
  {
    label: "Faucet",
    src: svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 220">
        <rect width="420" height="220" fill="transparent"/>
        <g fill="none" stroke="#b68a39" stroke-width="18" stroke-linecap="round">
          <path d="M82 160c55-5 76-52 121-71 48-20 89 4 96 49"/>
          <path d="M113 151H50"/>
          <path d="M300 138h70"/>
        </g>
        <circle cx="49" cy="160" r="31" fill="#c49a49"/>
        <circle cx="370" cy="138" r="27" fill="#c49a49"/>
      </svg>
    `),
  },
  {
    label: "Tile",
    src: svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 280">
        <rect width="520" height="280" fill="#f2eee7"/>
        <g stroke="#d8d0c2" stroke-width="3">
          ${Array.from({ length: 5 }, (_, y) =>
            Array.from({ length: 9 }, (_, x) => `<rect x="${x * 60 - (y % 2 ? 30 : 0)}" y="${y * 56}" width="60" height="56" rx="7" fill="#f8f6f1"/>`).join(""),
          ).join("")}
        </g>
      </svg>
    `),
  },
  {
    label: "Mosaic",
    src: svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 280">
        <rect width="360" height="280" fill="#f6f2ea"/>
        <g fill="#fbfaf6" stroke="#d7d0c4" stroke-width="3">
          ${Array.from({ length: 7 }, (_, y) =>
            Array.from({ length: 10 }, (_, x) => `<circle cx="${x * 38 + 18 + (y % 2 ? 18 : 0)}" cy="${y * 38 + 22}" r="17"/>`).join(""),
          ).join("")}
        </g>
      </svg>
    `),
  },
  {
    label: "Tub",
    src: svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220">
        <rect width="600" height="220" fill="transparent"/>
        <path d="M60 70h480c22 0 40 18 40 40v21c0 36-29 65-65 65H85c-36 0-65-29-65-65v-21c0-22 18-40 40-40Z" fill="#fbfbf8" stroke="#d7d4cc" stroke-width="8"/>
        <path d="M62 104h476" stroke="#ebe8df" stroke-width="12"/>
      </svg>
    `),
  },
  {
    label: "Knob",
    src: svgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220">
        <rect width="220" height="220" fill="transparent"/>
        <circle cx="110" cy="110" r="72" fill="#c49a49"/>
        <circle cx="86" cy="76" r="28" fill="#e3c777" opacity=".55"/>
        <circle cx="110" cy="110" r="88" fill="none" stroke="#a77a2d" stroke-width="7"/>
      </svg>
    `),
  },
];

function DesignBoardPrototype() {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [boardState, setBoardState] = useState<BoardState>(() => loadBoardState());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [boardScale, setBoardScale] = useState(1);
  const pages = boardState.pages.length ? boardState.pages : defaultPages();
  const selectedPageId = pages.some((page) => page.id === boardState.selectedPageId) ? boardState.selectedPageId : pages[0].id;
  const activePage = pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const elements = activePage.elements;
  const selected = elements.find((element) => element.id === selectedId) ?? null;

  const setElements = (updater: BoardElement[] | ((current: BoardElement[]) => BoardElement[])) => {
    setBoardState((current) => {
      const safePages = current.pages.length ? current.pages : defaultPages();
      const safeSelectedPageId = safePages.some((page) => page.id === current.selectedPageId) ? current.selectedPageId : safePages[0].id;

      return {
        selectedPageId: safeSelectedPageId,
        pages: safePages.map((page) =>
          page.id === safeSelectedPageId
            ? { ...page, elements: typeof updater === "function" ? updater(page.elements) : updater }
            : page,
        ),
      };
    });
  };

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boardState));
  }, [boardState]);

  useEffect(() => {
    const updateScale = () => {
      const width = boardRef.current?.parentElement?.clientWidth ?? BOARD_WIDTH;
      setBoardScale(Math.min(1, Math.max(0.45, (width - 24) / BOARD_WIDTH)));
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
      setElements((current) =>
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
  }, [boardScale, dragMode]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (file) void addFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingText =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isEditingText || !selectedId) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        setElements((current) => current.filter((element) => element.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  const orderedElements = useMemo(() => [...elements].sort((a, b) => a.zIndex - b.zIndex), [elements]);

  const updateElement = (id: string, patch: Partial<BoardElement>) => {
    setElements((current) => current.map((element) => (element.id === id ? { ...element, ...patch } : element)));
  };

  const addElement = (element: Omit<BoardElement, "id" | "zIndex">) => {
    const next: BoardElement = { ...element, id: crypto.randomUUID(), zIndex: nextZIndex(elements) };
    setElements((current) => [...current, next]);
    setSelectedId(next.id);
  };

  const addPage = () => {
    const pageTitle = `Page ${pages.length + 1}`;
    const nextPage = blankPage(pageTitle);
    setBoardState((current) => ({
      selectedPageId: nextPage.id,
      pages: [...(current.pages.length ? current.pages : defaultPages()), nextPage],
    }));
    setSelectedId(null);
  };

  const selectPage = (pageId: string) => {
    setBoardState((current) => ({ ...current, selectedPageId: pageId }));
    setSelectedId(null);
  };

  const addFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const src = await fileToDataUrl(file);
    addElement({ type: "image", src, x: 470, y: 240, width: 360, height: 260 });
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const copyItem = {
      ...selected,
      id: crypto.randomUUID(),
      x: selected.x + 32,
      y: selected.y + 32,
      zIndex: nextZIndex(elements),
    };
    setElements((current) => [...current, copyItem]);
    setSelectedId(copyItem.id);
  };

  const moveLayer = (direction: "up" | "down") => {
    if (!selected) return;
    const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
    const index = sorted.findIndex((element) => element.id === selected.id);
    const nextSorted = [...sorted];
    const [picked] = nextSorted.splice(index, 1);
    if (!picked) return;
    if (direction === "up") {
      nextSorted.push(picked);
    } else {
      nextSorted.unshift(picked);
    }
    const normalizedZ = new Map(nextSorted.map((element, nextIndex) => [element.id, (nextIndex + 1) * 10]));
    setElements((current) => current.map((element) => ({ ...element, zIndex: normalizedZ.get(element.id) ?? element.zIndex })));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setElements((current) => current.filter((element) => element.id !== selectedId));
    setSelectedId(null);
  };

  const resetDemo = () => {
    const next = defaultElements();
    setElements(next);
    setSelectedId(null);
  };

  const handleBoardDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const productSrc = event.dataTransfer.getData("application/x-merav-product");
    const rect = boardRef.current?.getBoundingClientRect();
    const x = rect ? (event.clientX - rect.left) / boardScale : 500;
    const y = rect ? (event.clientY - rect.top) / boardScale : 260;
    if (productSrc) {
      addElement({ type: "image", src: productSrc, x: x - 120, y: y - 100, width: 240, height: 200 });
      return;
    }
    const file = Array.from(event.dataTransfer.files ?? []).find((item) => item.type.startsWith("image/"));
    if (file) await addFile(file);
  };

  return (
    <div className="min-h-screen bg-[#f4f1ec] text-ink">
      <div className="border-b border-stone-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <div className="eyebrow">Local Prototype</div>
            <h1 className="font-display text-3xl leading-tight">MERAV Design Board Builder</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={() => addElement({ type: "text", text: "Add text", x: 560, y: 90, width: 280, height: 54, color: "#1f1d1b", fontSize: 30, letterSpacing: 2 })}>
              <Type className="h-4 w-4" /> Text
            </ToolbarButton>
            <ToolbarButton onClick={addPage}>
              <Plus className="h-4 w-4" /> New Page
            </ToolbarButton>
            <ToolbarButton onClick={() => addElement({ type: "shape", x: 300, y: 250, width: 420, height: 160, background: "#dcd9ce" })}>
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
            <ToolbarButton onClick={duplicateSelected} disabled={!selected}>
              <Copy className="h-4 w-4" /> Duplicate
            </ToolbarButton>
            <ToolbarButton onClick={() => moveLayer("up")} disabled={!selected}>
              <ArrowUp className="h-4 w-4" /> Forward
            </ToolbarButton>
            <ToolbarButton onClick={() => moveLayer("down")} disabled={!selected}>
              <ArrowDown className="h-4 w-4" /> Back
            </ToolbarButton>
            <ToolbarButton onClick={removeSelected} disabled={!selected} destructive>
              <Trash2 className="h-4 w-4" /> Delete
            </ToolbarButton>
            <ToolbarButton onClick={resetDemo}>
              <RotateCcw className="h-4 w-4" /> Reset demo
            </ToolbarButton>
          </div>
        </div>
      </div>

      <div className="border-b border-stone-200 bg-[#f8f6f1]">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-2 px-5 py-3">
          <div className="mr-2 text-xs uppercase tracking-[0.22em] text-stone-500">Pages</div>
          {pages.map((page, index) => (
            <button
              key={page.id}
              type="button"
              onClick={() => selectPage(page.id)}
              className={cn(
                "border px-4 py-2 text-sm transition",
                page.id === selectedPageId
                  ? "border-ink bg-ink text-white"
                  : "border-stone-300 bg-white text-stone-700 hover:border-ink",
              )}
            >
              {page.title || `Page ${index + 1}`}
            </button>
          ))}
          <button
            type="button"
            onClick={addPage}
            className="inline-flex items-center gap-2 border border-stone-300 bg-white px-4 py-2 text-sm text-ink transition hover:border-ink"
          >
            <Plus className="h-4 w-4" /> Add New Page
          </button>
        </div>
      </div>

      <main className="mx-auto grid max-w-[1680px] grid-cols-1 gap-5 px-5 py-5 xl:grid-cols-[1fr_320px]">
        <section className="overflow-auto rounded-xl border border-stone-200 bg-white/70 p-3 shadow-sm">
          <div
            ref={boardRef}
            className="relative mx-auto origin-top-left overflow-hidden bg-[#f8f7f3] shadow-[0_24px_80px_rgba(40,34,25,0.13)]"
            style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT, transform: `scale(${boardScale})`, marginBottom: BOARD_HEIGHT * (boardScale - 1) }}
            onDrop={handleBoardDrop}
            onDragOver={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setSelectedId(null);
            }}
          >
            <div className="absolute left-16 top-[310px] h-[240px] w-[780px] bg-[#dedbd0]" />
            <div className="absolute left-[320px] top-[365px] h-[235px] w-[500px] bg-[linear-gradient(135deg,#f9f8f3,#e6e1d8_42%,#f9f8f3)] opacity-80" />
            <div className="absolute right-[160px] top-[405px] h-[260px] w-[420px] bg-[#e3ded4]" />
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 text-center pointer-events-none">
              <div className="font-display text-[58px] uppercase leading-none tracking-[-0.07em]">MERAV INTERIORS</div>
              <div className="mt-2 text-[13px] uppercase tracking-[0.42em] text-[#aaa49d]">By Katie Roberts</div>
            </div>

            {orderedElements.map((element) => (
              <BoardObject
                key={element.id}
                element={element}
                selected={element.id === selectedId}
                onSelect={() => setSelectedId(element.id)}
                onChange={(patch) => updateElement(element.id, patch)}
                onStartMove={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedId(element.id);
                  const movingIds = new Set([
                    element.id,
                    ...elements.filter((candidate) => candidate.attachedToId === element.id).map((candidate) => candidate.id),
                  ]);
                  setDragMode({
                    kind: "move",
                    id: element.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originalPositions: Object.fromEntries(
                      elements
                        .filter((candidate) => movingIds.has(candidate.id))
                        .map((candidate) => [candidate.id, { x: candidate.x, y: candidate.y }]),
                    ),
                  });
                }}
                onStartResize={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedId(element.id);
                  setDragMode({
                    kind: "resize",
                    id: element.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originalWidth: element.width,
                    originalHeight: element.height,
                  });
                }}
              />
            ))}

            <div className="pointer-events-none absolute left-20 right-20 top-[66px] z-[1] h-px bg-stone-300" />
          </div>
        </section>

        <aside className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div>
            <div className="eyebrow">Quick Instructions</div>
            <div className="mt-3 space-y-2 text-sm leading-6 text-stone-600">
              <p>Drag sample products onto the board, upload/drop images, or paste a screenshot with Cmd+V.</p>
              <p>Click an item to move, resize, duplicate, layer, delete, or edit text/link.</p>
            </div>
          </div>

          <div className="border-t border-stone-200 pt-4">
            <div className="eyebrow mb-3">Sample Product Tray</div>
            <div className="grid grid-cols-2 gap-3">
              {sampleProducts.map((product) => (
                <div
                  key={product.label}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData("application/x-merav-product", product.src)}
                  className="group cursor-grab rounded-lg border border-stone-200 bg-[#faf9f5] p-3 active:cursor-grabbing"
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden bg-white">
                    <img src={product.src} alt={product.label} className="max-h-full max-w-full object-contain transition group-hover:scale-105" />
                  </div>
                  <div className="mt-2 text-xs text-stone-600">{product.label}</div>
                </div>
              ))}
            </div>
          </div>

          {selected && (
            <div className="border-t border-stone-200 pt-4">
              <div className="eyebrow mb-3">Selected Item</div>
              {selected.type === "text" && (
                <div className="space-y-3">
                  <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                    Text
                    <textarea
                      value={selected.text ?? ""}
                      onChange={(event) => updateElement(selected.id, { text: event.target.value })}
                      className="mt-1 min-h-20 w-full resize-y border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
                    />
                  </label>
                  <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                    Font size
                    <input
                      type="number"
                      value={selected.fontSize ?? 24}
                      onChange={(event) => updateElement(selected.id, { fontSize: Number(event.target.value) || 24 })}
                      className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
                    />
                  </label>
                  <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                    Attach to Image
                    <select
                      value={selected.attachedToId ?? ""}
                      onChange={(event) => updateElement(selected.id, { attachedToId: event.target.value || null })}
                      className="mt-1 w-full border border-stone-200 bg-white px-3 py-2 text-sm normal-case tracking-normal"
                    >
                      <option value="">No attachment</option>
                      {elements
                        .filter((element) => element.type === "image")
                        .map((element, index) => (
                          <option key={element.id} value={element.id}>
                            {imageAttachmentName(element, index)}
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
                    onChange={(event) => updateElement(selected.id, { background: event.target.value })}
                    className="mt-1 h-10 w-full border border-stone-200 bg-white"
                  />
                </label>
              )}
              {selected.type === "image" && (
                <label className="block text-xs uppercase tracking-[0.18em] text-stone-500">
                  Image Label
                  <input
                    value={selected.label ?? ""}
                    onChange={(event) => updateElement(selected.id, { label: event.target.value })}
                    placeholder="Primary bath mirror"
                    className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
                  />
                </label>
              )}
              <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-stone-500">
                Link
                <input
                  value={selected.link ?? ""}
                  onChange={(event) => updateElement(selected.id, { link: event.target.value })}
                  placeholder="https://..."
                  className="mt-1 w-full border border-stone-200 px-3 py-2 text-sm normal-case tracking-normal"
                />
              </label>
              {selected.link && (
                <a
                  href={selected.link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex text-xs text-stone-500 underline underline-offset-4 hover:text-ink"
                >
                  Open link
                </a>
              )}
            </div>
          )}
        </aside>
      </main>
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
  onStartMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onStartResize: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={cn(
        "absolute select-none",
        selected && "outline outline-2 outline-offset-2 outline-[#1f4e5f]",
        element.type !== "text" && "cursor-move",
      )}
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.zIndex,
      }}
      onPointerDown={onStartMove}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {element.type === "image" && element.src && (
        <>
          <img src={element.src} alt={element.label ?? ""} className="h-full w-full object-contain" draggable={false} />
          {element.label && (
            <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap bg-white/85 px-2 py-1 text-center font-[var(--font-montserrat)] text-[12px] uppercase tracking-[0.12em] text-stone-700 shadow-sm">
              {element.label}
            </div>
          )}
          {element.link && (
            <div className="pointer-events-none absolute right-1 top-1 rounded-full bg-white/90 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-500 shadow-sm">
              Link
            </div>
          )}
          {selected && (
            <div className="pointer-events-none absolute left-1 top-1 rounded-full bg-[#1f4e5f] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-white shadow-sm">
              {element.label || "Selected image"}
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
          {element.attachedToId && (
            <div className="pointer-events-none absolute -right-2 -top-2 z-10 rounded-full bg-[#1f4e5f] px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-white">
              Attached
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

function ToolbarButton({
  children,
  onClick,
  disabled,
  destructive,
}: {
  children: React.ReactNode;
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

function imageAttachmentName(element: BoardElement, index: number) {
  if (element.label?.trim()) return element.label.trim();
  if (element.id.includes("mirror")) return "Mirror";
  if (element.id.includes("sconce")) return "Sconce";
  if (element.id.includes("shower")) return "Shower fixture";
  if (element.id.includes("faucet")) return "Faucet";
  if (element.id.includes("tile")) return "Tile";
  if (element.id.includes("mosaic")) return "Mosaic";
  if (element.id.includes("tub")) return "Tub";
  if (element.id.includes("knob")) return "Knob";
  return `Image ${index + 1}`;
}

function loadBoardState(): BoardState {
  if (typeof window === "undefined") return defaultBoardState();
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return defaultBoardState();

  try {
    const parsed = JSON.parse(stored) as BoardState | BoardElement[];

    if (Array.isArray(parsed)) {
      return {
        selectedPageId: "page-1",
        pages: [{ id: "page-1", title: "Page 1", elements: parsed.length ? parsed : defaultElements() }],
      };
    }

    if (Array.isArray(parsed.pages) && parsed.pages.length) {
      const selectedPageId = parsed.pages.some((page) => page.id === parsed.selectedPageId)
        ? parsed.selectedPageId
        : parsed.pages[0].id;
      return { pages: parsed.pages, selectedPageId };
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  return defaultBoardState();
}

function defaultBoardState(): BoardState {
  const pages = defaultPages();
  return { pages, selectedPageId: pages[0].id };
}

function defaultPages(): BoardPage[] {
  return [{ id: "page-1", title: "Page 1", elements: defaultElements() }];
}

function blankPage(title: string): BoardPage {
  return { id: crypto.randomUUID(), title, elements: [] };
}

function defaultElements(): BoardElement[] {
  return [
    {
      id: "mirror",
      type: "image",
      src: sampleProducts[0].src,
      x: 115,
      y: 90,
      width: 360,
      height: 340,
      zIndex: 6,
    },
    {
      id: "sconce-1",
      type: "image",
      src: sampleProducts[1].src,
      x: 520,
      y: 120,
      width: 115,
      height: 300,
      zIndex: 9,
    },
    {
      id: "sconce-2",
      type: "image",
      src: sampleProducts[1].src,
      x: 650,
      y: 120,
      width: 115,
      height: 300,
      zIndex: 9,
    },
    {
      id: "tile",
      type: "image",
      src: sampleProducts[4].src,
      x: 820,
      y: 365,
      width: 430,
      height: 230,
      zIndex: 4,
    },
    {
      id: "shower",
      type: "image",
      src: sampleProducts[2].src,
      x: 965,
      y: 145,
      width: 330,
      height: 330,
      zIndex: 10,
    },
    {
      id: "faucet",
      type: "image",
      src: sampleProducts[3].src,
      x: 170,
      y: 430,
      width: 370,
      height: 180,
      zIndex: 11,
    },
    {
      id: "tub",
      type: "image",
      src: sampleProducts[6].src,
      x: 515,
      y: 585,
      width: 560,
      height: 190,
      zIndex: 12,
    },
    {
      id: "mosaic",
      type: "image",
      src: sampleProducts[5].src,
      x: 1105,
      y: 550,
      width: 250,
      height: 210,
      zIndex: 7,
    },
    {
      id: "title",
      type: "text",
      text: "Primary Bathroom Design Board Option One",
      x: 385,
      y: 34,
      width: 640,
      height: 42,
      zIndex: 20,
      color: "#1f1d1b",
      fontSize: 28,
      letterSpacing: 3,
    },
  ];
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
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
