import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cropConstructionPage } from "@/lib/constructionPdfPreview";
import { drawingBoundsSchema, type DrawingBounds } from "@/lib/constructionDrawingViews";
import {
  cropPoint,
  drawCrop,
  moveCrop,
  resizeCrop,
  type CropPoint,
  type CropHandle,
} from "@/lib/constructionCropSelection";

const fullPage = { left: 0, top: 0, right: 1, bottom: 1 };
const handles: { handle: CropHandle; x: number; y: number; label: string }[] = [
  { handle: "nw", x: 0, y: 0, label: "top left" },
  { handle: "n", x: 0.5, y: 0, label: "top" },
  { handle: "ne", x: 1, y: 0, label: "top right" },
  { handle: "e", x: 1, y: 0.5, label: "right" },
  { handle: "se", x: 1, y: 1, label: "bottom right" },
  { handle: "s", x: 0.5, y: 1, label: "bottom" },
  { handle: "sw", x: 0, y: 1, label: "bottom left" },
  { handle: "w", x: 0, y: 0.5, label: "left" },
];
type Gesture = {
  pointerId: number;
  start: CropPoint;
  bounds: DrawingBounds;
  action: "draw" | "move" | CropHandle;
};

export function ConstructionCropSelector({
  canvas,
  bounds,
  page,
  onApply,
  onClose,
}: {
  canvas: HTMLCanvasElement;
  bounds: DrawingBounds;
  page: number;
  onApply: (bounds: DrawingBounds) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(
    drawingBoundsSchema.safeParse(bounds).success ? bounds : fullPage,
  );
  const [mode, setMode] = useState<"draw" | "adjust">("draw");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  useEffect(() => {
    let active = true,
      url = "";
    void cropConstructionPage(canvas, fullPage)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (active) setImage(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setError("Could not open the sheet. Close and try again.");
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [canvas]);
  function point(event: PointerEvent<HTMLDivElement>) {
    return cropPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
  }
  function nextBounds(event: PointerEvent<HTMLDivElement>, current: Gesture) {
    const end = point(event),
      dx = end.x - current.start.x,
      dy = end.y - current.start.y;
    return current.action === "draw"
      ? drawCrop(current.start, end)
      : current.action === "move"
        ? moveCrop(current.bounds, dx, dy)
        : resizeCrop(current.bounds, current.action, dx, dy);
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (!image || gesture.current || event.button !== 0 || !event.isPrimary) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-crop-action]");
    const action =
      mode === "draw" ? "draw" : ((target?.dataset.cropAction || "draw") as Gesture["action"]);
    gesture.current = { pointerId: event.pointerId, start: point(event), bounds: draft, action };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setDragging(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = nextBounds(event, current);
    setDraft(next || current.bounds);
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = cancelled ? null : nextBounds(event, current);
    setDraft(next || current.bounds);
    if (next) setMode("adjust");
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyboard(event: KeyboardEvent, action: "move" | CropHandle) {
    const step = event.shiftKey ? 0.025 : 0.0025;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    setDraft((old) =>
      action === "move" ? moveCrop(old, dx, dy) : resizeCrop(old, action, dx, dy),
    );
  }
  const width = draft.right - draft.left,
    height = draft.bottom - draft.top;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[96vw] max-w-[1400px] max-h-[96dvh] overflow-y-auto p-4 sm:p-6">
        <div className="pr-8">
          <DialogTitle className="font-display text-2xl">
            Select drawing area · Page {page}
          </DialogTitle>
          <DialogDescription className="mt-2">
            Drag a box around the drawing, including its dimensions. Then drag inside to move it or
            use the handles to resize.
          </DialogDescription>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            aria-pressed={mode === "draw"}
            className={`border px-3 py-2 ${mode === "draw" ? "bg-ink text-white" : ""}`}
            onClick={() => setMode("draw")}
          >
            Draw a new box
          </button>
          <button
            type="button"
            aria-pressed={mode === "adjust"}
            className={`border px-3 py-2 ${mode === "adjust" ? "bg-ink text-white" : ""}`}
            onClick={() => setMode("adjust")}
          >
            Move / resize
          </button>
          <button
            type="button"
            className="underline px-3 py-2"
            onClick={() => {
              setDraft(fullPage);
              setMode("draw");
            }}
          >
            Whole page
          </button>
        </div>
        {error ? (
          <p role="alert">{error}</p>
        ) : !image ? (
          <p role="status">Opening full sheet…</p>
        ) : (
          <div className="flex justify-center bg-bone p-3 border">
            <div
              aria-label="Drawing selection surface"
              className="relative touch-none select-none bg-white"
              style={{
                width: `min(100%, ${(65 * canvas.width) / canvas.height}vh)`,
                aspectRatio: `${canvas.width} / ${canvas.height}`,
                cursor: "crosshair",
              }}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={(event) => finish(event)}
              onPointerCancel={(event) => finish(event, true)}
              onLostPointerCapture={(event) => {
                if (gesture.current) finish(event, true);
              }}
            >
              <img
                src={image}
                alt={`Full construction sheet, PDF page ${page}`}
                draggable={false}
                className="w-full h-full block pointer-events-none"
              />
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  fill="rgba(0,0,0,.4)"
                  fillRule="evenodd"
                  d={`M0 0H1V1H0Z M${draft.left} ${draft.top}V${draft.bottom}H${draft.right}V${draft.top}Z`}
                />
              </svg>
              <div
                role="button"
                tabIndex={mode === "adjust" ? 0 : -1}
                aria-label="Move selected drawing area"
                data-crop-action="move"
                onKeyDown={(event) => keyboard(event, "move")}
                className="absolute border-2 border-blue-600 focus:outline-2 focus:outline-blue-800"
                style={{
                  left: `${draft.left * 100}%`,
                  top: `${draft.top * 100}%`,
                  width: `${width * 100}%`,
                  height: `${height * 100}%`,
                  cursor: mode === "adjust" ? "move" : "crosshair",
                }}
              >
                {mode === "adjust" &&
                  handles.map(({ handle, x, y, label }) => (
                    <button
                      key={handle}
                      type="button"
                      aria-label={`Resize selection ${label}`}
                      data-crop-action={handle}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        keyboard(event, handle);
                      }}
                      className="absolute w-5 h-5 bg-white border-2 border-blue-600 rounded-sm -translate-x-1/2 -translate-y-1/2 focus:ring-2 focus:ring-blue-800"
                      style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        cursor: `${handle}-resize`,
                      }}
                    />
                  ))}
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Arrow keys move a focused box or handle. Hold Shift for larger steps. Selecting uses no
            AI credits.
          </p>
          <div className="flex gap-2">
            <button type="button" className="border px-4 py-3 text-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="bg-ink text-white px-4 py-3 text-sm disabled:opacity-40"
              disabled={!image || dragging || !drawingBoundsSchema.safeParse(draft).success}
              onClick={() => onApply(draft)}
            >
              Use selected area
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
