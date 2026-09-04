import { createFileRoute } from "@tanstack/react-router";
import { requireRoomDesignPilotAccess } from "@/lib/roomDesignAuth.server";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function dataUrlToSource(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) throw new Error("The uploaded image format is not supported.");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("The product image is too large.");
  return { buffer, contentType: match[1] };
}

async function downloadImage(imageUrl: string) {
  if (imageUrl.startsWith("data:image/")) return dataUrlToSource(imageUrl);
  if (!/^https?:\/\//i.test(imageUrl)) throw new Error("A public product image URL is required.");
  const parsed = new URL(imageUrl);
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "::1"
  ) {
    throw new Error("A public product image URL is required.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`Could not download the product image (${response.status}).`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/"))
      throw new Error("The product URL did not return an image.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("The product image is too large.");
    return { buffer, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

export const Route = createFileRoute("/api/room-design-image-source")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            imageUrl?: string;
            projectId?: string;
            roomId?: string;
          };
          if (!body.projectId || !body.roomId) {
            return json({ error: "projectId and roomId are required." }, 400);
          }
          const access = await requireRoomDesignPilotAccess(request, {
            projectId: body.projectId,
            roomId: body.roomId,
          });
          if ("error" in access) return access.error;
          if (!body.imageUrl) return json({ error: "A product image is required." }, 400);

          const source = await downloadImage(body.imageUrl);
          const sourceDataUrl = `data:${source.contentType};base64,${source.buffer.toString("base64")}`;
          return json({ sourceDataUrl });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Background removal failed.";
          return json({ error: message }, 500);
        }
      },
    },
  },
});
