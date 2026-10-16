import { drawingCropPixels, type DrawingBounds } from "./constructionDrawingViews";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { drawingTextRuns, type DrawingTextRun } from "./specDrawingHighlights";

// Original PDF, one selected page at a time. No storage transformations.
export async function openConstructionPdf(url: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfjs.getDocument({ url, isEvalSupported: false }).promise;
}
const drawingTextCache = new WeakMap<
  Awaited<ReturnType<typeof openConstructionPdf>>,
  Map<number, Promise<DrawingTextRun[]>>
>();
export function constructionPageText(
  pdf: Awaited<ReturnType<typeof openConstructionPdf>>,
  number: number,
) {
  let cache = drawingTextCache.get(pdf);
  if (!cache) {
    cache = new Map();
    drawingTextCache.set(pdf, cache);
  }
  let reading = cache.get(number);
  if (!reading) {
    reading = (async () => {
      const page = await pdf.getPage(number);
      const text = await page.getTextContent();
      return drawingTextRuns(text.items, page.getViewport({ scale: 1 }));
    })();
    cache.set(number, reading);
    void reading.catch(() => cache!.delete(number));
  }
  return reading;
}
export async function previewConstructionPage(
  pdf: Awaited<ReturnType<typeof openConstructionPdf>>,
  number: number,
  signal?: AbortSignal,
  maxEdge = 3200,
) {
  const page = await pdf.getPage(number),
    native = page.getViewport({ scale: 1 });
  const scale = Math.min(
    3,
    Math.max(320, Math.min(maxEdge, 3200)) / Math.max(native.width, native.height),
  );
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d")!;
  signal?.throwIfAborted();
  const task = page.render({ canvas, canvasContext: context, viewport });
  const cancel = () => task.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
  return canvas;
}
export async function cropConstructionPage(canvas: HTMLCanvasElement, bounds: DrawingBounds) {
  const box = drawingCropPixels(bounds, canvas.width, canvas.height);
  const crop = document.createElement("canvas");
  crop.width = box.width;
  crop.height = box.height;
  crop
    .getContext("2d")!
    .drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    crop.toBlob(
      (b) => (b ? resolve(b) : reject(Error("Could not crop the drawing."))),
      "image/png",
    ),
  );
  return blob;
}
