import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function isAuthorized(request: Request) {
  const configuredToken = process.env.MERAV_EXTENSION_TOKEN;
  if (!configuredToken) {
    throw new Error("MERAV_EXTENSION_TOKEN is not configured in Studio.");
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return Boolean(token && token === configuredToken);
}

export const Route = createFileRoute("/api/extension/projects")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      GET: async ({ request }) => {
        try {
          if (!isAuthorized(request)) {
            return json({ error: "Extension project list is not authorized." }, 401);
          }

          const { data, error } = await supabaseAdmin
            .from("projects")
            .select("id,name,client_name,status,updated_at")
            .order("updated_at", { ascending: false });
          if (error) throw error;

          const projects = (data ?? [])
            .map((project) => ({
              id: project.id,
              name: project.name,
              clientName: project.client_name,
              status: project.status,
              archived: project.status === "Complete",
            }))
            .sort((a, b) => Number(a.archived) - Number(b.archived));

          return json({ projects });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not load projects.";
          console.error("[Extension Projects] Failed", error);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
