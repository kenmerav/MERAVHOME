import { createFileRoute } from "@tanstack/react-router";
import { uploadRoomImageFromDataUrl } from "@/lib/roomImageStorage.server";

export const Route = createFileRoute("/api/upload-room-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { dataUrl, roomId, kind, fileName } = (await request.json()) as {
            dataUrl?: string;
            roomId?: string;
            kind?: "sketchup" | "rendering";
            fileName?: string;
          };

          if (!dataUrl || !roomId || !kind) {
            return Response.json({ error: "dataUrl, roomId, and kind are required." }, { status: 400 });
          }

          const uploaded = await uploadRoomImageFromDataUrl({
            dataUrl,
            roomId,
            kind,
            preferredName: fileName,
          });

          return Response.json({ url: uploaded.publicUrl });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});

