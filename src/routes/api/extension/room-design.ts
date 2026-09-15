/* eslint-disable @typescript-eslint/no-explicit-any -- Room Design pilot tables are server-only until generated Supabase types include the migration. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  addCustomRoomDesignProductType,
  createDefaultRoomDesignWorkflowState,
  normalizeRoomDesignWorkflowState,
  reconcileRoomDesignChecklist,
  roomDesignRoomNamesMatch,
} from "@/lib/roomDesignWorkflow";
import { randomUUID } from "node:crypto";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  return reconcileRoomDesignChecklist(normalized.links.length ? normalized : initial, roomName);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

async function verifyRoomDesignProject(projectId: string, roomId: string, expectedRoomName = "") {
  const [{ data: featureFlag }, { data: enrollment }, { data: room, error: roomError }] =
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
        .select("id,name")
        .eq("id", roomId)
        .eq("project_id", projectId)
        .maybeSingle(),
    ]);
  if (roomError) throw roomError;
  if ((featureFlag as any)?.enabled !== true || !enrollment) {
    throw new Error("This project is not using the new Room Design process.");
  }
  if (!room) throw new Error("That room does not belong to the selected project.");
  if (!roomDesignRoomNamesMatch(expectedRoomName, cleanText((room as any).name))) {
    throw new Error(
      `Room selection changed. Reopen the extension and choose ${expectedRoomName} again.`,
    );
  }
  return room as { id: string; name: string };
}

async function saveCustomProductType(
  projectId: string,
  roomId: string,
  roomName: string,
  label: string,
) {
  const room = await verifyRoomDesignProject(projectId, roomId, roomName);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: workflow, error } = await supabaseAdmin
      .from("room_design_workflows" as any)
      .select("id,state,updated_at")
      .eq("project_id", projectId)
      .eq("room_id", roomId)
      .maybeSingle();
    if (error) throw error;

    const currentState = workflowState(room.name, (workflow as any)?.state);
    const result = addCustomRoomDesignProductType({
      state: currentState,
      label,
      itemId: `custom-${randomUUID()}`,
    });
    if (!result.added) return result;

    if (!workflow) {
      const { error: insertError } = await supabaseAdmin
        .from("room_design_workflows" as any)
        .insert({
          project_id: projectId,
          room_id: roomId,
          version: 1,
          state: result.state,
          updated_by: null,
        } as any);
      if (insertError && /duplicate key|already exists/i.test(insertError.message)) continue;
      if (insertError) throw insertError;
    } else {
      const { data: saved, error: updateError } = await supabaseAdmin
        .from("room_design_workflows" as any)
        .update({ state: result.state, updated_by: null } as any)
        .eq("id", (workflow as any).id)
        .eq("updated_at", (workflow as any).updated_at)
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!saved) continue;
    }

    await supabaseAdmin.from("room_design_events" as any).insert({
      project_id: projectId,
      room_id: roomId,
      event_type: "extension_product_type_added",
      details: { productTypeKey: result.item.id, productTypeLabel: result.item.category },
      created_by: null,
    } as any);
    return result;
  }
  throw new Error("Room Design changed at the same time. Try adding the product type again.");
}

export const Route = createFileRoute("/api/extension/room-design")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        try {
          if (!isAuthorized(request)) {
            return json({ error: "Extension Room Design access is not authorized." }, 401);
          }
          const payload = (await request.json()) as Record<string, unknown>;
          const projectId = cleanText(payload.projectId);
          const roomId = cleanText(payload.roomId);
          const roomName = cleanText(payload.roomName);
          const label = cleanText(payload.productTypeLabel);
          if (!projectId) return json({ error: "Choose a Studio project first." }, 400);
          if (!roomId) return json({ error: "Choose a room first." }, 400);
          if (!label) return json({ error: "Enter a product type name." }, 400);
          if (label.length > 80) {
            return json({ error: "Product type names must be 80 characters or fewer." }, 400);
          }

          const result = await saveCustomProductType(projectId, roomId, roomName, label);
          return json({
            item: {
              id: result.item.id,
              label: result.item.category,
              filled: false,
              productName: "",
              quantity: result.item.quantity,
            },
            roomName,
            added: result.added,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Could not add the product type.";
          console.error("[Extension Room Design] Add product type failed", error);
          return json({ error: message }, 500);
        }
      },
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
          if (requestedRoomId && !roomRows.some((room) => room.id === requestedRoomId)) {
            return json(
              { error: "That saved room is no longer available. Choose the room again." },
              409,
            );
          }
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
            selectedRoomName: selectedRoom.name,
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
