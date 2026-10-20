import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { UserProfile } from "@/lib/db";
import { canUseRoomDesign, canUseRenderingStudio } from "@/lib/permissions";

function json(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function requireRoomDesignPilotAccess(
  request: Request,
  scope?: { projectId?: string | null; roomId?: string | null; rendering?: boolean },
) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!token) return { error: json("Sign in to use the Room Design pilot.", 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: json("Your Studio session is no longer valid.", 401) };
  }

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id,email,role,is_active,is_owner,can_view_all_projects")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (userData.user.is_anonymous || !canUseRoomDesign(profile as UserProfile | null)) {
    return {
      error: json("Room Design is available to active Studio designers and administrators.", 403),
    };
  }
  if (
    scope?.rendering &&
    (!canUseRenderingStudio(profile as UserProfile | null) ||
      userData.user.email?.trim().toLowerCase() !== "ken@meravinteriors.com")
  )
    return {
      error: json(
        "Rendering testing is currently available only to Ken’s active Studio account.",
        403,
      ),
    };

  const { data: flag, error: flagError } = await supabaseAdmin
    // Generated client types are updated only after the reviewed migration is applied.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("studio_feature_flags" as any)
    .select("enabled")
    .eq("key", "room_design_v2")
    .maybeSingle();
  if (flagError || (flag as { enabled?: boolean } | null)?.enabled !== true) {
    return { error: json("The Room Design pilot is currently disabled.", 503) };
  }

  if (scope?.projectId) {
    if (profile?.role === "Employee" && profile.can_view_all_projects === false) {
      const { data: assignment, error } = await supabaseAdmin
        .from("user_project_assignments" as any)
        .select("project_id")
        .eq("project_id", scope.projectId)
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (error || !assignment)
        return { error: json("This project is not assigned to your account.", 403) };
    }
    const { data: enrollment } = await supabaseAdmin
      // Generated client types are updated only after the reviewed migration is applied.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("room_design_projects" as any)
      .select("project_id")
      .eq("project_id", scope.projectId)
      .maybeSingle();
    if (!enrollment) {
      return { error: json("This project is not enrolled in the Room Design pilot.", 403) };
    }
  }

  if (scope?.roomId) {
    if (!scope.projectId) return { error: json("projectId is required with roomId.", 400) };
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("id")
      .eq("id", scope.roomId)
      .eq("project_id", scope.projectId)
      .maybeSingle();
    if (!room) return { error: json("Room does not belong to this pilot project.", 403) };
  }

  return { user: userData.user, profile };
}
