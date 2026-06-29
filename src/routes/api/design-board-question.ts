import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canViewProjectSurface } from "@/lib/permissions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isMissingTable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "42P01";
}

export const Route = createFileRoute("/api/design-board-question")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization");
          const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
          if (!token) return json({ error: "Sign in to send a question." }, 401);

          const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
          if (userError || !userData.user) return json({ error: "Your session is no longer valid." }, 401);

          const { data: profile } = await supabaseAdmin
            .from("user_profiles")
            .select("*")
            .eq("id", userData.user.id)
            .maybeSingle();

          if (!profile?.is_active || profile.role !== "Contractor") {
            return json({ error: "Only builder/GC users can send board questions from this view." }, 403);
          }

          const body = await request.json();
          const projectId = cleanText(body.projectId);
          const pageTitle = cleanText(body.pageTitle) || "Design Board";
          const question = cleanText(body.question);
          if (!projectId || !question) return json({ error: "Project and question are required." }, 400);

          const { data: project } = await supabaseAdmin
            .from("projects")
            .select("*")
            .eq("id", projectId)
            .maybeSingle();

          if (!project || !canViewProjectSurface(profile, project, "designBoards")) {
            return json({ error: "Design boards are not shared for this project." }, 403);
          }

          const author = profile.full_name || profile.email || "Builder/GC";
          const notes = [
            question,
            "",
            `From: ${author}`,
            `Page: ${pageTitle}`,
            `Board: /projects/${projectId}/design-boards`,
          ].join("\n");

          const { data, error } = await supabaseAdmin
            .from("studio_reminders")
            .insert({
              project_id: projectId,
              title: `Builder question: ${pageTitle}`,
              notes,
              priority: "normal",
              assigned_to: "studio",
              status: "open",
              created_by: userData.user.id,
            } as any)
            .select()
            .single();

          if (error) {
            if (isMissingTable(error)) {
              return json({ error: "Studio reminders are not set up yet." }, 500);
            }
            return json({ error: error.message }, 500);
          }

          return json({ reminder: data });
        } catch (error) {
          console.error("Create design board question failed", error);
          return json({ error: "Could not send question." }, 500);
        }
      },
    },
  },
});
