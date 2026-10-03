import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { realtimeTransport } from "@/integrations/supabase/realtimeTransport.server";
import { cleanUuid } from "@/lib/ids";
import { staleSpecBookMaterialIds, type BoardSourcedMaterial } from "@/lib/specBookSources";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export async function getSpecBookSourceStatus(request: Request) {
  const projectId = cleanUuid(new URL(request.url).searchParams.get("projectId"));
  if (!projectId) return json({ error: "Valid projectId required." }, 400);
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase configuration unavailable.");
    const authorization = request.headers.get("authorization");
    // Read only Materials the caller can already see, using existing RLS.
    // Anonymous public/QR links use the same policies as their current reads.
    const viewer = createClient(url, key, {
      global: { headers: authorization ? { Authorization: authorization } : {} },
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: realtimeTransport },
    });
    const items: BoardSourcedMaterial[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await viewer.from("material_items")
        .select("id,project_id,source_board_id,source_board_page_id,source_board_element_id")
        .eq("project_id", projectId).order("id").range(offset, offset + pageSize - 1);
      if (error) throw error;
      items.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
    if (!items.some((item) => item.source_board_id === projectId &&
      item.source_board_page_id && item.source_board_element_id)) return json({ staleMaterialIds: [] });
    // Board access remains private. Return only IDs of already-visible
    // Materials, never board pages, layer contents or product metadata.
    const { data: board, error } = await supabaseAdmin.from("design_boards" as any)
      .select("board_state").eq("project_id", projectId).maybeSingle();
    if (error) throw error;
    const state = (board as { board_state: unknown } | null)?.board_state;
    return json({ staleMaterialIds: staleSpecBookMaterialIds(projectId, items, state) });
  } catch (error) {
    console.error("[Spec Book] Source validation failed", error);
    return json({ error: "Could not check the current design selections. Please retry." }, 503);
  }
}

export const Route = createFileRoute("/api/spec-book-source-status")({
  server: { handlers: { GET: ({ request }) => getSpecBookSourceStatus(request) } },
});
