import type { SavedCompletionIssue } from "./savedSpecCompletion";
import { ambiguousFinish } from "./selectedFinish";

// This is only a candidate for a user's explicit approval. The server also
// rechecks the saved evidence, selected product, and current source snapshots.
// Dimensions and prices may update shared catalog products, while quantities
// need a different save path, so they are deliberately excluded here.
export function batchCompletionProposal(issue: SavedCompletionIssue): { field: "color" | "finish"; value: string } | null {
  const finding = issue.finding;
  if (issue.status !== "open" || !finding.item_id || !["color", "finish"].includes(finding.field)) return null;
  const value = finding.suggested?.trim();
  if (!value || value.length > 200 || /^(?:tbd|unknown|not specified|n\/?a|pending)$/i.test(value) || ambiguousFinish(value)) return null;
  const plan = finding.source === "plans" && Number.isInteger(finding.page) && (finding.page ?? 0) > 0 && !!finding.evidence?.trim();
  const linked = finding.source === "details" && ["mismatch", "ambiguous"].includes(finding.finish_check || "") && !!finding.evidence?.trim();
  if (!plan && !linked) return null;
  return { field: finding.field as "color" | "finish", value };
}

export type CompletionBatchEntry = { issue_key: string; expected_updated_at: string | null; expected_material_updated_at: string;
  expected_product_id: string | null; expected_product_updated_at: string | null };
export type CompletionBatchResult = { issue_key: string; status: "saved" | "check" | "not_attempted"; message?: string };

// Ordered execution deliberately reports partial progress. Existing single-item
// saves can persist a material before the review status update fails; in that
// case the result must say to check, rather than claiming it was not saved.
export async function executeCompletionBatch(entries: CompletionBatchEntry[], save: (entry: CompletionBatchEntry) => Promise<void>): Promise<CompletionBatchResult[]> {
  const results: CompletionBatchResult[] = [];
  let stopped = false;
  for (const entry of entries) {
    if (stopped) { results.push({ issue_key: entry.issue_key, status: "not_attempted" }); continue; }
    try { await save(entry); results.push({ issue_key: entry.issue_key, status: "saved" }); }
    catch { stopped = true; results.push({ issue_key: entry.issue_key, status: "check", message: "This change may have saved, but could not be confirmed. Refresh the review and check it before retrying." }); }
  }
  return results;
}
