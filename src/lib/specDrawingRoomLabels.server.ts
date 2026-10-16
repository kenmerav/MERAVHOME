import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker, PSM, type Worker, type Line } from "tesseract.js";
import { createDrawingPdfParser } from "./specDrawingText.server";
import {
  drawingRoomHeadings,
  type DrawingMatchItem,
  type DrawingRoomLabel,
} from "./specDrawingMatches";

function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Error("Room-label reading reached its time limit.")),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** OCR runs on the Studio server. Only the public language model is downloaded;
 * construction images/text are never uploaded to an OCR or AI service. */
export async function readDrawingRoomLabels(
  bytes: Uint8Array,
  pages: number[],
  items: DrawingMatchItem[],
  progress?: (labels: DrawingRoomLabel[], pagesRead: number) => Promise<void>,
) {
  const labels: DrawingRoomLabel[] = [];
  if (!pages.length) return { labels, pagesRead: 0 };
  const cachePath = join(tmpdir(), "merav-drawing-room-ocr");
  await mkdir(cachePath, { recursive: true, mode: 0o700 });
  let worker: Worker | undefined;
  let parser: Awaited<ReturnType<typeof createDrawingPdfParser>> | undefined;
  let stopped = false,
    pagesRead = 0;
  // Reserve time for source/text preparation and the final save inside the
  // 300-second workflow function, while allowing large drawing sets to finish.
  const deadline = Date.now() + 210_000;
  try {
    const creating = createWorker("eng", 1, {
      cachePath,
      langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
    });
    void creating
      .then((value) => {
        if (stopped) void value.terminate();
      })
      .catch(() => undefined);
    worker = await bounded(creating, 25_000);
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: "200" });
    parser = await createDrawingPdfParser(bytes);
    for (const number of [...new Set(pages)].sort((a, b) => a - b)) {
      if (Date.now() >= deadline) throw Error("Room-label reading reached its time limit.");
      const image = (
        await bounded(
          parser.getScreenshot({
            partial: [number],
            desiredWidth: 2600,
            imageBuffer: true,
            imageDataUrl: false,
          }),
          Math.min(20_000, deadline - Date.now()),
        )
      ).pages[0];
      if (!image) throw Error("A construction sheet could not be rendered for its room label.");
      const top = Math.floor(image.height * 0.65);
      const result = await bounded(
        worker.recognize(
          Buffer.from(image.data),
          {
            rectangle: {
              left: 0,
              top,
              width: Math.floor(image.width),
              height: Math.floor(image.height) - top,
            },
          },
          { text: true, blocks: true },
        ),
        Math.min(15_000, deadline - Date.now()),
      );
      const lines: Line[] = (result.data.blocks || []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) => paragraph.lines),
      );
      labels.push(
        ...drawingRoomHeadings(
          number,
          lines.map((line) => ({ text: line.text, confidence: line.confidence })),
          items,
          "page_ocr",
        ),
      );
      pagesRead++;
      await progress?.([...labels], pagesRead);
    }
    return { labels, pagesRead };
  } catch (error) {
    return {
      labels,
      pagesRead,
      warning: error instanceof Error ? error.message : "Some room labels could not be read.",
    };
  } finally {
    stopped = true;
    await worker?.terminate().catch(() => undefined);
    await parser?.destroy().catch(() => undefined);
  }
}
