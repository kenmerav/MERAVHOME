import { createWorker, PSM } from "tesseract.js";
import workerPath from "tesseract.js/dist/worker.min.js?url";
import { printedAreaFromText, type PrintedPageAreas } from "./constructionPageAreas";
import type { openConstructionPdf } from "./constructionPdfPreview";

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

// Pixels stay in the browser. The worker downloads only public OCR code and
// its English dictionary; no drawing is uploaded to an OCR/AI provider.
export async function readConstructionPageAreas(
  pdf: Awaited<ReturnType<typeof openConstructionPdf>>,
  progress: (page: number, total: number) => void,
  signal: AbortSignal,
): Promise<PrintedPageAreas> {
  const worker = await createWorker("eng", 1, {
    workerPath,
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
  });
  let termination: Promise<unknown> | undefined;
  const terminate = () => (termination ||= worker.terminate().catch(() => undefined));
  const stop = () => {
    void terminate();
  };
  signal.addEventListener("abort", stop, { once: true });
  const labels: PrintedPageAreas["labels"] = [];
  try {
    signal.throwIfAborted();
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: "150" });
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1.5 });
      // Title blocks normally run down the right edge of landscape sheets,
      // or along the bottom of portrait sheets. Keep the AREA and SCALE rows.
      const landscape = viewport.width >= viewport.height;
      const box = landscape
        ? {
            x: viewport.width * 0.85,
            y: viewport.height * 0.48,
            width: viewport.width * 0.15,
            height: viewport.height * 0.52,
          }
        : {
            x: 0,
            y: viewport.height * 0.72,
            width: viewport.width,
            height: viewport.height * 0.28,
          };
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(box.width);
      canvas.height = Math.ceil(box.height);
      const task = page.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport,
        transform: [1, 0, 0, 1, -box.x, -box.y],
      });
      const cancelRender = () => task.cancel();
      signal.addEventListener("abort", cancelRender, { once: true });
      try {
        await task.promise;
      } finally {
        signal.removeEventListener("abort", cancelRender);
      }
      signal.throwIfAborted();
      const result = await untilAborted(worker.recognize(canvas), signal);
      labels.push({
        page: number,
        area: printedAreaFromText(result.data.text, result.data.confidence),
      });
      canvas.width = 0;
      canvas.height = 0;
      progress(number, pdf.numPages);
    }
    return { version: 1, pages: pdf.numPages, labels };
  } finally {
    signal.removeEventListener("abort", stop);
    await terminate();
  }
}
