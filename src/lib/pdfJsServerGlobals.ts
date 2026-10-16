let pdfJsGlobalsPromise: Promise<void> | null = null;

export async function ensurePdfJsServerGlobals() {
  const globalScope = globalThis as typeof globalThis & {
    DOMMatrix?: typeof DOMMatrix;
    ImageData?: typeof ImageData;
  };

  if (globalScope.DOMMatrix && globalScope.ImageData) return;

  if (!pdfJsGlobalsPromise) {
    pdfJsGlobalsPromise = Promise.resolve()
      .then(async () => {
        // Keep a literal import so Nitro can trace the external native package
        // and its platform binary into the deployed function.
        const canvas = await import("@napi-rs/canvas");
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
