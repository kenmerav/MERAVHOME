import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { staleSpecBookMaterialIds } from "@/lib/specBookSources";
import { needsCompletionDimensions, type CompletionFinding, type CompletionRoom, type SpecCompletionReport } from "@/lib/specCompletion";
import { normalizeMaterialSuggestionLabel } from "@/lib/materialSuggestions";
import { linkedBoardImage } from "@/lib/boardColorSuggestion";
import type { MaterialItem } from "@/lib/db";
import type { SavedCompletionIssue, SavedSpecCompletionReview, CompletionIssueStatus } from "@/lib/savedSpecCompletion";

const admin = supabaseAdmin as any;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export class CompletionStorageUnavailable extends Error {}
export class CompletionReviewConflict extends Error {}
export function completionStorageError(error: any): never {
  if (["42P01", "PGRST202", "PGRST205", "42703"].includes(error?.code))
    throw new CompletionStorageUnavailable("Saved completion reviews need the database update before checks can run.");
  if (error?.code === "40001") throw new CompletionReviewConflict("A newer review was saved while this check was running. Open the saved review for current results.");
  throw new Error("Could not save or load the completion review. Please retry.");
}

export function completionSourceSignature(items: MaterialItem[], rooms: CompletionRoom[], document: SpecCompletionReport["document"], boardState?: unknown) {
  const sources: unknown[] = [rooms.map(room => [room.id, room.name]).sort(),
    items.map(item => [item.id, item.room_id, item.item_label, item.client_product_name, item.category, item.cad_label,
      item.not_needed, item.is_required, item.product_id, item.quantity, item.quantity_tbd, item.quantity_unit,
      item.color, item.product_url, item.source_board_id, item.source_board_page_id, item.source_board_element_id,
      item.product?.name, item.product?.sku, item.product?.finish, item.product?.dimensions, item.product?.price,
      item.product?.price_unit, item.product?.product_url, linkedBoardImage(item, boardState)?.image_url ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    document];
  // Keep existing reviews current when no new size metadata exists yet.
  const sizes = items.filter(item => item.product?.size_options?.length || item.product?.selected_size)
    .map(item => [item.id, item.product?.size_options ?? null, item.product?.selected_size ?? null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (sizes.length) sources.push(sizes);
  return hash(sources);
}

export function completionFindingKey(finding: CompletionFinding, item: MaterialItem | undefined, document: SpecCompletionReport["document"], boardState?: unknown) {
  const fieldValue = !item ? null : finding.field === "quantity" ? [item.quantity, item.quantity_tbd, item.quantity_unit] :
    finding.field === "color" || finding.field === "finish" ? [item.color, item.product?.finish] :
    finding.field === "dimensions" ? [item.product?.dimensions, item.product?.size_options, item.product?.selected_size] :
    finding.field === "price" ? [item.product?.price, item.product?.price_unit] :
    finding.field === "price_unit" ? item.product?.price_unit :
    finding.field === "link" ? [item.product_url, item.product?.product_url] : item.product_id;
  return hash([finding.room_id, finding.item_id || normalizeMaterialSuggestionLabel(finding.item_label),
    finding.field, finding.source, normalized(finding.current), normalized(finding.suggested), finding.dimension_scope ?? null,
    item ? [item.product_id, item.product?.sku, item.product_url, item.product?.product_url,
      item.source_board_id, item.source_board_page_id, item.source_board_element_id] : null,
    fieldValue ?? null, finding.source === "plans" ? [document, item?.item_label, item?.category, item?.cad_label,
      item?.color, item?.product?.finish, item?.product?.dimensions] : null,
    finding.field === "color" && finding.source === "details" && item ? linkedBoardImage(item, boardState)?.image_url ?? null : null]);
}

export function completionIssueRecords(report: SpecCompletionReport, items: MaterialItem[], rooms: CompletionRoom[], boardState?: unknown) {
  const byItem = new Map(items.map(item => [item.id, item]));
  const byRoom = new Map(rooms.map(room => [room.id, room.name]));
  return Object.fromEntries(report.findings.map(finding => {
    const item = finding.item_id ? byItem.get(finding.item_id) : undefined;
    const key = completionFindingKey(finding, item, report.document, boardState);
    const issue: SavedCompletionIssue = { key, finding, status: "open", room_name: byRoom.get(finding.room_id) || "Former room",
      document: finding.source === "plans" ? report.document : null,
      first_seen_at: report.checked_at, last_seen_at: report.checked_at, status_updated_at: null, status_updated_by: null };
    if (item) issue.item_preview = { product_id: item.product_id, name: item.product?.name || finding.item_label,
      image_url: item.image_url || linkedBoardImage(item, boardState)?.image_url || item.product?.image_url || null,
      product_url: item.product_url || item.product?.product_url || null };
    return [key, issue];
  }));
}

export async function assertCompletionStorage(projectId: string) {
  const { error } = await admin.from("spec_completion_reviews").select("project_id").eq("project_id", projectId).maybeSingle();
  if (error) completionStorageError(error);
}

export async function saveCompletionReview(projectId: string, userId: string, report: SpecCompletionReport, items: MaterialItem[], rooms: CompletionRoom[], boardState?: unknown) {
  const { error } = await admin.rpc("save_spec_completion_review", {
    p_project_id: projectId, p_user_id: userId, p_report: report,
    p_source_signature: completionSourceSignature(items, rooms, report.document, boardState),
    p_issues: completionIssueRecords(report, items, rooms, boardState),
  });
  if (error) completionStorageError(error);
}

async function projectRows(table: string, select: string, projectId: string) {
  const all: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from(table).select(select).eq("project_id", projectId).order("id").range(offset, offset + 999);
    if (error) throw new Error("Could not load current project selections.");
    all.push(...(data ?? [])); if (!data || data.length < 1000) return all;
  }
}

export async function readSavedCompletionReview(projectId: string): Promise<SavedSpecCompletionReview | null> {
  const { data: saved, error } = await admin.from("spec_completion_reviews").select("report,issues,source_signature")
    .eq("project_id", projectId).maybeSingle();
  if (error) completionStorageError(error);
  if (!saved?.report) return null;
  const [rawItems, rooms, board, document] = await Promise.all([
    projectRows("material_items", "*,product:products(*)", projectId), projectRows("rooms", "id,name", projectId),
    admin.from("design_boards").select("board_state").eq("project_id", projectId).maybeSingle(),
    admin.from("project_documents").select("id,title,updated_at").eq("project_id", projectId)
      .eq("document_type", "Construction Doc").is("superseded_by_document_id", null)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
  ]);
  if (board.error || document.error) throw new Error("Could not confirm current project sources.");
  const stale = new Set(staleSpecBookMaterialIds(projectId, rawItems, board.data?.board_state));
  const roomIds = new Set(rooms.map(room => room.id));
  const items = rawItems.filter(item => !stale.has(item.id) && roomIds.has(item.room_id));
  const latest = document.data?.[0];
  const currentDocument = latest ? { id: latest.id, title: latest.title, updated_at: latest.updated_at } : null;
  const byItem = new Map(items.map(item => [item.id, item]));
  const issues = (Object.values(saved.issues ?? {}) as SavedCompletionIssue[]).filter(issue => {
    // Preserve decisions/history, but retire old blanket missing-dimension flags
    // from the open list without requiring another paid scan.
    if (issue.status !== "open" || issue.finding.field !== "dimensions" || issue.finding.source !== "details") return true;
    const item = byItem.get(issue.finding.item_id ?? "");
    return !!item && needsCompletionDimensions(item);
  });
  return { report: saved.report, issues,
    stale: saved.source_signature !== completionSourceSignature(items, rooms, currentDocument, board.data?.board_state) };
}

export async function setCompletionIssueStatus(projectId: string, userId: string, key: string, status: CompletionIssueStatus, expected: string | null) {
  const { data, error } = await admin.rpc("set_spec_completion_issue_status", {
    p_project_id: projectId, p_user_id: userId, p_issue_key: key, p_status: status, p_expected_updated_at: expected,
  });
  if (error) completionStorageError(error);
  if (!data) throw new CompletionReviewConflict("This issue changed or is no longer available. Reopen the saved review before changing its status.");
}

// Save validated, server-produced suggestions beside their current issue so
// staff can return later without paying to regenerate the same suggestion.
export async function saveCompletionSuggestion(projectId: string, item: MaterialItem, suggestion: NonNullable<SavedCompletionIssue["suggestion"]>, boardState?: unknown) {
  const { data: saved, error } = await admin.from("spec_completion_reviews").select("report,issues").eq("project_id", projectId).maybeSingle();
  if (error) completionStorageError(error);
  if (!saved?.report) return;
  const issue = (Object.values(saved.issues ?? {}) as SavedCompletionIssue[]).find(issue => issue.finding.item_id === item.id &&
    issue.finding.field === suggestion.kind && issue.finding.source === "details" && issue.last_seen_at === saved.report.checked_at &&
    issue.key === completionFindingKey(issue.finding, item, saved.report.document, boardState));
  if (!issue) return;
  const { data: savedSuggestion, error: saveError } = await admin.rpc("save_spec_completion_suggestion", {
    p_project_id: projectId, p_issue_key: issue.key, p_checked_at: saved.report.checked_at, p_suggestion: suggestion,
  });
  if (saveError) completionStorageError(saveError);
  if (!savedSuggestion) throw new CompletionReviewConflict("The saved issue changed during the suggestion.");
}
