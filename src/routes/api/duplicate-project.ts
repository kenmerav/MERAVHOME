/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canManageStudio } from "@/lib/permissions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireOwner(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in as the overall admin first." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: json({ error: "Your session is no longer valid." }, 401) };
  }

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email,role,is_active,is_owner")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!canManageStudio(profile)) {
    return { error: json({ error: "Only Ken and Katie can duplicate projects." }, 403) };
  }

  return { user: userData.user };
}

async function expectData<T>(result: { data: T | null; error: any }, label: string): Promise<T> {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.data == null) throw new Error(`${label}: no data returned`);
  return result.data;
}

async function expectRows<T>(
  result: { data: T[] | null; error: any },
  label: string,
): Promise<T[]> {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

function withoutSystemFields<T extends Record<string, any>>(row: T, extra: string[] = []) {
  const omitted = new Set(["id", "created_at", "updated_at", ...extra]);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !omitted.has(key)));
}

function remapReferences(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapReferences(item, ids));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        remapReferences(item, ids),
      ]),
    );
  }
  return value;
}

async function insertRows(table: string, rows: Record<string, unknown>[], label: string) {
  if (!rows.length) return;
  const chunkSize = 200;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const result = await supabaseAdmin
      .from(table as any)
      .insert(rows.slice(index, index + chunkSize) as any);
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
  }
}

async function duplicateProject(sourceProjectId: string, name: string, clientName: string) {
  const sourceProject = await expectData(
    await supabaseAdmin.from("projects").select("*").eq("id", sourceProjectId).maybeSingle(),
    "Source project",
  );

  const newProjectId = crypto.randomUUID();
  const projectCopy = withoutSystemFields(sourceProject as any, [
    "last_opened_at",
    "is_pinned",
    "accepted_date",
    "promised_completion_date",
    "forecast_completion_date",
    "progress_override",
    "health_override",
    "health_override_reason",
  ]);

  Object.assign(projectCopy, {
    id: newProjectId,
    name,
    client_name: clientName,
    status: "Design",
    approval_live: false,
    client_can_view_spec_book: false,
    client_can_view_presentations: false,
    client_can_view_design_boards: false,
    client_can_view_construction_docs: false,
    client_can_download_construction_docs: false,
    client_can_download_spec_book_pdf: false,
    contractor_can_view_spec_book: false,
    contractor_can_view_presentations: false,
    contractor_can_view_design_boards: false,
    contractor_can_view_construction_docs: false,
    contractor_can_download_spec_book_pdf: false,
    contractor_spec_can_update_ordering: false,
  });

  await expectData(
    await supabaseAdmin
      .from("projects")
      .insert(projectCopy as any)
      .select("id")
      .single(),
    "Create duplicate project",
  );

  try {
    const sourceRooms = await expectRows(
      await supabaseAdmin.from("rooms").select("*").eq("project_id", sourceProjectId),
      "Load rooms",
    );
    const roomIds = sourceRooms.map((room: any) => room.id);
    const ids = new Map<string, string>([[sourceProjectId, newProjectId]]);
    sourceRooms.forEach((room: any) => ids.set(room.id, crypto.randomUUID()));

    const [
      sourceBoardResult,
      materialItemsResult,
      materialsResult,
      roomProductsResult,
      roomImagesResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("design_boards")
        .select("*")
        .eq("project_id", sourceProjectId)
        .maybeSingle(),
      supabaseAdmin.from("material_items").select("*").eq("project_id", sourceProjectId),
      roomIds.length
        ? supabaseAdmin.from("materials").select("*").in("room_id", roomIds)
        : Promise.resolve({ data: [], error: null }),
      roomIds.length
        ? supabaseAdmin.from("room_products").select("*").in("room_id", roomIds)
        : Promise.resolve({ data: [], error: null }),
      roomIds.length
        ? supabaseAdmin.from("room_images").select("*").in("room_id", roomIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (sourceBoardResult.error)
      throw new Error(`Load design board: ${sourceBoardResult.error.message}`);
    const sourceMaterialItems = await expectRows(materialItemsResult as any, "Load material items");
    const sourceMaterials = await expectRows(materialsResult as any, "Load room materials");
    const sourceRoomProducts = await expectRows(roomProductsResult as any, "Load room products");
    const sourceRoomImages = await expectRows(roomImagesResult as any, "Load room images");

    sourceMaterialItems.forEach((row: any) => ids.set(row.id, crypto.randomUUID()));
    sourceMaterials.forEach((row: any) => ids.set(row.id, crypto.randomUUID()));
    sourceRoomProducts.forEach((row: any) => ids.set(row.id, crypto.randomUUID()));
    sourceRoomImages.forEach((row: any) => ids.set(row.id, crypto.randomUUID()));

    if (sourceBoardResult.data) {
      await insertRows(
        "design_boards",
        [
          {
            project_id: newProjectId,
            board_state: remapReferences(sourceBoardResult.data.board_state, ids),
            updated_by: null,
          },
        ],
        "Copy design board",
      );
    }

    await insertRows(
      "rooms",
      sourceRooms.map((room: any) => ({
        ...withoutSystemFields(room, [
          "presentation_palette_item_ids",
          "presentation_cabinet_item_id",
          "presentation_counter_item_id",
          "presentation_faucet_item_id",
          "presentation_rendering_image_id",
          "presentation_sketchup_image_id",
        ]),
        id: ids.get(room.id),
        project_id: newProjectId,
      })),
      "Copy rooms",
    );

    await insertRows(
      "material_items",
      sourceMaterialItems.map((row: any) => ({
        ...withoutSystemFields(row, ["ordered_by", "ordered"]),
        id: ids.get(row.id),
        room_id: ids.get(row.room_id),
        project_id: newProjectId,
        source_board_id: row.source_board_id ? (ids.get(row.source_board_id) ?? null) : null,
        ordered_by: null,
        ordered: false,
      })),
      "Copy material items",
    );

    await insertRows(
      "materials",
      sourceMaterials.map((row: any) => ({
        ...withoutSystemFields(row),
        id: ids.get(row.id),
        room_id: ids.get(row.room_id),
      })),
      "Copy room materials",
    );

    await insertRows(
      "room_products",
      sourceRoomProducts.map((row: any) => ({
        ...withoutSystemFields(row, [
          "approved",
          "approval_status",
          "approval_comment",
          "approval_updated_at",
          "approval_visible",
        ]),
        id: ids.get(row.id),
        room_id: ids.get(row.room_id),
        approved: false,
        approval_status: "undecided",
        approval_comment: null,
        approval_updated_at: null,
        approval_visible: false,
      })),
      "Copy room products",
    );

    await insertRows(
      "room_images",
      sourceRoomImages.map((row: any) => ({
        ...withoutSystemFields(row, [
          "linked_sketchup_id",
          "revision_parent_id",
          "error_message",
          "is_approved",
          "review_status",
        ]),
        id: ids.get(row.id),
        room_id: ids.get(row.room_id),
        linked_sketchup_id: row.linked_sketchup_id
          ? (ids.get(row.linked_sketchup_id) ?? null)
          : null,
        revision_parent_id: row.revision_parent_id
          ? (ids.get(row.revision_parent_id) ?? null)
          : null,
        error_message: null,
        is_approved: false,
        review_status: "draft",
      })),
      "Copy room images",
    );

    for (const room of sourceRooms as any[]) {
      const patch = {
        presentation_palette_item_ids: remapReferences(room.presentation_palette_item_ids, ids),
        presentation_cabinet_item_id: room.presentation_cabinet_item_id
          ? (ids.get(room.presentation_cabinet_item_id) ?? null)
          : null,
        presentation_counter_item_id: room.presentation_counter_item_id
          ? (ids.get(room.presentation_counter_item_id) ?? null)
          : null,
        presentation_faucet_item_id: room.presentation_faucet_item_id
          ? (ids.get(room.presentation_faucet_item_id) ?? null)
          : null,
        presentation_rendering_image_id: room.presentation_rendering_image_id
          ? (ids.get(room.presentation_rendering_image_id) ?? null)
          : null,
        presentation_sketchup_image_id: room.presentation_sketchup_image_id
          ? (ids.get(room.presentation_sketchup_image_id) ?? null)
          : null,
      };
      const result = await supabaseAdmin
        .from("rooms")
        .update(patch as any)
        .eq("id", ids.get(room.id)!);
      if (result.error) throw new Error(`Copy room presentation settings: ${result.error.message}`);
    }

    const [documents, timelines, owners, milestones] = await Promise.all([
      expectRows(
        supabaseAdmin
          .from("project_documents" as any)
          .select("*")
          .eq("project_id", sourceProjectId) as any,
        "Load project documents",
      ),
      expectRows(
        supabaseAdmin
          .from("project_timelines" as any)
          .select("*")
          .eq("project_id", sourceProjectId) as any,
        "Load project timeline",
      ),
      expectRows(
        supabaseAdmin
          .from("project_management_owners" as any)
          .select("*")
          .eq("project_id", sourceProjectId) as any,
        "Load project owners",
      ),
      expectRows(
        supabaseAdmin
          .from("project_milestones" as any)
          .select("*")
          .eq("project_id", sourceProjectId) as any,
        "Load project milestones",
      ),
    ]);

    await insertRows(
      "project_documents",
      (documents as any[]).map((row) => ({
        ...withoutSystemFields(row),
        id: crypto.randomUUID(),
        project_id: newProjectId,
        visible_to_contractors: false,
        visible_to_clients: false,
      })),
      "Copy project documents",
    );
    await insertRows(
      "project_timelines",
      (timelines as any[]).map((row) => ({
        ...withoutSystemFields(row),
        id: crypto.randomUUID(),
        project_id: newProjectId,
        project_name: name,
        client_name: clientName,
        client_visible: false,
      })),
      "Copy project timeline",
    );
    await insertRows(
      "project_management_owners",
      (owners as any[]).map((row) => ({
        project_id: newProjectId,
        user_id: row.user_id,
      })),
      "Copy project owners",
    );

    const milestoneIds = new Map<string, string>();
    (milestones as any[]).forEach((row) => milestoneIds.set(row.id, crypto.randomUUID()));
    await insertRows(
      "project_milestones",
      (milestones as any[]).map((row) => ({
        ...withoutSystemFields(row, ["target_date", "completed_at"]),
        id: milestoneIds.get(row.id),
        project_id: newProjectId,
        status: "pending",
        target_date: null,
        completed_at: null,
      })),
      "Copy project milestones",
    );

    if (milestoneIds.size) {
      const dependencies = await expectRows(
        await supabaseAdmin
          .from("project_milestone_dependencies" as any)
          .select("*")
          .in("milestone_id", Array.from(milestoneIds.keys())),
        "Load milestone dependencies",
      );
      await insertRows(
        "project_milestone_dependencies",
        (dependencies as any[])
          .filter(
            (row) =>
              milestoneIds.has(row.milestone_id) && milestoneIds.has(row.depends_on_milestone_id),
          )
          .map((row) => ({
            milestone_id: milestoneIds.get(row.milestone_id),
            depends_on_milestone_id: milestoneIds.get(row.depends_on_milestone_id),
          })),
        "Copy milestone dependencies",
      );
    }

    return {
      id: newProjectId,
      name,
      counts: {
        rooms: sourceRooms.length,
        material_items: sourceMaterialItems.length,
        room_products: sourceRoomProducts.length,
        room_images: sourceRoomImages.length,
        documents: (documents as any[]).length,
      },
    };
  } catch (error) {
    await supabaseAdmin
      .from("design_board_versions" as any)
      .delete()
      .eq("project_id", newProjectId);
    await supabaseAdmin.from("design_boards").delete().eq("project_id", newProjectId);
    await supabaseAdmin.from("projects").delete().eq("id", newProjectId);
    throw error;
  }
}

export const Route = createFileRoute("/api/duplicate-project")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const owner = await requireOwner(request);
          if ("error" in owner) return owner.error;

          const body = (await request.json()) as {
            source_project_id?: string;
            name?: string;
            client_name?: string;
          };
          const sourceProjectId = body.source_project_id?.trim();
          const name = body.name?.trim();
          const clientName = body.client_name?.trim();
          if (!sourceProjectId || !name || !clientName) {
            return json({ error: "Source project, project name, and client are required." }, 400);
          }

          return json({ project: await duplicateProject(sourceProjectId, name, clientName) });
        } catch (error: any) {
          console.error("Duplicate project failed", error);
          return json({ error: "Unable to duplicate project. No duplicate was saved." }, 500);
        }
      },
    },
  },
});
