import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type BoardPage = {
  id?: string;
  title?: string;
  roomId?: string | null;
  elements?: unknown[];
};

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

function pageTitle(page: BoardPage, index: number) {
  const title = typeof page.title === "string" ? page.title.trim() : "";
  return title || `Design Board ${index + 1}`;
}

export const Route = createFileRoute("/api/extension/board-pages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      GET: async ({ request }) => {
        try {
          if (!isAuthorized(request)) {
            return json({ error: "Extension board page list is not authorized." }, 401);
          }

          const url = new URL(request.url);
          const projectId = url.searchParams.get("projectId")?.trim();
          if (!projectId) return json({ error: "Choose a Studio project first." }, 400);

          const { data: board, error } = await supabaseAdmin
            .from("design_boards" as any)
            .select("board_state")
            .eq("project_id", projectId)
            .maybeSingle();
          if (error) throw error;

          const state = (board as any)?.board_state;
          const rawPages = Array.isArray(state?.pages) ? (state.pages as BoardPage[]) : [];
          const pages = rawPages
            .map((page, index) => ({
              id: typeof page.id === "string" && page.id ? page.id : "",
              title: pageTitle(page, index),
              roomId: typeof page.roomId === "string" ? page.roomId : null,
              itemCount: Array.isArray(page.elements) ? page.elements.length : 0,
            }))
            .filter((page) => page.id);

          return json({
            selectedPageId:
              typeof state?.selectedPageId === "string" && pages.some((page) => page.id === state.selectedPageId)
                ? state.selectedPageId
                : pages[0]?.id || "",
            pages,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not load board pages.";
          console.error("[Extension Board Pages] Failed", error);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
