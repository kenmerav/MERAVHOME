import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  dataUrlToBuffer,
  ensureRoomImageBucket,
  ROOM_IMAGE_BUCKET,
} from "@/lib/roomImageStorage.server";
import { requireRoomDesignPilotAccess } from "@/lib/roomDesignAuth.server";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_KINDS = [
  "concept-board",
  "room-photo",
  "floor-plan",
  "sketchup-view",
  "completed-render",
  "product-cutout",
] as const;
type ImageKind = (typeof IMAGE_KINDS)[number];

function extension(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

export const Route = createFileRoute("/api/room-design-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            projectId?: string;
            roomId?: string;
            kind?: ImageKind;
            dataUrl?: string;
            fileName?: string;
          };
          if (!body.projectId || !body.roomId || !body.kind || !body.dataUrl) {
            return Response.json(
              { error: "projectId, roomId, kind, and image are required." },
              { status: 400 },
            );
          }
          const access = await requireRoomDesignPilotAccess(request, {
            projectId: body.projectId,
            roomId: body.roomId,
          });
          if ("error" in access) return access.error;
          if (!IMAGE_KINDS.includes(body.kind)) {
            return Response.json({ error: "Unsupported Room Design image kind." }, { status: 400 });
          }

          const decoded = dataUrlToBuffer(body.dataUrl);
          if (decoded.buffer.byteLength > MAX_IMAGE_BYTES) {
            return Response.json({ error: "Image must be 20 MB or smaller." }, { status: 413 });
          }
          await ensureRoomImageBucket();
          const safeName =
            (body.fileName || body.kind)
              .replace(/\.[^/.]+$/, "")
              .replace(/[^a-z0-9]+/gi, "-")
              .replace(/^-|-$/g, "")
              .toLowerCase() || body.kind;
          const path = `${body.roomId}/room-design/${body.kind}/${Date.now()}-${crypto.randomUUID()}-${safeName}.${extension(decoded.contentType)}`;
          const { error } = await supabaseAdmin.storage
            .from(ROOM_IMAGE_BUCKET)
            .upload(path, decoded.buffer, {
              contentType: decoded.contentType,
              cacheControl: "31536000",
              upsert: false,
            });
          if (error) throw error;
          const { data } = supabaseAdmin.storage.from(ROOM_IMAGE_BUCKET).getPublicUrl(path);
          return Response.json({ url: data.publicUrl, path });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Room Design image upload failed.";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
