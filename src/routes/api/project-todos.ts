import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canManageStudio, canViewFinancials, isStudioTeamRole } from "@/lib/permissions";

const admin = supabaseAdmin as any;

type TodoStatus = "suggested" | "open" | "ready" | "in_progress" | "waiting" | "blocked" | "complete" | "cancelled";
type TodoPriority = "low" | "normal" | "high";

const STATUSES: TodoStatus[] = ["suggested", "open", "ready", "in_progress", "waiting", "blocked", "complete", "cancelled"];
const PRIORITIES: TodoPriority[] = ["low", "normal", "high"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNullableText(value: unknown) {
  const text = cleanText(value);
  return text.length ? text : null;
}

function cleanDate(value: unknown) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanChoice<T extends string>(value: unknown, choices: T[], fallback: T) {
  return choices.includes(value as T) ? (value as T) : fallback;
}

function isMissingTable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "42P01";
}

async function requireActiveUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in first." }, 401) };

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) return { error: json({ error: profileError.message }, 500) };
  if (!profile?.is_active) return { error: json({ error: "This account is not active." }, 403) };

  return { user: userData.user, profile };
}

async function userCanAccessProject(userId: string, projectId: string) {
  const { data } = await admin
    .from("user_project_assignments")
    .select("project_id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  return !!data;
}

async function getProjectAssignees(projectId: string) {
  const { data: assignments, error: assignmentError } = await admin
    .from("user_project_assignments")
    .select("user_id")
    .eq("project_id", projectId);
  if (assignmentError) throw assignmentError;

  const userIds = Array.from(new Set((assignments ?? []).map((row: any) => row.user_id).filter(Boolean)));
  if (!userIds.length) return [];

  const { data: users, error: usersError } = await admin
    .from("user_profiles")
    .select("id,email,full_name,role,is_active")
    .in("id", userIds)
    .eq("is_active", true)
    .in("role", ["Contractor", "Client"]);
  if (usersError) throw usersError;

  return (users ?? []).sort((a: any, b: any) => {
    const aName = a.full_name || a.email || "";
    const bName = b.full_name || b.email || "";
    return aName.localeCompare(bName);
  });
}

export const Route = createFileRoute("/api/project-todos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireActiveUser(request);
          if ("error" in access) return access.error;

          const url = new URL(request.url);
          const projectId = cleanText(url.searchParams.get("projectId"));
          const taskId = cleanText(url.searchParams.get("taskId"));
          if (taskId) {
            const { data: task, error: taskError } = await admin
              .from("shared_project_todos" as any)
              .select("id,project_id,assigned_user_id,visibility")
              .eq("id", taskId)
              .maybeSingle();
            if (taskError || !task) return json({ error: "To-do not found." }, 404);
            const isStudio = isStudioTeamRole(access.profile.role);
            if (!isStudio && (task.assigned_user_id !== access.user.id || task.visibility !== "assigned_external")) {
              return json({ error: "You do not have access to this to-do." }, 403);
            }
            const { data: messages, error: messageError } = await admin
              .from("project_todo_messages" as any)
              .select("*, author:user_profiles(id,email,full_name,role)")
              .eq("todo_id", taskId)
              .in("visibility", isStudio ? ["shared", "internal"] : ["shared"])
              .order("created_at");
            if (messageError) return json({ error: messageError.message }, 500);
            const attachmentQuery = admin
              .from("project_todo_attachments" as any)
              .select("*")
              .eq("todo_id", taskId)
              .order("created_at");
            const { data: attachments, error: attachmentError } = await (isStudio
              ? attachmentQuery
              : attachmentQuery.eq("visibility", "shared"));
            if (attachmentError) return json({ error: attachmentError.message }, 500);
            const signedAttachments = await Promise.all((attachments ?? []).map(async (attachment: any) => {
              if (!attachment.storage_path) return { ...attachment, signed_url: attachment.external_url };
              const { data: signed } = await admin.storage.from("project-task-attachments").createSignedUrl(attachment.storage_path, 60 * 60);
              return { ...attachment, signed_url: signed?.signedUrl ?? null };
            }));
            return json({ messages: messages ?? [], attachments: signedAttachments });
          }
          if (!projectId) return json({ error: "Missing project id." }, 400);

          const isStudio = canManageStudio(access.profile) || canViewFinancials(access.profile);
          if (!isStudio && !(await userCanAccessProject(access.user.id, projectId))) {
            return json({ error: "You do not have access to this project." }, 403);
          }

          const query = admin
            .from("shared_project_todos" as any)
            .select("*")
            .eq("project_id", projectId)
            .eq("visibility", "assigned_external")
            .order("status", { ascending: false })
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false });

          const { data, error } = await (isStudio
            ? query
            : query.eq("assigned_user_id", access.user.id).eq("visibility", "assigned_external"));
          if (error) {
            if (isMissingTable(error)) return json({ todos: [], assignees: [], setupNeeded: true });
            return json({ error: error.message }, 500);
          }

          const assignees = isStudio ? await getProjectAssignees(projectId) : [];
          const assigneeById = new Map(assignees.map((assignee: any) => [assignee.id, assignee]));
          const todos = (data ?? []).map((todo: any) => ({
            ...todo,
            assigned_user: assigneeById.get(todo.assigned_user_id) ?? null,
          }));
          return json({ todos, assignees });
        } catch (error: any) {
          console.error("List project todos failed", error);
          return json({ error: error?.message || "Unable to load project to-dos." }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const access = await requireActiveUser(request);
          if ("error" in access) return access.error;
          const body = await request.json();
          if (body.action === "message") {
            const todoId = cleanText(body.todo_id);
            const message = cleanText(body.message);
            if (!todoId || !message) return json({ error: "Write a reply first." }, 400);
            const { data: task, error: taskError } = await admin
              .from("shared_project_todos" as any)
              .select("id,assigned_user_id,visibility")
              .eq("id", todoId)
              .maybeSingle();
            if (taskError || !task) return json({ error: "To-do not found." }, 404);
            const isStudio = isStudioTeamRole(access.profile.role);
            if (!isStudio && (task.assigned_user_id !== access.user.id || task.visibility !== "assigned_external")) {
              return json({ error: "You cannot reply to this to-do." }, 403);
            }
            const { data, error } = await admin.from("project_todo_messages" as any).insert({
              todo_id: todoId,
              author_id: access.user.id,
              body: message,
              visibility: isStudio && body.visibility === "internal" ? "internal" : "shared",
            }).select("*").single();
            if (error) return json({ error: error.message }, 500);
            return json({ message: data });
          }
          if (!canViewFinancials(access.profile)) {
            return json({ error: "Only Ken and Katie can assign project to-dos." }, 403);
          }
          const title = cleanText(body.title);
          const projectId = cleanText(body.project_id);
          const assignedUserId = cleanText(body.assigned_user_id);
          if (!title) return json({ error: "Add a to-do title." }, 400);
          if (!projectId) return json({ error: "Missing project." }, 400);
          if (!assignedUserId) return json({ error: "Choose who this is assigned to." }, 400);
          if (!(await userCanAccessProject(assignedUserId, projectId))) {
            return json({ error: "That user is not assigned to this project." }, 400);
          }
          const { data: assignedProfile } = await admin
            .from("user_profiles")
            .select("role")
            .eq("id", assignedUserId)
            .maybeSingle();

          const { data, error } = await admin
            .from("shared_project_todos" as any)
            .insert({
              project_id: projectId,
              assigned_user_id: assignedUserId,
              title,
              notes: cleanNullableText(body.notes),
              due_date: cleanDate(body.due_date),
              reminder_date: cleanDate(body.reminder_date),
              priority: cleanChoice(body.priority, PRIORITIES, "normal"),
              status: "open",
              visibility: "assigned_external",
              waiting_on: assignedProfile?.role === "Contractor" ? "gc" : "client",
              created_by: access.user.id,
            })
            .select("*")
            .single();

          if (error) return json({ error: error.message }, isMissingTable(error) ? 503 : 500);
          return json({ todo: data });
        } catch (error: any) {
          console.error("Create project todo failed", error);
          return json({ error: error?.message || "Unable to create project to-do." }, 500);
        }
      },
      PATCH: async ({ request }) => {
        try {
          const access = await requireActiveUser(request);
          if ("error" in access) return access.error;

          const body = await request.json();
          const id = cleanText(body.id);
          if (!id) return json({ error: "Missing to-do id." }, 400);

          const { data: existing, error: existingError } = await admin
            .from("shared_project_todos" as any)
            .select("id,assigned_user_id")
            .eq("id", id)
            .maybeSingle();
          if (existingError) return json({ error: existingError.message }, isMissingTable(existingError) ? 503 : 500);
          if (!existing) return json({ error: "To-do not found." }, 404);

          const isStudio = isStudioTeamRole(access.profile.role);
          if (!isStudio && existing.assigned_user_id !== access.user.id) {
            return json({ error: "You can only update your assigned to-dos." }, 403);
          }

          const requestedStatus = cleanChoice(body.status, STATUSES, "open");
          const status = !isStudio && requestedStatus === "complete" ? "ready" : requestedStatus;
          const { data, error } = await admin
            .from("shared_project_todos" as any)
            .update({
              status,
              completed_at: status === "complete" ? new Date().toISOString() : null,
              ready_for_review_at: status === "ready" ? new Date().toISOString() : null,
              waiting_on: status === "ready" ? "employee" : undefined,
            })
            .eq("id", id)
            .select("*")
            .single();

          if (error) return json({ error: error.message }, isMissingTable(error) ? 503 : 500);
          return json({ todo: data });
        } catch (error: any) {
          console.error("Update project todo failed", error);
          return json({ error: error?.message || "Unable to update project to-do." }, 500);
        }
      },
    },
  },
});
