import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PROJECT_FILES_BUCKET = "project-files";
const PROJECT_FILE_LIMIT = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeFileName(fileName?: string) {
  return (
    (fileName || "project-document")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "project-document"
  );
}

async function ensureProjectFilesBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(PROJECT_FILES_BUCKET);
  if (data) {
    const { error } = await supabaseAdmin.storage.updateBucket(PROJECT_FILES_BUCKET, {
      public: true,
      fileSizeLimit: PROJECT_FILE_LIMIT,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });
    if (error) throw error;
    return;
  }

  const { error } = await supabaseAdmin.storage.createBucket(PROJECT_FILES_BUCKET, {
    public: true,
    fileSizeLimit: PROJECT_FILE_LIMIT,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function requireStudioUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in to upload construction docs." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile?.is_active || !["Admin", "Employee"].includes(String(profile.role))) {
    return { error: json({ error: "Only MERAV team members can upload construction docs." }, 403) };
  }

  return { user: userData.user };
}

export const Route = createFileRoute("/api/upload-project-document")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireStudioUser(request);
          if ("error" in access) return access.error;

          const body = (await request.json()) as {
            projectId?: string;
            fileName?: string;
            fileSize?: number;
            contentType?: string;
          };
          if (!body.projectId) return json({ error: "projectId is required." }, 400);
          if (!body.fileName || !body.fileName.toLowerCase().endsWith(".pdf")) {
            return json({ error: "Choose a PDF construction document." }, 400);
          }
          if (body.contentType && body.contentType !== "application/pdf") {
            return json({ error: "Construction documents must be PDF files." }, 400);
          }
          if (!Number.isFinite(body.fileSize) || Number(body.fileSize) <= 0) {
            return json({ error: "The selected PDF is empty or invalid." }, 400);
          }
          if (Number(body.fileSize) > PROJECT_FILE_LIMIT) {
            return json({ error: "File is too large. Keep construction docs under 50 MB." }, 400);
          }

          const { data: project } = await supabaseAdmin
            .from("projects")
            .select("id")
            .eq("id", body.projectId)
            .maybeSingle();
          if (!project) return json({ error: "Project not found." }, 404);

          await ensureProjectFilesBucket();
          const path = `${body.projectId}/construction-docs/${Date.now()}-${crypto.randomUUID()}-${safeFileName(body.fileName)}.pdf`;
          const { data: upload, error } = await supabaseAdmin.storage
            .from(PROJECT_FILES_BUCKET)
            .createSignedUploadUrl(path);
          if (error) throw error;

          const { data } = supabaseAdmin.storage.from(PROJECT_FILES_BUCKET).getPublicUrl(path);
          return json({
            url: data.publicUrl,
            path,
            token: upload.token,
            contentType: "application/pdf",
            size: Number(body.fileSize),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed.";
          return json({ error: message }, 500);
        }
      },
    },
  },
});
