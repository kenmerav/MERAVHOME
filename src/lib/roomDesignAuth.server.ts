import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { UserProfile } from "@/lib/db";
import { canManageStudio } from "@/lib/permissions";

function json(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function requireRoomDesignPilotAccess(
  request: Request,
  scope?: { projectId?: string | null; roomId?: string | null },
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
    .select("id,email,role,is_active,is_owner")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!canManageStudio(profile as UserProfile | null)) {
    return { error: json("The Room Design pilot is currently limited to administrators.", 403) };
  }

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
    const { data: project } = await supabaseAdmin
      // Generated client types are updated only after the reviewed migration is applied.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("projects" as any)
      .select("id,design_workflow_version")
      .eq("id", scope.projectId)
      .maybeSingle();
    if (
      !project ||
      (project as unknown as { design_workflow_version?: string }).design_workflow_version !==
        "room_design_v2"
    ) {
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
