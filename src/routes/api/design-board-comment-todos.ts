import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isStudioTeamRole } from "@/lib/permissions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)),
  );
}

function isMissingTable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "42P01";
}

export const Route = createFileRoute("/api/design-board-comment-todos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization");
          const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
          if (!token) return json({ error: "Sign in to assign comment to-dos." }, 401);

          const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
          if (userError || !userData.user) return json({ error: "Your session is no longer valid." }, 401);

          const { data: profile } = await supabaseAdmin
            .from("user_profiles")
            .select("id,email,full_name,role,is_active")
            .eq("id", userData.user.id)
            .maybeSingle();

          if (!profile?.is_active || !isStudioTeamRole(profile.role)) {
            return json({ error: "Only admin and employee accounts can assign board comments." }, 403);
          }

          const body = await request.json();
          const projectId = cleanText(body.projectId);
          const commentId = cleanText(body.commentId);
          const pageTitle = cleanText(body.pageTitle) || "Design Board";
          const targetLabel = cleanText(body.targetLabel) || "Board item";
          const comment = cleanText(body.comment);
          const taggedUserIds = cleanIds(body.taggedUserIds);

          if (!projectId || !comment || taggedUserIds.length === 0) {
            return json({ error: "Project, comment, and tagged users are required." }, 400);
          }

          const { data: project } = await supabaseAdmin
            .from("projects")
            .select("id,name")
            .eq("id", projectId)
            .maybeSingle();

          if (!project) return json({ error: "Project not found." }, 404);

          const { data: taggedUsers, error: taggedUsersError } = await supabaseAdmin
            .from("user_profiles")
            .select("id,email,full_name,role,is_active")
            .in("id", taggedUserIds)
            .eq("is_active", true)
            .in("role", ["Admin", "Employee"]);

          if (taggedUsersError) return json({ error: taggedUsersError.message }, 500);

          const validUserIds = new Set((taggedUsers ?? []).map((user: any) => user.id));
          const rows = taggedUserIds
            .filter((userId) => validUserIds.has(userId))
            .map((userId) => ({
              project_id: projectId,
              assigned_user_id: userId,
              title: `Design board comment: ${pageTitle}`,
              notes: [
                comment,
                "",
                `Project: ${project.name}`,
                `Page: ${pageTitle}`,
                `Item: ${targetLabel}`,
                `From: ${profile.full_name || profile.email || "MERAV teammate"}`,
                `Open board: /projects/${projectId}/design-boards`,
                commentId ? `Comment ID: ${commentId}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              priority: "normal",
              status: "open",
              created_by: userData.user.id,
            }));

          if (!rows.length) return json({ todos: [] });

          const { data, error } = await supabaseAdmin
            .from("shared_project_todos" as any)
            .insert(rows)
            .select("*");

          if (error) {
            if (isMissingTable(error)) return json({ error: "Project to-dos are not set up yet." }, 503);
            return json({ error: error.message }, 500);
          }

          return json({ todos: data ?? [] });
        } catch (error) {
          console.error("Create design board comment to-dos failed", error);
          return json({ error: "Could not assign comment to-dos." }, 500);
        }
      },
    },
  },
});
