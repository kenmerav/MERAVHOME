/* eslint-disable @typescript-eslint/no-explicit-any -- server-only Marvin records are not in generated Supabase types. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { addUploadedSource, json, requireMarvinUser } from "@/lib/marvin.server";

const admin = supabaseAdmin as any;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
]);

function safeHeaderFileName(value: string) {
  return value.replace(/[\r\n"]/g, "").slice(0, 180) || "project-capture";
}

function inferredMime(file: File) {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a" || extension === "mp4") return "audio/mp4";
  if (extension === "wav") return "audio/wav";
  if (extension === "webm") return "audio/webm";
  if (extension === "ogg") return "audio/ogg";
  return "";
}

async function projectExists(projectId: string) {
  const { data } = await admin.from("projects").select("id").eq("id", projectId).maybeSingle();
  return Boolean(data);
}

export const Route = createFileRoute("/api/project-captures")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireMarvinUser(request);
          if ("error" in access) return access.error;
          const url = new URL(request.url);
          const sourceId = String(url.searchParams.get("source_id") || "").trim();
          if (sourceId) {
            const { data: source, error } = await admin
              .from("marvin_sources")
              .select("id,title,storage_path,mime_type,metadata")
              .eq("id", sourceId)
              .contains("metadata", { project_capture: true })
              .maybeSingle();
            if (error) throw error;
            if (!source?.storage_path) return json({ error: "Original capture not found." }, 404);
            const { data: file, error: downloadError } = await admin.storage
              .from("marvin-sources")
              .download(source.storage_path);
            if (downloadError || !file) throw downloadError || new Error("Capture could not open.");
            return new Response(file, {
              headers: {
                "Content-Type": source.mime_type || file.type || "application/octet-stream",
                "Content-Disposition": `inline; filename="${safeHeaderFileName(source.title)}"`,
                "Cache-Control": "private, no-store",
              },
            });
          }

          const projectId = String(url.searchParams.get("project_id") || "").trim();
          if (!projectId) return json({ error: "project_id is required." }, 400);
          const { data, error } = await admin
            .from("marvin_sources")
            .select(
              "id,title,source_type,summary,occurred_at,mime_type,processing_status,metadata,marvin_source_projects!inner(project_id)",
            )
            .eq("marvin_source_projects.project_id", projectId)
            .contains("metadata", { project_capture: true })
            .order("occurred_at", { ascending: false, nullsFirst: false })
            .limit(12);
          if (error) throw error;
          return json({ captures: data ?? [] });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Project captures could not load.";
          return json({ error: message }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const access = await requireMarvinUser(request);
          if ("error" in access) return access.error;
          const form = await request.formData();
          const projectId = String(form.get("project_id") || "").trim();
          const title = String(form.get("title") || "").trim();
          const file = form.get("file");
          if (!projectId || !(file instanceof File)) {
            return json({ error: "Choose a project and a recording or note photo." }, 400);
          }
          if (!(await projectExists(projectId))) return json({ error: "Project not found." }, 404);

          const mimeType = inferredMime(file);
          const isImage = IMAGE_TYPES.has(mimeType);
          const isAudio = AUDIO_TYPES.has(mimeType);
          const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
          if ((!isImage && !isAudio) || file.size <= 0 || file.size > maxBytes) {
            return json(
              {
                error: isImage
                  ? "Use a JPG, PNG, or WebP note photo up to 15 MB."
                  : "Use a JPG, PNG, WebP, MP3, M4A, WAV, WebM, or OGG file within the size limit.",
              },
              400,
            );
          }
          const normalizedFile = file.type
            ? file
            : new File([await file.arrayBuffer()], file.name, { type: mimeType });
          const source = await addUploadedSource(
            access,
            normalizedFile,
            [projectId],
            title || (isAudio ? "Post-meeting voice memo" : "Meeting note photo"),
            false,
            true,
          );
          return json({
            capture: {
              id: source.id,
              title: source.title,
              source_type: source.source_type,
              summary: source.summary,
              occurred_at: source.occurred_at,
              mime_type: source.mime_type,
              processing_status: source.processing_status,
              metadata: source.metadata,
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Project capture could not be saved.";
          console.error("Project capture failed", message);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
