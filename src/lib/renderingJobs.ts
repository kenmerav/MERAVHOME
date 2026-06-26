import type { RoomImage } from "@/lib/db";

const STALE_RENDERING_JOB_MS = 10 * 60 * 1000;

export function resolveStaleRenderingJobs(images: RoomImage[]) {
  const now = Date.now();

  return images.map((image) => {
    if (image.kind !== "rendering") return image;
    if (image.status !== "queued" && image.status !== "processing") return image;
    if (!image.created_at) return image;

    const createdAt = new Date(image.created_at).getTime();
    if (!Number.isFinite(createdAt) || now - createdAt < STALE_RENDERING_JOB_MS) {
      return image;
    }

    return {
      ...image,
      status: "failed" as const,
      error_message: "Rendering timed out before Studio received the finished image. Please try generating it again.",
    };
  });
}
