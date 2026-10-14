import { drawingCropPixels, type DrawingBounds } from "./constructionDrawingViews";

// Original PDF, one selected page at a time. No storage transformations.
export async function openConstructionPdf(url: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ url, isEvalSupported: false }).promise;
}
export async function previewConstructionPage(
  pdf: Awaited<ReturnType<typeof openConstructionPdf>>,
  number: number,
) {
  const page = await pdf.getPage(number),
    native = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 3200 / Math.max(native.width, native.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d")!;
  await page.render({ canvas, canvasContext: context, viewport }).promise;
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
