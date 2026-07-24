import { createFileRoute } from "@tanstack/react-router";
import { addUploadedSource, json, requireMarvinUser } from "@/lib/marvin.server";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
]);

function inferredMime(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "md") return "text/markdown";
  if (extension === "txt") return "text/plain";
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "";
}

export const Route = createFileRoute("/api/marvin-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireMarvinUser(request);
          if ("error" in access) return access.error;
          const form = await request.formData();
          const file = form.get("file");
          const title = String(form.get("title") || "").trim();
          const projectIds = JSON.parse(String(form.get("project_ids") || "[]"));
          const generalBusiness = String(form.get("general_business") || "") === "true";
          if (
            !(file instanceof File) ||
            !Array.isArray(projectIds) ||
            (!generalBusiness && !projectIds.length)
          ) {
            return json(
              { error: "Choose a file and at least one project or General / Business." },
              400,
            );
          }
          const mimeType = inferredMime(file);
          if (!ALLOWED.has(mimeType) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
            return json(
              { error: "Use a PDF, DOCX, TXT, Markdown, or audio file up to 50 MB." },
              400,
            );
          }
          const normalizedFile = file.type
            ? file
            : new File([await file.arrayBuffer()], file.name, { type: mimeType });
          return json({
            source: await addUploadedSource(
              access,
              normalizedFile,
              projectIds,
              title,
              generalBusiness,
            ),
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unable to add this source.";
          console.error("Marvin source upload failed", message);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
