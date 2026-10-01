import { normalizeSupabaseImageUrl } from "./local-assets";

const IMAGE_TIMEOUT_MS = 15_000;

function loadCanvasImage(src: string, anonymous = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve(image);
    };
    const timeout = setTimeout(() => {
      finish(new Error("Image download timed out."));
      image.src = "";
    }, IMAGE_TIMEOUT_MS);
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        finish(new Error("Image has no readable pixels."));
      } else finish();
    };
    image.onerror = () => finish(new Error("Could not load image for export."));
    // Set before src so even a cached image is safe to draw onto an export canvas.
    if (anonymous) image.crossOrigin = "anonymous";
    image.src = src;
  });
}

async function loadExportImage(src: string): Promise<HTMLImageElement> {
  const normalizedSrc = normalizeSupabaseImageUrl(src);
  if (normalizedSrc.startsWith("data:image/") || normalizedSrc.startsWith("blob:")) {
    return loadCanvasImage(normalizedSrc);
  }

  try {
    // Public storage images already support CORS. Avoid an extra server download,
    // which can fail independently even when the image displays on the board.
    return await loadCanvasImage(normalizedSrc, true);
  } catch {
    // Retailer images may deny CORS; use the existing server conversion for those
    // and as a second download attempt after a temporary storage/network failure.
    const response = await fetch("/api/image-data-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: new URL(normalizedSrc, window.location.href).href }),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    const body = await response.json();
    if (!response.ok || typeof body?.image !== "string" || !body.image.startsWith("data:image/")) {
      throw new Error(body?.error || "Could not download image for export.");
    }
    return loadCanvasImage(body.image);
  }
}

// Scope the decoded-image cache to one page so large multi-page boards do not
// keep every original image in memory for the duration of the PDF export.
export function createDesignBoardExportImageLoader() {
  const images = new Map<string, Promise<HTMLImageElement>>();
  return (src: string) => {
    const key = normalizeSupabaseImageUrl(src);
    let image = images.get(key);
    if (!image) {
      image = loadExportImage(key).catch((error) => {
        images.delete(key);
        throw error;
      });
      images.set(key, image);
    }
    return image;
  };
}
