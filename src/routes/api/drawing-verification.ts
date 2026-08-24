import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type BoardElement = {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  notes?: string;
  text?: string;
  src?: string;
  link?: string;
  productId?: string | null;
  productName?: string | null;
  finish?: string | null;
  materialItemId?: string | null;
  materialRoomId?: string | null;
  materialCategory?: string | null;
  materialQuantity?: number | null;
  materialFinish?: string | null;
  materialDimensions?: string | null;
};

type BoardPage = {
  id?: string;
  title?: string;
  roomId?: string | null;
  hidden?: boolean;
  roomApprovalStatus?: "approved" | "declined" | null;
  elements?: BoardElement[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

function isAuthorized(request: Request) {
  const configured = process.env.STUDIO_DRAWING_READ_TOKEN?.trim();
  const supplied = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!configured || !supplied) return false;
  const expectedBytes = Buffer.from(configured);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function approvedBoardPages(boardState: unknown) {
  const state = boardState as { pages?: BoardPage[] } | null;
  const pages = Array.isArray(state?.pages) ? state.pages : [];
  return pages
    .filter((page) => page.roomApprovalStatus === "approved" && !page.hidden)
    .map((page, index) => ({
      id: typeof page.id === "string" ? page.id : `page-${index + 1}`,
      title: typeof page.title === "string" && page.title.trim() ? page.title.trim() : `Design Board ${index + 1}`,
      roomId: typeof page.roomId === "string" ? page.roomId : null,
      approvalStatus: "approved" as const,
      elements: (Array.isArray(page.elements) ? page.elements : []).map((element) => ({
        id: element.id ?? null,
        type: element.type ?? null,
        x: element.x ?? null,
        y: element.y ?? null,
        width: element.width ?? null,
        height: element.height ?? null,
        label: element.label ?? null,
        notes: element.notes ?? null,
        text: element.text ?? null,
        imageUrl: element.src ?? null,
        productUrl: element.link ?? null,
        productId: element.productId ?? null,
        productName: element.productName ?? null,
        finish: element.finish ?? element.materialFinish ?? null,
        materialItemId: element.materialItemId ?? null,
        materialRoomId: element.materialRoomId ?? null,
        category: element.materialCategory ?? null,
        quantity: element.materialQuantity ?? null,
        dimensions: element.materialDimensions ?? null,
      })),
    }));
}

async function listProjects() {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id,name,client_name,status,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    clientName: project.client_name,
    status: project.status,
    updatedAt: project.updated_at,
  }));
}

async function projectSnapshot(projectId: string) {
  const [{ data: project, error: projectError }, roomsResult, itemsResult, boardResult] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("id,name,client_name,status,updated_at,design_concept,design_notes")
      .eq("id", projectId)
      .maybeSingle(),
    supabaseAdmin
      .from("rooms")
      .select("id,name,sort_order,cover_image_url,design_concept,design_notes,updated_at")
      .eq("project_id", projectId)
      .order("sort_order"),
    supabaseAdmin
      .from("material_items")
      .select("id,room_id,category,item_label,cad_label,client_product_name,color,quantity,notes,product_url,image_url,sort_order,updated_at,product:products(id,name,vendor,finish,dimensions,sku,description,notes,image_url,product_url)")
      .eq("project_id", projectId)
      .eq("not_needed", false)
      .order("sort_order"),
    supabaseAdmin
      .from("design_boards" as never)
      .select("board_state,updated_at")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);
  if (projectError) throw projectError;
  if (!project) return null;
  if (roomsResult.error) throw roomsResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (boardResult.error) throw boardResult.error;

  const roomIds = (roomsResult.data ?? []).map((room) => room.id);
  const imagesResult = roomIds.length
    ? await supabaseAdmin
        .from("room_images")
        .select("id,room_id,kind,url,caption,review_status,is_approved,revision_notes,role,created_at")
        .in("room_id", roomIds)
        .or("is_approved.eq.true,review_status.eq.approved")
    : { data: [], error: null };
  if (imagesResult.error) throw imagesResult.error;

  const board = boardResult.data as unknown as { board_state?: unknown; updated_at?: string } | null;
  return {
    snapshotVersion: new Date().toISOString(),
    source: "MERAV Studio read-only drawing endpoint",
    project: {
      id: project.id,
      name: project.name,
      clientName: project.client_name,
      status: project.status,
      designConcept: project.design_concept,
      designNotes: project.design_notes,
      updatedAt: project.updated_at,
    },
    rooms: roomsResult.data ?? [],
    items: itemsResult.data ?? [],
    approvedRoomImages: imagesResult.data ?? [],
    approvedBoardPages: approvedBoardPages(board?.board_state),
    boardUpdatedAt: board?.updated_at ?? null,
  };
}

export const Route = createFileRoute("/api/drawing-verification")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          if (!isAuthorized(request)) return json({ error: "Drawing verification access is not authorized." }, 401);
          const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
          if (!projectId) return json({ projects: await listProjects() });
          if (!validUuid(projectId)) return json({ error: "Choose a valid Studio project." }, 400);
          const snapshot = await projectSnapshot(projectId);
          return snapshot ? json(snapshot) : json({ error: "Studio project not found." }, 404);
        } catch (error) {
          console.error("[Drawing Verification] Read failed", error);
          return json({ error: error instanceof Error ? error.message : "Studio drawing data could not be loaded." }, 500);
        }
      },
    },
  },
});
