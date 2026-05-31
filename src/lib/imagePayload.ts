const MAX_IMAGE_SIDE = 1400;
const JPEG_QUALITY = 0.72;

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

export async function compressImageDataUrl(dataUrl: string) {
  if (!isDataImage(dataUrl)) return dataUrl;

  const img = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
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

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
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
