import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/marvin.server";
import {
  requireConstructionUploadAccess,
  loadConstructionUploadStatus,
  refreshConstructionUploads,
} from "@/lib/constructionUploads.server";

export const Route = createFileRoute("/api/construction-uploads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await requireConstructionUploadAccess(request);
        if ("error" in access) return access.error;
        try {
          return json(await loadConstructionUploadStatus());
        } catch {
          return json({ error: "Unable to load document upload status." }, 500);
        }
      },
      POST: async ({ request }) => {
        const access = await requireConstructionUploadAccess(request);
        if ("error" in access) return access.error;
        try {
          return json(await refreshConstructionUploads(access.user.id));
        } catch {
          return json(
            { error: "Document refresh failed. Check upload status before retrying." },
            500,
          );
        }
      },
    },
  },
});
