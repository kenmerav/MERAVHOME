import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanUuid } from "@/lib/ids";
import { isStudioTeamRole } from "@/lib/permissions";
import { loadCatalogDocumentFit } from "./materialCatalogFit.server";
import { checkTileInstallation } from "./tileInstallation.server";
import { staleSpecBookMaterialIds } from "./specBookSources";
export { cleanBathroomPlanEvidence } from "./constructionDocumentEvidence";
export { projectDocumentStoragePath } from "./constructionDocumentPath.server";
const admin = supabaseAdmin as any;
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});
type PlanRoom = { id: string; name: string };
type PlanDocument = { id: string; title: string; file_url: string; updated_at: string; file_size: number | null };
export async function checkMaterialPlans(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return json({ error: "Sign in to check construction documents." }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "Your session expired." }, 401);
  const { data: profile, error: profileError } = await admin.from("user_profiles")
    .select("role,is_active,can_view_all_projects").eq("id", auth.user.id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.is_active || !isStudioTeamRole(profile.role)) return json({ error: "Only Studio staff can review materials." }, 403);
  const body = await request.json().catch(() => null);
  const projectId = cleanUuid(body?.project_id);
  const documentId = cleanUuid(body?.document_id);
  const tileReview = body?.action === "tile_details";
  if (!projectId || (!documentId && !tileReview) || (body?.action !== undefined && !tileReview) ||
      Object.keys(body).some(key => !["project_id", "document_id", "action"].includes(key)))
    return json({ error: "Choose a project construction document." }, 400);
  if (profile.role === "Employee" && profile.can_view_all_projects === false) {
    const { data: assignment, error } = await admin.from("user_project_assignments")
      .select("project_id").eq("user_id", auth.user.id).eq("project_id", projectId).maybeSingle();
    if (error) throw error;
    if (!assignment) return json({ error: "This project is not assigned to you." }, 403);
  }
  // Choose the latest PDF on the server; callers cannot substitute an older or other project's plan.
  const { data: documents, error: documentError } = await admin.from("project_documents")
    .select("id,title,file_url,file_size,updated_at").eq("project_id", projectId).eq("document_type", "Construction Doc")
    .is("superseded_by_document_id", null).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  if (documentError) throw documentError;
  const document = documents?.[0] as PlanDocument | undefined;
  if (!document && !tileReview) return json({ status: "no_document", document: null, rooms: [] });
  if (documentId && document?.id !== documentId) return json({ error: "The construction document changed. Refreshing the latest plans." }, 409);
  const { data: allRooms, error: roomError } = await admin.from("rooms").select("id,name")
    .eq("project_id", projectId).order("id").limit(101);
  if (roomError) throw roomError;
  const rooms: PlanRoom[] = allRooms ?? [];
  if (tileReview) {
    if (rooms.length > 100) return json({ error: "This project needs a room-list review before checking installation details." }, 413);
    const items: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const rows = await admin.from("material_items").select("*,product:products(*)").eq("project_id", projectId).order("id").range(offset, offset + 999);
      if (rows.error) throw rows.error;
      items.push(...(rows.data || []));
      if ((rows.data?.length || 0) < 1000) break;
    }
    const board = await admin.from("design_boards").select("board_state").eq("project_id", projectId).maybeSingle();
    if (board.error) throw board.error;
    const stale = new Set(staleSpecBookMaterialIds(projectId, items, board.data?.board_state));
    return json(await checkTileInstallation(projectId, items.filter(x => !stale.has(x.id)), rooms, board.data?.board_state, document || null));
  }
  if (!document) return json({ status: "no_document", document: null, rooms: [] });
  if (!rooms.some(room => /bath|powder/i.test(room.name)))
    return json({ status: "checked", document: { id: document.id, title: document.title }, rooms: [] });
  try {
    // Share the persistent extraction with catalog fit instead of paying to
    // reread the same PDF per room and on every server cold start.
    const job = await loadCatalogDocumentFit(projectId, document, rooms, true);
    return json({ status: job?.status ?? "unavailable", document: { id: document.id, title: document.title },
      rooms: job?.status === "checked" ? job.bathroom_layouts ?? [] : [], message: job?.message });
  } catch {
    return json({ status: "unavailable", document: { id: document.id, title: document.title }, rooms: [],
      message: "Could not read the latest plans. Shower suggestions remain available for review." });
  }
}
