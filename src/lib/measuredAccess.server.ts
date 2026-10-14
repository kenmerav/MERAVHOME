// Access boundary for the measured-rendering workflow.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Project, UserProfile } from "./db";
import { canViewProjectSurface, isStudioTeamRole, type ProjectSurface } from "./permissions";
const admin = supabaseAdmin as unknown as SupabaseClient;

export class ProjectAccessError extends Error {
  constructor(message: string, readonly status = 403) { super(message); }
}
export function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", Vary: "Authorization" } });
}
export function accessFailure(error: unknown) {
  if (error instanceof ProjectAccessError) return privateJson({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return privateJson({ error: "Check the submitted details." }, 400);
  console.error("Project access failed", error);
  return privateJson({ error: "Could not complete this request. Please try again." }, 500);
}
export async function requireActiveUser(request: Request, staffOnly = false) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ProjectAccessError("Sign in first.", 401);
  const result = await supabaseAdmin.auth.getUser(token);
  if (result.error || !result.data.user || result.data.user.is_anonymous) throw new ProjectAccessError("Your session is no longer valid.", 401);
  const profile = await admin.from("user_profiles").select("id,email,role,is_active,is_owner,can_view_all_projects").eq("id", result.data.user.id).maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data?.is_active || (staffOnly && !isStudioTeamRole(profile.data.role))) throw new ProjectAccessError("This action is only available to authorized MERAV team members.");
  return { user: result.data.user, profile: profile.data as UserProfile };
}
export async function requireProjectAccess(request: Request, projectId: string, surface?: ProjectSurface | "approvals" | "summary", staffOnly = false) {
  z.string().uuid().parse(projectId);
  const actor = await requireActiveUser(request, staffOnly);
  const [project, assignment] = await Promise.all([
    admin.from("projects").select("*").eq("id", projectId).maybeSingle(),
    admin.from("user_project_assignments").select("project_id").eq("project_id", projectId).eq("user_id", actor.user.id).maybeSingle(),
  ]);
  if (project.error || assignment.error) throw project.error || assignment.error;
  const staff = isStudioTeamRole(actor.profile.role);
  const member = actor.profile.role === "Admin" || (actor.profile.role === "Employee" && actor.profile.can_view_all_projects !== false) || !!assignment.data;
  const shared = surface === "summary" ? staff || ["Client", "Contractor"].includes(actor.profile.role) : surface === "approvals"
    ? staff || (actor.profile.role === "Client" && project.data?.approval_live === true)
    : surface ? canViewProjectSurface(actor.profile, project.data as Project, surface) : staff;
  if (!project.data || !member || !shared) throw new ProjectAccessError("This project is not available to your account.");
  return { ...actor, project: project.data as Project, staff };
}
export async function requireRoomAccess(request: Request, roomId: string) {
  z.string().uuid().parse(roomId);
  // Authenticate before looking up a caller-supplied room.
  await requireActiveUser(request, true);
  const room = await admin.from("rooms").select("id,project_id").eq("id", roomId).maybeSingle();
  if (room.error) throw room.error;
  if (!room.data) throw new ProjectAccessError("Room not found.", 404);
  return requireProjectAccess(request, room.data.project_id, undefined, true);
}
// Used only after verified project authorization. Never trust a declared
// project when the action also accepts an independently supplied record ID.
export async function requireProjectReference(projectId: string, table: "rooms" | "rendering_studio_packages" | "rendering_studio_elevations", id: string) {
  z.string().uuid().parse(projectId);
  z.string().uuid().parse(id);
  const result = await admin.from(table).select("id").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ProjectAccessError("This item does not belong to the selected project.");
}
export async function boundedJson(request: Request, limit = 8192): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit) throw new ProjectAccessError("This request is too large.", 413);
  if (!request.body) throw new ProjectAccessError("Nothing was submitted.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new ProjectAccessError("This request is too large.", 413);
      chunks.push(part.value);
    }
  } finally { void reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
