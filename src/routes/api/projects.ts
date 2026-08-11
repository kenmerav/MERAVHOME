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
  if (userError || !userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email,role,is_active,is_owner")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!canManageStudio(profile)) {
    return { error: json({ error: "Only Ken and Katie can delete projects." }, 403) };
  }

  return { user: userData.user };
}

async function ensureOk<T>(result: { data: T; error: null } | { data: T | null; error: any }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export const Route = createFileRoute("/api/projects")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        try {
          const owner = await requireOwner(request);
          if ("error" in owner) return owner.error;

          const { project_id } = (await request.json()) as { project_id?: string };
          if (!project_id) return json({ error: "project_id required" }, 400);

          const project = await ensureOk(
            await supabaseAdmin.from("projects").select("id").eq("id", project_id).maybeSingle(),
          );
          if (!project) return json({ error: "Project not found." }, 404);

          const { data: rooms } = await supabaseAdmin.from("rooms").select("id").eq("project_id", project_id);
          const roomIds = (rooms ?? []).map((room) => room.id);

          const { data: roomProducts } = roomIds.length
            ? await supabaseAdmin.from("room_products").select("id").in("room_id", roomIds)
            : { data: [] };
          const roomProductIds = (roomProducts ?? []).map((roomProduct) => roomProduct.id);

          await ensureOk(await supabaseAdmin.from("financial_invoice_payments").delete().eq("project_id", project_id));
          await ensureOk(await supabaseAdmin.from("financial_invoices").delete().eq("project_id", project_id));
          await ensureOk(await supabaseAdmin.from("material_items").delete().eq("project_id", project_id));

          // Remove board history before the board itself. The board DELETE trigger archives a
          // final snapshot, which must run while its parent project still exists.
          await ensureOk(await supabaseAdmin.from("design_board_versions" as any).delete().eq("project_id", project_id));
          await ensureOk(await supabaseAdmin.from("design_boards" as any).delete().eq("project_id", project_id));

          if (roomProductIds.length) {
            await ensureOk(await supabaseAdmin.from("procurement_items").delete().in("room_product_id", roomProductIds));
          }

          if (roomIds.length) {
            await ensureOk(await supabaseAdmin.from("room_products").delete().in("room_id", roomIds));
            await ensureOk(await supabaseAdmin.from("materials").delete().in("room_id", roomIds));

            const { data: roomImages } = await supabaseAdmin.from("room_images").select("id").in("room_id", roomIds);
            const roomImageIds = (roomImages ?? []).map((image) => image.id);
            if (roomImageIds.length) {
              await ensureOk(await supabaseAdmin.from("room_images").update({ linked_sketchup_id: null }).in("linked_sketchup_id", roomImageIds));
            }
            await ensureOk(await supabaseAdmin.from("room_images").delete().in("room_id", roomIds));
            await ensureOk(await supabaseAdmin.from("rooms").delete().eq("project_id", project_id));
          }

          await ensureOk(await supabaseAdmin.from("projects").delete().eq("id", project_id));

          return json({ ok: true });
        } catch (e: any) {
          console.error("Delete project failed", e);
          return json({ error: e?.message || "Unable to delete project." }, 500);
        }
      },
    },
  },
});
