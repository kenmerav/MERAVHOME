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
