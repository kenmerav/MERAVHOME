import { supabase } from "@/integrations/supabase/client";
import type { SpecCompletionReport } from "@/lib/specCompletion";
import type { BoardColorSuggestion } from "@/lib/boardColorSuggestion";
import type { PlanDimensionSuggestion } from "@/lib/planDimensionSuggestion";
import type { SavedSpecCompletionReview, SavedCompletionIssue, CompletionIssueStatus } from "@/lib/savedSpecCompletion";
import { completionResponse } from "@/lib/specCompletionResponse";
import type { MaterialItem } from "@/lib/db";
import type { CompletionDetailDraft } from "@/lib/specCompletionDetail";
import { refreshMaterialProductInfo, type MaterialProductRefresh } from "@/lib/materialProductRefresh";
import type { SpecBoardSyncSummary } from "@/lib/specBoardSync";
import { createStudioSessionRequest } from "@/lib/studioSessionRequest";

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

export async function saveCompletionDetail(projectId: string, item: MaterialItem, issue: SavedCompletionIssue, draft: CompletionDetailDraft): Promise<{ item: MaterialItem; review: SavedSpecCompletionReview }> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to save this detail.");
  const response = await fetch("/api/spec-completion-review", {
    method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, action: "detail", issue_key: issue.key,
      expected_updated_at: issue.status_updated_at, expected_material_updated_at: item.updated_at,
      expected_product_id: item.product_id, expected_product_updated_at: item.product?.updated_at ?? null,
      value: draft.value, ...(draft.priceUnit !== undefined ? { price_unit: draft.priceUnit } : {}) }),
  });
  return completionResponse(response, "Could not save this detail.");
}

export async function fetchSpecCompletion(projectId: string, options: {
  onProgress?: (message: string) => void;
  onProductsRefreshed?: (summary: MaterialProductRefresh) => Promise<void>;
  onBoardRefreshed?: (summary: SpecBoardSyncSummary) => Promise<void>;
} = {}): Promise<SpecCompletionReport> {
  const request = await createStudioSessionRequest();
  const headers = { "Content-Type": "application/json" };
  options.onProgress?.("Sending the full design board to Materials…");
  const preparedResponse = await request("/api/check-spec-completion", {
    method: "POST", headers, body: JSON.stringify({ project_id: projectId, action: "prepare" }),
  });
  const prepared = await completionResponse<{ material_item_ids: string[]; pending_report?: SpecCompletionReport;
    board_updated_at?: string | null; board_refresh?: SpecBoardSyncSummary }>(preparedResponse, "Could not prepare the completion check.");
  if (prepared.pending_report) return prepared.pending_report;
  if (!Array.isArray(prepared.material_item_ids)) throw new Error("Could not confirm current selections. Please retry.");
  if (prepared.board_refresh) await options.onBoardRefreshed?.(prepared.board_refresh);
  const summary = await refreshMaterialProductInfo(projectId, prepared.material_item_ids, {
    request, onProgress: options.onProgress, verifySelectedFinishes: true,
  });
  await options.onProductsRefreshed?.(summary);
  options.onProgress?.("Checking construction PDFs and Spec Book…");
  const response = await request("/api/check-spec-completion", {
    method: "POST", headers,
    body: JSON.stringify({ project_id: projectId, finish_checks: summary.finishChecks ?? [], ...(prepared.board_updated_at !== undefined
      ? { expected_board_updated_at: prepared.board_updated_at } : {}) }),
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
