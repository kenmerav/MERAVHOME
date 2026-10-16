import pdfWorkerSource from "pdfjs-dist/legacy/build/pdf.worker.mjs?raw";
import { ensurePdfJsServerGlobals } from "./pdfJsServerGlobals";
export async function createDrawingPdfParser(bytes: Uint8Array) {
  await ensurePdfJsServerGlobals();
  const { PDFParse } = await import("pdf-parse");
  PDFParse.setWorker(
    `data:text/javascript;base64,${Buffer.from(pdfWorkerSource).toString("base64")}`,
  );
  return new PDFParse({ data: Buffer.from(bytes), stopAtErrors: true });
}
export async function extractDrawingPageText(bytes: Uint8Array, pages: number) {
  const parser = await createDrawingPdfParser(bytes);
  try {
    const result = await parser.getText();
    if (
      result.pages.length !== pages ||
      new Set(result.pages.map((page) => page.num)).size !== pages ||
      result.pages.some((page) => page.num < 1 || page.num > pages)
    )
      throw Error("Could not account for every PDF text page.");
    return result.pages.map((page) => ({ page: page.num, text: page.text }));
  } finally {
    await parser.destroy();
  }
}
