import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isStudioTeamRole } from "@/lib/permissions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isMissingTable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "42P01";
}

type BoardComment = {
  id?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  pageId?: unknown;
  body?: unknown;
  taggedUserIds?: unknown;
  createdById?: unknown;
  createdByName?: unknown;
};

type BoardPage = {
  id?: unknown;
  title?: unknown;
  elements?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function commentsFromBoardState(boardState: unknown): BoardComment[] {
  if (!boardState || typeof boardState !== "object") return [];
  const comments = (boardState as { comments?: unknown }).comments;
  return Array.isArray(comments) ? (comments.filter(Boolean) as BoardComment[]) : [];
}

function pagesFromBoardState(boardState: unknown): BoardPage[] {
  if (!boardState || typeof boardState !== "object") return [];
  const pages = (boardState as { pages?: unknown }).pages;
  return Array.isArray(pages) ? (pages.filter(Boolean) as BoardPage[]) : [];
}

function pageTitleForComment(boardState: unknown, pageId: string) {
  const page = pagesFromBoardState(boardState).find((item) => text(item.id) === pageId);
  return text(page?.title) || "Design Board";
}

function targetLabelForComment(boardState: unknown, comment: BoardComment) {
  const pageId = text(comment.pageId);
  const targetId = text(comment.targetId);
  const page = pagesFromBoardState(boardState).find((item) => text(item.id) === pageId);
  const elements = Array.isArray(page?.elements) ? (page.elements as any[]) : [];
  const element = elements.find((item) => text(item?.id) === targetId);
  if (!element || typeof element !== "object") return "Board item";
  return (
    text(element.label) ||
    text(element.productName) ||
    text(element.materialLabel) ||
    (text(element.type) === "text" ? "Text box" : "Board item")
  );
}

function commentDestination(projectId: string, comment: BoardComment) {
  const pageId = text(comment.pageId);
  const targetType = text(comment.targetType);
  const targetId = text(comment.targetId);
  const commentId = text(comment.id);
  if (!pageId || !targetId || !commentId) return `/projects/${projectId}/design-boards`;
  const params = new URLSearchParams({ page: pageId, comment: commentId });
  if (targetType === "element") params.set("element", targetId);
  return `/projects/${projectId}/design-boards?${params.toString()}`;
}

function commentIdFromTodoNotes(notes: unknown) {
  if (typeof notes !== "string") return "";
  const line = notes
    .split("\n")
    .find((item) => item.trim().toLowerCase().startsWith("comment id:"));
  return line?.replace(/comment id:/i, "").trim() || "";
}

function commentTodoNotes({
  body,
  projectName,
  pageTitle,
  targetLabel,
  createdByName,
  projectId,
  comment,
}: {
  body: string;
  projectName: string;
  pageTitle: string;
  targetLabel: string;
  createdByName: string;
  projectId: string;
  comment: BoardComment;
}) {
  return [
    body,
    "",
    `Project: ${projectName || "Project"}`,
    `Page: ${pageTitle}`,
    `Item: ${targetLabel}`,
    `From: ${createdByName || "MERAV teammate"}`,
    `Open comment: ${commentDestination(projectId, comment)}`,
    `Open board: /projects/${projectId}/design-boards`,
    `Comment ID: ${text(comment.id)}`,
  ].join("\n");
}

export const Route = createFileRoute("/api/my-todos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization");
          const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
          if (!token) return json({ error: "Sign in to view assigned to-dos." }, 401);

          const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
          if (userError || !userData.user) return json({ error: "Your session is no longer valid." }, 401);

          const { data: profile } = await supabaseAdmin
            .from("user_profiles")
            .select("id,email,full_name,role,is_active")
            .eq("id", userData.user.id)
            .maybeSingle();

          if (!profile?.is_active || !isStudioTeamRole(profile.role)) {
            return json({ error: "Only admin and employee accounts can view assigned Studio to-dos." }, 403);
          }

          await ensureDesignBoardCommentTodos(userData.user.id);

          const { data, error } = await supabaseAdmin
            .from("shared_project_todos" as any)
            .select("*, project:projects(id,name,client_name)")
            .eq("assigned_user_id", userData.user.id)
            .neq("status", "complete")
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("reminder_date", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(50);

          if (error) {
            if (isMissingTable(error)) return json({ todos: [], setupNeeded: true });
            return json({ error: error.message }, 500);
          }

          return json({ todos: data ?? [] });
        } catch (error) {
          console.error("List assigned to-dos failed", error);
          return json({ error: "Could not load assigned to-dos." }, 500);
        }
      },
    },
  },
});

async function ensureDesignBoardCommentTodos(userId: string) {
  const { data: existingTodos, error: existingError } = await supabaseAdmin
    .from("shared_project_todos" as any)
    .select("id,notes")
    .eq("assigned_user_id", userId)
    .limit(1000);

  if (existingError) {
    if (isMissingTable(existingError)) return;
    throw existingError;
  }

  const existingTodoByCommentId = new Map<string, any>();
  for (const todo of existingTodos ?? []) {
    const commentId = commentIdFromTodoNotes((todo as any).notes);
    if (commentId) existingTodoByCommentId.set(commentId, todo);
  }
  const existingCommentIds = new Set(existingTodoByCommentId.keys());

  const { data: boards, error: boardsError } = await supabaseAdmin
    .from("design_boards" as any)
    .select("project_id,board_state");

  if (boardsError) throw boardsError;

  const rows: any[] = [];
  const noteUpdates: Array<{ id: string; notes: string }> = [];
  const projectIds = Array.from(
    new Set((boards ?? []).map((board: any) => text(board.project_id)).filter(Boolean)),
  );
  const { data: projects, error: projectsError } = projectIds.length
    ? await supabaseAdmin.from("projects").select("id,name").in("id", projectIds)
    : { data: [], error: null };
  if (projectsError) throw projectsError;
  const projectById = new Map((projects ?? []).map((project: any) => [project.id, project]));

  for (const board of boards ?? []) {
    const projectId = text((board as any).project_id);
    if (!projectId) continue;
    const project = projectById.get(projectId);
    const boardState = (board as any).board_state;
    for (const comment of commentsFromBoardState(boardState)) {
      const commentId = text(comment.id);
      if (!commentId) continue;
      const taggedUserIds = Array.isArray(comment.taggedUserIds) ? comment.taggedUserIds : [];
      if (!taggedUserIds.includes(userId)) continue;
      const body = text(comment.body);
      if (!body) continue;
      const pageTitle = pageTitleForComment(boardState, text(comment.pageId));
      const targetLabel = targetLabelForComment(boardState, comment);
      const notes = commentTodoNotes({
        body,
        projectName: project?.name || "Project",
        pageTitle,
        targetLabel,
        createdByName: text(comment.createdByName),
        projectId,
        comment,
      });
      const existingTodo = existingTodoByCommentId.get(commentId);
      if (existingTodo) {
        if (typeof existingTodo.id === "string" && !String(existingTodo.notes ?? "").includes("Open comment:")) {
          noteUpdates.push({ id: existingTodo.id, notes });
        }
        continue;
      }
      rows.push({
        project_id: projectId,
        assigned_user_id: userId,
        title: `Design board comment: ${pageTitle}`,
        notes,
        priority: "normal",
        status: "open",
        created_by: text(comment.createdById) || null,
      });
      existingCommentIds.add(commentId);
    }
  }

  for (const update of noteUpdates) {
    const { error } = await supabaseAdmin
      .from("shared_project_todos" as any)
      .update({ notes: update.notes })
      .eq("id", update.id);
    if (error && !isMissingTable(error)) throw error;
  }

  if (!rows.length) return;

  const { error } = await supabaseAdmin.from("shared_project_todos" as any).insert(rows);
  if (error && !isMissingTable(error)) throw error;
}
