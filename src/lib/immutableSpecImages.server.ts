import { safeImageBuffer } from "./measuredImage.server";

const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export class ImmutableSpecImageError extends Error {}

// Freeze each checked source exactly once. Callers send the returned data URLs
// unchanged to both token counting and generation; source URLs remain display
// metadata only. Sequential loading and one timeout bound peak memory and time.
export async function immutableSpecImages(urls: string[], alreadyUsedBytes = 0,
  loader: typeof safeImageBuffer = safeImageBuffer) {
  if (!urls.length || urls.length > 11 || !Number.isSafeInteger(alreadyUsedBytes) || alreadyUsedBytes < 0 || alreadyUsedBytes >= MAX_TOTAL_BYTES)
    throw new ImmutableSpecImageError("The product images could not be checked safely.");
  let bytes = alreadyUsedBytes;
  const images: string[] = [];
  const signal = AbortSignal.timeout(45000);
  for (const url of urls) {
    const result = await loader(url, signal);
    const type = String(result.contentType || "").toLowerCase();
    if (!Buffer.isBuffer(result.buffer) || !result.buffer.length || !IMAGE_TYPES.has(type))
      throw new ImmutableSpecImageError("A product image could not be verified.");
    bytes += result.buffer.length;
    if (bytes > MAX_TOTAL_BYTES) throw new ImmutableSpecImageError("Keep the combined product images under 12 MB.");
    images.push(`data:${type};base64,${result.buffer.toString("base64")}`);
  }
  return { images, bytes };
}
