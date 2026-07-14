/* eslint-disable @typescript-eslint/no-explicit-any -- New Supabase schema is not in the generated client types yet. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isStudioTeamRole } from "@/lib/permissions";

const admin = supabaseAdmin as any;

const BUCKET = "project-task-attachments";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { error: json({ error: "Sign in first." }, 401) };
  const { data: userData } = await admin.auth.getUser(token);
  if (!userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };
  const { data: profile } = await admin
    .from("user_profiles")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.is_active) return { error: json({ error: "Your account is not active." }, 403) };
  return { user: userData.user, profile };
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment";
}

export const Route = createFileRoute("/api/project-task-attachment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireUser(request);
          if ("error" in access) return access.error;
          const form = await request.formData();
          const todoId = String(form.get("todo_id") || "").trim();
          const requestedVisibility = String(form.get("visibility") || "shared");
          const file = form.get("file");
          if (!todoId || !(file instanceof File))
            return json({ error: "Choose a task and file." }, 400);
          if (file.size <= 0 || file.size > MAX_FILE_BYTES)
            return json({ error: "Attachments must be 8 MB or smaller." }, 400);

          const { data: task, error: taskError } = await admin
            .from("shared_project_todos" as any)
            .select("id,project_id,assigned_user_id,visibility")
            .eq("id", todoId)
            .maybeSingle();
          if (taskError || !task) return json({ error: "Task not found." }, 404);
          const isStudio = isStudioTeamRole(access.profile.role);
          if (
            !isStudio &&
            (task.assigned_user_id !== access.user.id || task.visibility !== "assigned_external")
          ) {
            return json({ error: "You cannot attach files to this task." }, 403);
          }

          const visibility = isStudio && requestedVisibility === "internal" ? "internal" : "shared";
          const path = `${task.project_id}/${todoId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
          const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });
          if (uploadError) return json({ error: uploadError.message }, 500);
          const { data: attachment, error: insertError } = await admin
            .from("project_todo_attachments" as any)
            .insert({
              todo_id: todoId,
              uploaded_by: access.user.id,
              file_name: file.name,
              storage_path: path,
              mime_type: file.type || null,
              file_size: file.size,
              visibility,
            })
            .select("*")
            .single();
          if (insertError) {
            await admin.storage.from(BUCKET).remove([path]);
            return json({ error: insertError.message }, 500);
          }
          const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
          return json({ attachment: { ...attachment, signed_url: signed?.signedUrl ?? null } });
        } catch (error: any) {
          console.error("Project task attachment upload failed", error);
          return json({ error: error?.message || "Unable to upload attachment." }, 500);
        }
      },
    },
  },
});
