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

function sanitizeSharedPresentationState(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const state = value as Record<string, unknown>;
  const extraPages = Array.isArray(state.presentationExtraPages)
    ? state.presentationExtraPages
    : [];
  const slottedPageIds = new Set(
    extraPages
      .map((slot) =>
        slot && typeof slot === "object"
          ? (slot as Record<string, unknown>).boardPageId
          : null,
      )
      .filter((id): id is string => typeof id === "string" && Boolean(id)),
  );
  const pages = Array.isArray(state.pages)
    ? state.pages.filter((page) => {
        if (!page || typeof page !== "object") return false;
        const current = page as Record<string, unknown>;
        return (
          current.hidden !== true &&
          (current.presentationVisible === true ||
            (typeof current.id === "string" && slottedPageIds.has(current.id)))
        );
      })
    : [];

  return {
    pages,
    presentationExtraPages: extraPages,
    presentationSlideOrder: state.presentationSlideOrder,
    presentationHiddenSlideKeys: state.presentationHiddenSlideKeys,
    presentationRenderingOverrides: state.presentationRenderingOverrides,
    presentationHiddenSections: state.presentationHiddenSections,
    presentationSlidePicks: state.presentationSlidePicks,
  };
}

export const Route = createFileRoute("/api/presentation-board")({
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
            if (!sharedRole) return json({ error: "Presentation access is not available." }, 403);

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
                  .select(
                    "id,client_can_view_presentations,contractor_can_view_presentations",
                  )
                  .eq("id", projectId)
                  .maybeSingle(),
              ]);
            if (projectError) throw projectError;
            const presentationEnabled = isClientRole(profile.role)
              ? project?.client_can_view_presentations === true
              : project?.contractor_can_view_presentations === true;
            if (!assignment || !presentationEnabled) {
              return json({ error: "This presentation is not shared with your account." }, 403);
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
                : sanitizeSharedPresentationState(board.board_state),
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Could not load presentation settings.";
          console.error("[Presentation Board] Load failed", error);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
