const MAX_IMAGE_SIDE = 1400;
const JPEG_QUALITY = 0.72;
const HIGH_FIDELITY_MAX_IMAGE_SIDE = 2400;
const HIGH_FIDELITY_JPEG_QUALITY = 0.9;
const HIGH_FIDELITY_INLINE_BYTE_LIMIT = 6 * 1024 * 1024;

export type RenderingFidelityMode = "standard" | "high_fidelity";

export type PreparedRenderingImage = {
  url: string;
  compressed: boolean;
  originalBytes?: number;
  preparedBytes?: number;
  width?: number;
  height?: number;
};

export function isDataImage(value: string) {
  return /^data:image\/(?:png|jpe?g|webp);base64,/.test(value);
}

export async function fileToCompressedDataUrl(file: File) {
  const dataUrl = await fileToDataUrl(file);
  return compressImageDataUrl(dataUrl);
}

export async function compressImageSource(source: string) {
  if (!isDataImage(source)) return source;
  return compressImageDataUrl(source);
}

export async function prepareRenderingImageSource(source: string, mode: RenderingFidelityMode): Promise<PreparedRenderingImage> {
  const dimensions = await getImageDimensions(source);
  if (mode === "standard") {
    const url = await compressImageSource(source);
    return {
      url,
      compressed: url !== source,
      originalBytes: dataUrlBytes(source),
      preparedBytes: dataUrlBytes(url),
      ...dimensions,
    };
  }

  if (!isDataImage(source)) {
    return {
      url: source,
      compressed: false,
      ...dimensions,
    };
  }

  const originalBytes = dataUrlBytes(source);
  if (originalBytes && originalBytes <= HIGH_FIDELITY_INLINE_BYTE_LIMIT) {
    return {
      url: source,
      compressed: false,
      originalBytes,
      preparedBytes: originalBytes,
      ...dimensions,
    };
  }

  const url = await resizeImageDataUrl(source, {
    maxSide: HIGH_FIDELITY_MAX_IMAGE_SIDE,
    quality: HIGH_FIDELITY_JPEG_QUALITY,
    format: "image/jpeg",
  });
  return {
    url,
    compressed: url !== source,
    originalBytes,
    preparedBytes: dataUrlBytes(url),
    ...dimensions,
  };
}

export async function compressImageDataUrl(dataUrl: string) {
  return resizeImageDataUrl(dataUrl, {
    maxSide: MAX_IMAGE_SIDE,
    quality: JPEG_QUALITY,
    format: "image/jpeg",
  });
}

async function resizeImageDataUrl(
  dataUrl: string,
  {
    maxSide,
    quality,
    format,
  }: {
    maxSide: number;
    quality: number;
    format: "image/jpeg" | "image/png" | "image/webp";
  },
) {
  if (!isDataImage(dataUrl)) return dataUrl;

  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL(format, quality);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function getImageDimensions(src: string) {
  try {
    const img = await loadImage(src);
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  } catch {
    return {};
  }
}

function dataUrlBytes(value: string) {
  if (!isDataImage(value)) return undefined;
  const base64 = value.split(",", 2)[1];
  if (!base64) return undefined;
  return Math.floor((base64.length * 3) / 4);
}
