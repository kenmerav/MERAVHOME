import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canManageProjectAccess, canManageStudio } from "@/lib/permissions";
import { parseProjectAccessSettings } from "@/lib/projectAccess";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/project-access")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Sign in first." }, 401);

        const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !userData.user)
          return json({ error: "Your session is no longer valid." }, 401);

        const { data: profile, error: profileError } = await supabaseAdmin
          .from("user_profiles")
          .select("email,role,is_active,is_owner,can_view_all_projects")
          .eq("id", userData.user.id)
          .maybeSingle();
        if (profileError) return json({ error: "Unable to verify your access." }, 500);
        if (!canManageProjectAccess(profile)) {
          return json({ error: "You cannot manage project access." }, 403);
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid request." }, 400);
        }
        const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
        const settings = parseProjectAccessSettings(input.settings);
        if (!projectId || !settings)
          return json({ error: "Invalid project access settings." }, 400);

        if (!canManageStudio(profile) && profile?.can_view_all_projects === false) {
          // This table exists in production but is absent from the generated Supabase types.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: assignment, error: assignmentError } = await (supabaseAdmin as any)
            .from("user_project_assignments")
            .select("project_id")
            .eq("user_id", userData.user.id)
            .eq("project_id", projectId)
            .maybeSingle();
          if (assignmentError) return json({ error: "Unable to verify project assignment." }, 500);
          if (!assignment) return json({ error: "You do not have access to this project." }, 403);
        }

        const { data: project, error: updateError } = await supabaseAdmin
          .from("projects")
          .update(settings)
          .eq("id", projectId)
          .select("id")
          .maybeSingle();
        if (updateError) return json({ error: "Unable to update project access." }, 500);
        if (!project) return json({ error: "Project not found." }, 404);
        return json({ ok: true });
      },
    },
  },
});
