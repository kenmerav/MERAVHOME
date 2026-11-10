import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { batchCompletionProposal, executeCompletionBatch, type CompletionBatchEntry } from "./specCompletionBatch";
import { completionFindingKey, CompletionReviewConflict, readSavedCompletionReview } from "./savedSpecCompletion.server";
import { saveCompletionDetailForStaff } from "./specCompletionEdit.server";
import { finishMatches, selectedFinishLabel } from "./selectedFinish";

const admin = supabaseAdmin as any;

// The saved issue supplies the value. The caller cannot submit a replacement
// value, item ID, or writable field. Existing staff/project authorization is
// performed by the endpoint before entering this function.
export async function saveCompletionBatchForStaff(projectId: string, userId: string, entries: CompletionBatchEntry[]) {
  const saved = await readSavedCompletionReview(projectId);
  if (!saved || saved.stale || saved.report.plan_status === "checking") throw new CompletionReviewConflict("The review or its sources changed. Refresh the check before approving fixes.");
  const byKey = new Map(saved.issues.map(issue => [issue.key, issue]));
  const seenItems = new Set<string>();
  const proposals = new Map<string, { value: string; itemId: string }>();
  for (const entry of entries) {
    const issue = byKey.get(entry.issue_key);
    const proposal = issue && batchCompletionProposal(issue);
    if (!issue || !proposal || issue.last_seen_at !== saved.report.checked_at || issue.status_updated_at !== entry.expected_updated_at || !issue.finding.item_id)
      throw new CompletionReviewConflict("One selected fix is no longer available for batch approval. Refresh the review.");
    if (seenItems.has(issue.finding.item_id)) throw new CompletionReviewConflict("Approve only one fix per item at a time, then refresh the review.");
    seenItems.add(issue.finding.item_id);
    proposals.set(entry.issue_key, { value: proposal.value, itemId: issue.finding.item_id });
  }
  const verifyCurrent = async (entry: CompletionBatchEntry) => {
    const issue = byKey.get(entry.issue_key)!;
    const [material, board, documents] = await Promise.all([
      admin.from("material_items").select("*,product:products(*)").eq("id", issue.finding.item_id).eq("project_id", projectId).maybeSingle(),
      admin.from("design_boards").select("board_state").eq("project_id", projectId).maybeSingle(),
      admin.from("project_documents").select("id,title,updated_at").eq("project_id", projectId).eq("document_type", "Construction Doc")
        .is("superseded_by_document_id", null).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
    ]);
    if (material.error || board.error || documents.error) throw new CompletionReviewConflict("Could not confirm the current project sources.");
    const item = material.data;
    const document = documents.data?.[0] || null;
    if (!item || item.not_needed || item.room_id !== issue.finding.room_id || item.updated_at !== entry.expected_material_updated_at ||
      item.product_id !== entry.expected_product_id || (item.product?.updated_at ?? null) !== entry.expected_product_updated_at ||
      completionFindingKey(issue.finding, item, document, board.data?.board_state) !== issue.key)
      throw new CompletionReviewConflict("A selection or its source changed. Refresh the review.");
    if (issue.finding.source === "details") {
      const observed = saved.report.finish_review?.observations?.find(row => row.item_id === item.id);
      const selected = observed && selectedFinishLabel(observed);
      if (!observed || observed.status !== "verified" || observed.source_url !== (item.product_url?.trim() || item.product?.product_url?.trim()) ||
        !selected || !finishMatches(proposals.get(entry.issue_key)!.value, selected))
        throw new CompletionReviewConflict("The selected finish is no longer verified for this product link.");
    }
  };
  // Validate the entire list before any write. Concurrent changes can still
  // interrupt execution, so each write is revalidated and results are explicit.
  for (const entry of entries) await verifyCurrent(entry);
  const results = await executeCompletionBatch(entries, async entry => {
    await verifyCurrent(entry);
    await saveCompletionDetailForStaff(projectId, userId, { ...entry, value: proposals.get(entry.issue_key)!.value });
  });
  return { results };
}
