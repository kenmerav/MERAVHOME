import type { CompletionFinding, SpecCompletionReport } from "@/lib/specCompletion";
import type { BoardColorSuggestion } from "@/lib/boardColorSuggestion";
import type { PlanDimensionSuggestion } from "@/lib/planDimensionSuggestion";

export type CompletionIssueStatus = "open" | "completed" | "not_needed";
export type SavedCompletionIssue = {
  key: string; finding: CompletionFinding; status: CompletionIssueStatus;
  room_name: string; document: SpecCompletionReport["document"];
  first_seen_at: string; last_seen_at: string;
  status_updated_at: string | null; status_updated_by: string | null;
  item_preview?: { product_id: string | null; name: string; image_url: string | null; product_url: string | null };
  suggestion?: { kind: "color"; value: BoardColorSuggestion } | { kind: "dimensions"; value: PlanDimensionSuggestion; document_updated_at?: string };
};
export type SavedSpecCompletionReview = {
  report: SpecCompletionReport; issues: SavedCompletionIssue[]; stale: boolean;
};
export function isCompletionIssueStatus(value: unknown): value is CompletionIssueStatus {
  return value === "open" || value === "completed" || value === "not_needed";
}
export function completionIssueCounts(issues: SavedCompletionIssue[]) {
  return issues.reduce((counts, issue) => ({ ...counts, [issue.status]: counts[issue.status] + 1 }),
    { open: 0, completed: 0, not_needed: 0 });
}
