/* eslint-disable @typescript-eslint/no-explicit-any -- Room Design pilot tables are server-only until generated Supabase types include the migration. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createDefaultRoomDesignWorkflowState,
  normalizeRoomDesignWorkflowState,
} from "@/lib/roomDesignWorkflow";

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
  return header.replace(/^Bearer\s+/i, "").trim() === configuredToken;
}

function workflowState(roomName: string, value: unknown) {
  const initial = createDefaultRoomDesignWorkflowState(roomName);
  const { version: _version, updatedAt: _updatedAt, ...fallback } = initial;
  const normalized = normalizeRoomDesignWorkflowState(value, fallback);
  return normalized.links.length ? normalized : initial;
}

export const Route = createFileRoute("/api/extension/room-design")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      GET: async ({ request }) => {
        try {
          if (!isAuthorized(request)) {
            return json({ error: "Extension Room Design access is not authorized." }, 401);
          }
          const url = new URL(request.url);
          const projectId = url.searchParams.get("projectId")?.trim() || "";
          const requestedRoomId = url.searchParams.get("roomId")?.trim() || "";
          if (!projectId) return json({ error: "Choose a Studio project first." }, 400);

          const [{ data: featureFlag }, { data: enrollment }, { data: rooms, error: roomsError }] =
            await Promise.all([
              supabaseAdmin
                .from("studio_feature_flags" as any)
                .select("enabled")
                .eq("key", "room_design_v2")
                .maybeSingle(),
              supabaseAdmin
                .from("room_design_projects" as any)
                .select("project_id")
                .eq("project_id", projectId)
                .maybeSingle(),
              supabaseAdmin
                .from("rooms")
                .select("id,name,sort_order")
                .eq("project_id", projectId)
                .order("sort_order", { ascending: true }),
            ]);
          if (roomsError) throw roomsError;
          if ((featureFlag as any)?.enabled !== true || !enrollment) {
            return json({ error: "This project is not using the new Room Design process." }, 403);
          }

          const roomRows = (rooms ?? []) as Array<{ id: string; name: string; sort_order: number }>;
          const selectedRoom =
            roomRows.find((room) => room.id === requestedRoomId) ?? roomRows[0] ?? null;
          if (!selectedRoom) return json({ rooms: [], selectedRoomId: "", items: [] });

          const { data: workflow, error: workflowError } = await supabaseAdmin
            .from("room_design_workflows" as any)
            .select("state")
            .eq("project_id", projectId)
            .eq("room_id", selectedRoom.id)
            .maybeSingle();
          if (workflowError) throw workflowError;

          const state = workflowState(selectedRoom.name, (workflow as any)?.state);
          const selectionsById = new Map(
            state.selections.map((selection) => [selection.id.replace(/^link-/, ""), selection]),
          );
          const items = state.links.map((item) => {
            const selection = selectionsById.get(item.id);
            return {
              id: item.id,
              label: item.category,
              filled: Boolean(selection && selection.state !== "draft"),
              productName: selection?.productName || item.catalogProductName || "",
              quantity: selection?.quantity || item.quantity || 1,
            };
          });

          return json({
            rooms: roomRows.map((room) => ({ id: room.id, name: room.name })),
            selectedRoomId: selectedRoom.id,
            items,
            openUrl: `/projects/${projectId}/room-design?roomId=${selectedRoom.id}`,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not load Room Design.";
          console.error("[Extension Room Design] Failed", error);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
