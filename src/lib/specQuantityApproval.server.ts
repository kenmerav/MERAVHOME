import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { drawingMatchSignature, type DrawingMatchJob, type DrawingMatchItem } from "./specDrawingMatches";
import { currentDrawingMatchSource, productionDrawingMatchStore, quantityDrawingKey } from "./specDrawingMatchStore.server";
import { loadDrawingMatchReport } from "./specDrawingMatchEngine.server";
import { ProjectAccessError } from "./measuredAccess.server";
import { approvableDrawingQuantity } from "./specQuantityApproval";

const admin = supabaseAdmin as any;
type Result = { itemId: string; status: "applied" | "failed" | "check" | "skipped"; message: string };

export async function applyDrawingQuantities(projectId: string, expectedKey: string, attempt: number, itemIds: string[]) {
  const store = productionDrawingMatchStore(projectId);
  const source = await currentDrawingMatchSource(projectId, "quantities");
  if (!source.document || quantityDrawingKey(source.key, attempt) !== expectedKey)
    throw new ProjectAccessError("The drawings or selections changed. Reopen the drawing review before approving.", 409);
  const job = await store.read<DrawingMatchJob>(`${expectedKey}/job.json`);
  const report = await loadDrawingMatchReport(store, expectedKey);
  if (!job || job.projectId !== projectId || job.key !== expectedKey || job.purpose !== "quantities" || !report || report.key !== expectedKey)
    throw new ProjectAccessError("The drawing review is not available. Reopen it before approving.", 409);
  const byId = new Map(source.items.map(item => [item.id, item]));
  const proposed = itemIds.map(itemId => ({ itemId, item: byId.get(itemId) }));
  if (new Set(itemIds).size !== itemIds.length || proposed.some(row => !row.item || approvableDrawingQuantity(report, row.item) == null))
    throw new ProjectAccessError("Some selections are no longer eligible for batch approval. Reopen the drawing review.", 409);

  const results: Result[] = [];
  const appliedOriginal = new Map<string, DrawingMatchItem>();
  for (let index = 0; index < proposed.length; index++) {
    const { itemId, item } = proposed[index];
    let writeStarted = false;
    try {
      // Reconstruct the original source, accounting only for our own successful
      // writes. This rejects a changed document, board or another selection.
      const fresh = await currentDrawingMatchSource(projectId, "quantities");
      if (!fresh.document) throw Error("The construction document changed.");
      const originalItems = fresh.items.map(row => {
        const original = appliedOriginal.get(row.id);
        return original ? { ...row, quantity: original.quantity, quantityTbd: original.quantityTbd, materialUpdatedAt: original.materialUpdatedAt } : row;
      });
      const base = createHash("sha256").update(drawingMatchSignature(projectId, fresh.document, originalItems)).digest("hex");
      if (quantityDrawingKey(base, attempt) !== expectedKey) throw Error("The drawings or selections changed during approval.");
      const { data: material, error: readError } = await admin.from("material_items").select("id,room_id,product_id,updated_at,not_needed")
        .eq("project_id", projectId).eq("id", itemId).maybeSingle();
      if (readError || !material || material.not_needed || material.room_id !== item!.roomId || material.product_id !== item!.productId || material.updated_at !== item!.materialUpdatedAt)
        throw Error("The selection is no longer available.");
      const quantity = approvableDrawingQuantity(report, item!);
      writeStarted = true;
      const { data, error } = await admin.from("material_items").update({ quantity, quantity_tbd: false })
        .eq("project_id", projectId).eq("id", itemId).eq("room_id", item!.roomId).eq("product_id", material.product_id)
        .eq("updated_at", material.updated_at).select("id").maybeSingle();
      if (error || !data) throw Error("The selection changed before it could be saved.");
      appliedOriginal.set(itemId, item!);
      results.push({ itemId, status: "applied", message: `Quantity saved as ${quantity}.` });
    } catch (error) {
      results.push({ itemId, status: writeStarted ? "check" : "failed", message: writeStarted
        ? "This quantity may have saved, but could not be confirmed. Refresh and check it before retrying."
        : error instanceof Error ? error.message : "Could not save quantity." });
      for (const remaining of proposed.slice(index + 1)) results.push({ itemId: remaining.itemId, status: "skipped", message: "Stopped after another selection could not be saved. Reopen the review." });
      break;
    }
  }
  return { results, appliedCount: results.filter(row => row.status === "applied").length, failedCount: results.filter(row => row.status !== "applied").length };
}
