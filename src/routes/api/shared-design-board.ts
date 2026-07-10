import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanUuid } from "@/lib/ids";
import { isClientRole, isContractorRole, isStudioTeamRole } from "@/lib/permissions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

function sanitizeSharedDesignBoardState(value: unknown) {
  if (!value || typeof value !== "object") return { pages: [], selectedPageId: "" };
  const state = value as Record<string, unknown>;
  const pages = Array.isArray(state.pages)
    ? state.pages.filter(
        (page) =>
          page && typeof page === "object" && (page as Record<string, unknown>).hidden !== true,
      )
    : [];
  const selectedPageId =
    typeof state.selectedPageId === "string" &&
    pages.some((page) => (page as Record<string, unknown>).id === state.selectedPageId)
      ? state.selectedPageId
      : typeof (pages[0] as Record<string, unknown> | undefined)?.id === "string"
        ? ((pages[0] as Record<string, unknown>).id as string)
        : "";

  return { pages, selectedPageId };
}

export const Route = createFileRoute("/api/shared-design-board")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const projectId = cleanUuid(new URL(request.url).searchParams.get("projectId"));
          if (!projectId) return json({ error: "Valid projectId required." }, 400);

          const token = bearerToken(request);
          if (!token) return json({ error: "Sign in first." }, 401);
          const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
          if (userError || !userData.user) {
            return json({ error: "Your session is no longer valid." }, 401);
          }

          const { data: profile, error: profileError } = await supabaseAdmin
            .from("user_profiles")
            .select("id,role,is_active")
            .eq("id", userData.user.id)
            .maybeSingle();
          if (profileError) throw profileError;
          if (!profile?.is_active) return json({ error: "This account is not active." }, 403);

          const teamMember = isStudioTeamRole(profile.role);
          if (!teamMember) {
            const sharedRole = isClientRole(profile.role) || isContractorRole(profile.role);
            if (!sharedRole) return json({ error: "Design board access is not available." }, 403);

            const [{ data: assignment }, { data: project, error: projectError }] =
              await Promise.all([
                supabaseAdmin
                  .from("user_project_assignments")
                  .select("project_id")
                  .eq("user_id", userData.user.id)
                  .eq("project_id", projectId)
                  .maybeSingle(),
                supabaseAdmin
                  .from("projects")
                  .select("id,client_can_view_design_boards,contractor_can_view_design_boards")
                  .eq("id", projectId)
                  .maybeSingle(),
              ]);
            if (projectError) throw projectError;
            const designBoardsEnabled = isClientRole(profile.role)
              ? project?.client_can_view_design_boards === true
              : project?.contractor_can_view_design_boards === true;
            if (!assignment || !designBoardsEnabled) {
              return json({ error: "This design board is not shared with your account." }, 403);
            }
          }

          const { data: board, error: boardError } = await supabaseAdmin
            .from("design_boards")
            .select("project_id,board_state,updated_at")
            .eq("project_id", projectId)
            .maybeSingle();
          if (boardError) throw boardError;
          if (!board) return json({ board: null });

          return json({
            board: {
              ...board,
              board_state: teamMember
                ? board.board_state
                : sanitizeSharedDesignBoardState(board.board_state),
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Could not load design board.";
          console.error("[Shared Design Board] Load failed", error);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
