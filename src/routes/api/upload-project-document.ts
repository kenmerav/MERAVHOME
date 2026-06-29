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

function dataUrlToFileBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) throw new Error("File must be uploaded as a base64 data URL.");
  const contentType = match[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    throw new Error("Upload a PDF, JPG, PNG, or WebP file.");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > PROJECT_FILE_LIMIT) {
    throw new Error("File is too large. Keep construction docs under 50 MB.");
  }
  return { contentType, buffer };
}

function extensionForContentType(contentType: string, fileName?: string) {
  const existing = fileName?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (existing && ["pdf", "jpg", "jpeg", "png", "webp"].includes(existing)) return existing;
  if (contentType === "application/pdf") return "pdf";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
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
            dataUrl?: string;
            projectId?: string;
            fileName?: string;
          };
          if (!body.projectId) return json({ error: "projectId is required." }, 400);
          if (!body.dataUrl) return json({ error: "Choose a construction document to upload." }, 400);

          await ensureProjectFilesBucket();
          const { buffer, contentType } = dataUrlToFileBuffer(body.dataUrl);
          const extension = extensionForContentType(contentType, body.fileName);
          const path = `${body.projectId}/construction-docs/${Date.now()}-${crypto.randomUUID()}-${safeFileName(body.fileName)}.${extension}`;

          const { error } = await supabaseAdmin.storage.from(PROJECT_FILES_BUCKET).upload(path, buffer, {
            contentType,
            cacheControl: "31536000",
            upsert: false,
          });
          if (error) throw error;

          const { data } = supabaseAdmin.storage.from(PROJECT_FILES_BUCKET).getPublicUrl(path);
          return json({
            url: data.publicUrl,
            path,
            contentType,
            size: buffer.byteLength,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed.";
          return json({ error: message }, 500);
        }
      },
    },
  },
});
