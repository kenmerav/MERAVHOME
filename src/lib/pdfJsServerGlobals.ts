import { createRequire } from "node:module";

let pdfJsGlobalsPromise: Promise<void> | null = null;

type CanvasModule = typeof import("@napi-rs/canvas");

export async function ensurePdfJsServerGlobals() {
  const globalScope = globalThis as typeof globalThis & {
    DOMMatrix?: typeof DOMMatrix;
    ImageData?: typeof ImageData;
  };

  if (globalScope.DOMMatrix && globalScope.ImageData) return;

  if (!pdfJsGlobalsPromise) {
    pdfJsGlobalsPromise = Promise.resolve()
      .then(() => {
        // Load the native canvas package at runtime so Nitro does not bundle its
        // platform-specific binary into the server JavaScript.
        const packageName = ["@napi-rs", "canvas"].join("/");
        const canvas = createRequire(import.meta.url)(packageName) as CanvasModule;
        globalScope.DOMMatrix ??= canvas.DOMMatrix as unknown as typeof DOMMatrix;
        globalScope.ImageData ??= canvas.ImageData as unknown as typeof ImageData;
      })
      .catch((error) => {
        pdfJsGlobalsPromise = null;
        throw error;
      });
  }

  await pdfJsGlobalsPromise;
}
