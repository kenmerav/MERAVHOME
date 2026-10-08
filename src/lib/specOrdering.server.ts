import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  canEditSpecBook,
  canUpdateSpecOrderingForRole,
  canViewProjectSurface,
  isSharedProjectRole,
  isStudioTeamRole,
} from "@/lib/permissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function updateSpecOrdering(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return json({ error: "Sign in to update ordering." }, 401);
  const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "Your session expired." }, 401);
  const body = await request.json().catch(() => null);
  if (
    !body ||
    !UUID.test(String(body.item_id)) ||
    Object.keys(body).some((key) => !["item_id", "ordered", "ordered_by"].includes(key))
  ) {
    return json({ error: "Choose a valid item and ordering status." }, 400);
  }
  const patch: { ordered?: boolean; ordered_by?: string | null } = {};
  if ("ordered" in body) {
    if (typeof body.ordered !== "boolean")
      return json({ error: "Ordered must be Yes or No." }, 400);
    patch.ordered = body.ordered;
  }
  if ("ordered_by" in body) {
    if (body.ordered_by !== null && !["Contractor", "Merav", "Client"].includes(body.ordered_by))
      return json({ error: "Choose who is ordering." }, 400);
    patch.ordered_by = body.ordered_by;
  }
  if (!Object.keys(patch).length) return json({ error: "Choose an ordering change." }, 400);
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.is_active) return json({ error: "This account is not active." }, 403);
  // The email exception uses the verified login identity, never browser-provided data.
  const actor = { ...profile, email: auth.user.email || "" };
  const { data: item, error: itemError } = await supabaseAdmin
    .from("material_items")
    .select("id,project_id")
    .eq("id", body.item_id)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item) return json({ error: "This item is not available to your account." }, 403);
  if (
    isSharedProjectRole(actor.role) ||
    (actor.role === "Employee" && actor.can_view_all_projects === false)
  ) {
    const { data: assignment, error } = await supabaseAdmin
      .from("user_project_assignments" as any)
      .select("project_id")
      .eq("user_id", auth.user.id)
      .eq("project_id", item.project_id)
      .maybeSingle();
    if (error) throw error;
    if (!assignment) return json({ error: "This item is not available to your account." }, 403);
  } else if (!isStudioTeamRole(actor.role)) {
    return json({ error: "This account cannot update ordering." }, 403);
  }
  const { data: project, error: projectError } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("id", item.project_id)
    .maybeSingle();
  if (projectError) throw projectError;
  if (
    !canViewProjectSurface(actor, project, "specBook") ||
    !(canEditSpecBook(actor) || canUpdateSpecOrderingForRole(actor, project))
  )
    return json({ error: "This account cannot update ordering on this project." }, 403);
  if ("ordered_by" in patch && !canEditSpecBook(actor))
    return json(
      { error: "This account can mark items ordered, but cannot change who is ordering." },
      403,
    );
  const { data: updated, error } = await supabaseAdmin
    .from("material_items")
    .update(patch)
    .eq("id", item.id)
    .eq("project_id", item.project_id)
    .select("id,ordered,ordered_by")
    .single();
  if (error) throw error;
  if (!updated)
    return json({ error: "Could not save ordering. Please refresh and try again." }, 409);
  return json({ item: updated });
}
