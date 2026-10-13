import { supabase } from "@/integrations/supabase/client";
import type { SpecCompletionReport } from "@/lib/specCompletion";
import type { BoardColorSuggestion } from "@/lib/boardColorSuggestion";
import type { PlanDimensionSuggestion } from "@/lib/planDimensionSuggestion";
import type { SavedSpecCompletionReview, SavedCompletionIssue, CompletionIssueStatus } from "@/lib/savedSpecCompletion";
import { completionResponse } from "@/lib/specCompletionResponse";

async function savedReviewRequest(body: unknown): Promise<SavedSpecCompletionReview | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to review completion.");
  const response = await fetch("/api/spec-completion-review", {
    method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return completionResponse(response, "Could not load the saved review.");
}
export function fetchSavedSpecCompletion(projectId: string) {
  return savedReviewRequest({ project_id: projectId, action: "load" });
}
export function updateCompletionIssue(projectId: string, issue: SavedCompletionIssue, status: CompletionIssueStatus) {
  return savedReviewRequest({ project_id: projectId, action: "status", issue_key: issue.key, status,
    expected_updated_at: issue.status_updated_at });
}

export async function fetchSpecCompletion(projectId: string): Promise<SpecCompletionReport> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to check completion.");
  const response = await fetch("/api/check-spec-completion", {
    method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId }),
  });
  return completionResponse(response, "Could not check completion.");
}

export async function fetchBoardColorSuggestion(projectId: string, itemId: string): Promise<BoardColorSuggestion> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to suggest a color.");
  const response = await fetch("/api/suggest-board-color", {
    method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, item_id: itemId }),
  });
  return completionResponse(response, "Could not suggest a color.");
}

export async function fetchPlanDimensionSuggestion(projectId: string, itemId: string): Promise<PlanDimensionSuggestion> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to suggest dimensions.");
  const response = await fetch("/api/suggest-plan-dimensions", {
    method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, item_id: itemId }),
  });
  return completionResponse(response, "Could not suggest dimensions.");
}
