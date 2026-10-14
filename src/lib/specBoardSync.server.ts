import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanUuid } from "@/lib/ids";
import { randomUUID } from "node:crypto";
import { planSpecBoardSync, SpecBoardSyncConflict } from "@/lib/specBoardSync";

const admin = supabaseAdmin as any;
async function rows(table: string, select: string, projectId: string) {
  const result: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from(table).select(select).eq("project_id", projectId).order("id").range(offset, offset + 999);
    if (error) throw error;
    result.push(...(data || []));
    if (!data || data.length < 1000) return result;
  }
}

// Authorization belongs to the completion endpoint, before this helper is
// called. Only project-scoped rows and product IDs on its saved board are read.
export async function syncSpecBoardForStaff(projectId: string, userId: string, importSelections: boolean, expectedUpdatedAt?: string | null) {
  const [boardResult, items, rooms] = await Promise.all([
    admin.from("design_boards").select("board_state,updated_at").eq("project_id", projectId).maybeSingle(),
    rows("material_items", "*,product:products(*)", projectId), rows("rooms", "id,name", projectId),
  ]);
  if (boardResult.error) throw boardResult.error;
  const board = boardResult.data;
  if (expectedUpdatedAt !== undefined && (board?.updated_at || null) !== expectedUpdatedAt)
    throw new SpecBoardSyncConflict("The design board changed during the product refresh. Run the check again to include the latest selections.");
  if (!board) return { updated_at: null, summary: { status: "not_present" as const, imported: 0, updated: 0, added: 0, issues: [] } };
  const ids = [...new Set<string>((board.board_state?.pages || []).flatMap((page: any) => (page.elements || []).map((layer: any) => cleanUuid(layer.productId)).filter(Boolean)))];
  const products: any[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await admin.from("products").select("*").in("id", ids.slice(offset, offset + 100));
    if (error) throw error;
    products.push(...(data || []));
  }
  const plan = planSpecBoardSync(projectId, board.board_state, items, rooms, products, randomUUID, importSelections);
  let updatedAt = board.updated_at;
  const saveBoard = async (state: unknown) => {
    const { data, error } = await admin.from("design_boards").update({ board_state: state, updated_by: userId })
      .eq("project_id", projectId).eq("updated_at", updatedAt).select("updated_at").maybeSingle();
    if (error) throw error;
    if (!data) throw new SpecBoardSyncConflict("The design board changed while sending to Materials. Run the check again after its latest changes are saved.");
    updatedAt = data.updated_at;
  };
  if (plan.changed || plan.updates.length || plan.inserts.length) {
    const currentItems = await rows("material_items", "*,product:products(*)", projectId);
    if (JSON.stringify(currentItems) !== JSON.stringify(items))
      throw new SpecBoardSyncConflict("Materials changed while syncing the board. Run the check again after the latest changes are saved.");
    const fresh = await admin.from("design_boards").select("updated_at").eq("project_id", projectId).maybeSingle();
    if (fresh.error) throw fresh.error;
    if (fresh.data?.updated_at !== updatedAt) throw new SpecBoardSyncConflict("The design board changed before sending to Materials. Run the check again.");
    // Save source IDs for retry, but leave the prior send snapshot in place
    // until every material write succeeds. A failed save must not consume edits.
    const referencesOnly = structuredClone(plan.state);
    for (const page of referencesOnly.pages) {
      const oldPage = board.board_state.pages.find((saved: any) => saved.id === page.id);
      for (const key of ["materialsSyncSnapshot", "materialsSyncFingerprint", "materialsSyncedAt"]) {
        if (oldPage?.[key] !== undefined) page[key] = oldPage[key];
        else delete page[key];
      }
    }
    // No narrower board write API exists. Keep stable IDs and CAS the fresh
    // snapshot; the existing trigger preserves recoverable board versions.
    if (JSON.stringify(referencesOnly) !== JSON.stringify(board.board_state)) await saveBoard(referencesOnly);
  }
  if (plan.inserts.length) {
    // Board references are saved first. On interruption the same saved IDs are
    // reused, making retries safe without overwriting any material selections.
    const records = plan.inserts.map(({ product, ...item }) => item);
    const { error } = await admin.from("material_items").upsert(records, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error("Board changes were saved, but its new materials could not be saved. Run the check again to finish syncing.");
    const verified = await rows("material_items", "id,source_board_page_id,source_board_element_id", projectId);
    if (records.some(item => !verified.some(row => row.id === item.id && row.source_board_page_id === item.source_board_page_id && row.source_board_element_id === item.source_board_element_id)))
      throw new SpecBoardSyncConflict("A board material reference could not be confirmed for this project. Open the board and retry.");
  }
  for (const update of plan.updates) {
    const { data, error } = await admin.from("material_items").update(update.patch)
      .eq("project_id", projectId).eq("id", update.item.id).eq("updated_at", update.item.updated_at)
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new SpecBoardSyncConflict("A material changed while the board was being sent. Run the check again to finish with current selections.");
  }
  if (plan.changed) await saveBoard(plan.state);
  // Do not begin scraping from a board that was edited during material writes.
  const fresh = await admin.from("design_boards").select("updated_at").eq("project_id", projectId).maybeSingle();
  if (fresh.error) throw fresh.error;
  if (fresh.data?.updated_at !== updatedAt) throw new SpecBoardSyncConflict("The design board changed during syncing. Run the check again for current selections.");
  return { updated_at: updatedAt, summary: plan.summary };
}
