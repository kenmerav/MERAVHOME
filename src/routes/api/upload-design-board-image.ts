import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dataUrlToBuffer } from "@/lib/roomImageStorage.server";

const DESIGN_BOARD_IMAGE_BUCKET = "design-board-images";
const DESIGN_BOARD_IMAGE_LIMIT = 20 * 1024 * 1024;

function extensionForContentType(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

async function ensureDesignBoardImageBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(DESIGN_BOARD_IMAGE_BUCKET);
  if (data) {
    const { error } = await supabaseAdmin.storage.updateBucket(DESIGN_BOARD_IMAGE_BUCKET, {
      public: true,
      fileSizeLimit: DESIGN_BOARD_IMAGE_LIMIT,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    if (error) throw error;
    return;
  }

  const { error } = await supabaseAdmin.storage.createBucket(DESIGN_BOARD_IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: DESIGN_BOARD_IMAGE_LIMIT,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export const Route = createFileRoute("/api/upload-design-board-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { dataUrl, projectId, fileName, contentType } = (await request.json()) as {
            dataUrl?: string;
            projectId?: string;
            fileName?: string;
            contentType?: string;
          };

          if (!projectId) {
            return Response.json({ error: "projectId is required." }, { status: 400 });
          }

          await ensureDesignBoardImageBucket();
          const uploadContentType = contentType || (dataUrl ? dataUrlToBuffer(dataUrl).contentType : "image/png");
          const extension = extensionForContentType(uploadContentType);
          const safeName =
            (fileName || "board-image")
              .replace(/\.[^/.]+$/, "")
              .replace(/[^a-z0-9]+/gi, "-")
              .replace(/^-|-$/g, "")
              .toLowerCase() || "board-image";
          const path = `${projectId}/${Date.now()}-${crypto.randomUUID()}-${safeName}.${extension}`;

          if (!dataUrl) {
            const { data: signed, error: signedError } = await supabaseAdmin.storage
              .from(DESIGN_BOARD_IMAGE_BUCKET)
              .createSignedUploadUrl(path);
            if (signedError) throw signedError;
            const { data } = supabaseAdmin.storage.from(DESIGN_BOARD_IMAGE_BUCKET).getPublicUrl(path);
            return Response.json({
              path,
              token: signed.token,
              signedUrl: signed.signedUrl,
              url: data.publicUrl,
            });
          }

          const { buffer, contentType: decodedContentType } = dataUrlToBuffer(dataUrl);

          const { error } = await supabaseAdmin.storage
            .from(DESIGN_BOARD_IMAGE_BUCKET)
            .upload(path, buffer, {
              contentType: decodedContentType,
              cacheControl: "31536000",
              upsert: false,
            });
          if (error) throw error;

          const { data } = supabaseAdmin.storage.from(DESIGN_BOARD_IMAGE_BUCKET).getPublicUrl(path);
          return Response.json({ url: data.publicUrl });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed.";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
