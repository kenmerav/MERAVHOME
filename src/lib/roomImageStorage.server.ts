import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const ROOM_IMAGE_BUCKET = "room-images";
const ROOM_IMAGE_LIMIT = 20 * 1024 * 1024;

function extensionForContentType(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

export function isInlineImageUrl(value: string | null | undefined) {
  return Boolean(value && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value));
}

export function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  if (!match) throw new Error("Image must be a PNG, JPG, or WebP data URL.");
  return {
    contentType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64"),
  };
}

export async function ensureRoomImageBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(ROOM_IMAGE_BUCKET);
  if (data) {
    const { error } = await supabaseAdmin.storage.updateBucket(ROOM_IMAGE_BUCKET, {
      public: true,
      fileSizeLimit: ROOM_IMAGE_LIMIT,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    if (error) throw error;
    return;
  }

  const { error } = await supabaseAdmin.storage.createBucket(ROOM_IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: ROOM_IMAGE_LIMIT,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function uploadRoomImageFromDataUrl({
  dataUrl,
  roomId,
  kind,
  preferredName,
}: {
  dataUrl: string;
  roomId: string;
  kind: "sketchup" | "rendering";
  preferredName?: string | null;
}) {
  await ensureRoomImageBucket();
  const { buffer, contentType } = dataUrlToBuffer(dataUrl);
  const extension = extensionForContentType(contentType);
  const safeName = (preferredName || kind)
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || kind;
  const path = `${roomId}/${kind}/${Date.now()}-${safeName}.${extension}`;

  const { error } = await supabaseAdmin.storage.from(ROOM_IMAGE_BUCKET).upload(path, buffer, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(ROOM_IMAGE_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl, path };
}

