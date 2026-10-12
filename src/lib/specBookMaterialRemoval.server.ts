import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanUuid } from "@/lib/ids";
import { isStudioTeamRole } from "@/lib/permissions";

const admin = supabaseAdmin as any;
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function setSpecBookMaterialRemoved(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return json({ error: "Sign in to remove a project item." }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "Your session expired." }, 401);
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role,is_active,can_view_all_projects").eq("id", auth.user.id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.is_active || !isStudioTeamRole(profile.role))
    return json({ error: "Only Studio staff can remove project items." }, 403);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !["project_id", "item_id", "removed"].includes(key)) ||
      typeof body.removed !== "boolean")
    return json({ error: "Choose a valid project item." }, 400);
  const projectId = cleanUuid(body.project_id), itemId = cleanUuid(body.item_id);
  if (!projectId || !itemId) return json({ error: "Choose a valid project item." }, 400);
  if (profile.role === "Employee" && profile.can_view_all_projects === false) {
    const { data: assignment, error } = await admin.from("user_project_assignments")
      .select("project_id").eq("user_id", auth.user.id).eq("project_id", projectId).maybeSingle();
    if (error) throw error;
    if (!assignment) return json({ error: "This project is not assigned to you." }, 403);
  }
  // Match both IDs so this action cannot remove a selection from another project.
  // Preserve the catalog row, board references and ordering history for Undo.
  const { data, error } = await admin.from("material_items")
    .update({ not_needed: body.removed })
    .eq("id", itemId).eq("project_id", projectId)
    .select("id,not_needed").maybeSingle();
  if (error) throw error;
  if (!data) return json({ error: "This project item is no longer available." }, 404);
  return json({ item_id: data.id, removed: data.not_needed });
}
