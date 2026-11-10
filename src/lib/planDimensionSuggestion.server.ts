import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createHash } from "node:crypto";
import { authorizeCompletionProject, analyzeSpecCompletion, CreditsUnavailable } from "@/lib/specCompletion.server";
import { cleanUuid } from "@/lib/ids";
import { hasCompletionValue } from "@/lib/specCompletion";
import { materialVisibleInProcurement } from "@/lib/materialSelection";
import { staleSpecBookMaterialIds } from "@/lib/specBookSources";
import type { PlanDimensionSuggestion } from "@/lib/planDimensionSuggestion";
import { SpecReviewCostError, terminalSpecReviewResponse } from "@/lib/specReviewAI.server";
import { saveCompletionSuggestion } from "@/lib/savedSpecCompletion.server";
import { canRunPaidSpecCheck } from "./specCheckAccess";
import { assertProductionFullSpecBudget, productionFullSpecBudgetStore } from "./fullSpecBudget.server";
import { reserveFullSpecBudget, settleFullSpecBudget } from "./fullSpecBudgetStore";
import { FullSpecBudgetError } from "./fullSpecBudget";

const admin = supabaseAdmin as any;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const latestDocument = (projectId: string) => admin.from("project_documents").select("id,title,file_url,file_size,updated_at")
  .eq("project_id", projectId).eq("document_type", "Construction Doc").is("superseded_by_document_id", null)
  .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);

export async function suggestPlanDimensions(request: Request) {
  const access = await authorizeCompletionProject(request, ["project_id", "item_id", "full_check_run_id"]);
  if (access instanceof Response) return access;
  const { projectId, body } = access;
  const itemId = cleanUuid(body.item_id);
  if (!itemId) return json({ error: "Choose a valid material." }, 400);
  if (!canRunPaidSpecCheck(access.user, access.profile)) return json({ error: "The paid full Spec Book check is currently available only to Ken’s active Studio account." }, 403);
  const runId = cleanUuid(body.full_check_run_id);
  if (!runId) return json({ error: "Start a budgeted full check before requesting suggestions." }, 400);
  try { await assertProductionFullSpecBudget(projectId, access.userId, runId); }
  catch (error) { if (error instanceof FullSpecBudgetError) return json({ error: error.message }, 409); throw error; }
  const { data: item, error: itemError } = await admin.from("material_items").select("*,product:products(*)")
    .eq("id", itemId).eq("project_id", projectId).maybeSingle();
  if (itemError) throw itemError;
  if (!item || !materialVisibleInProcurement(item)) return json({ error: "Selection not found in this project." }, 404);
  if (hasCompletionValue(item.product?.dimensions)) return json({ error: "This selection already has dimensions. Refresh the review." }, 409);
  const [roomResult, documentResult, boardResult] = await Promise.all([
    admin.from("rooms").select("id,name").eq("id", item.room_id).eq("project_id", projectId).maybeSingle(),
    latestDocument(projectId),
    admin.from("design_boards").select("board_state").eq("project_id", projectId).maybeSingle(),
  ]);
  if (roomResult.error || documentResult.error || boardResult.error) throw new Error("Could not load project sources");
  if (!roomResult.data || staleSpecBookMaterialIds(projectId, [item], boardResult.data?.board_state).length)
    return json({ error: "The selection changed. Refresh the completion review." }, 409);
  const document = documentResult.data?.[0];
  const result: PlanDimensionSuggestion = { status: "unavailable", dimensions: "", dimension_scope: null,
    document: document ? { id: document.id, title: document.title } : null,
    page: null, sheet: "", evidence: "", message: "No current construction document is attached to this project." };
  if (!document) return json(result);
  try {
    const sourceKey = createHash("sha256").update(JSON.stringify([document.id, document.updated_at, item.updated_at, item.product?.updated_at])).digest("hex");
    const claimKey = `dimensions:${itemId}:${sourceKey}`;
    const findings = await analyzeSpecCompletion(document, projectId, [item], [roomResult.data], itemId, false, undefined, async budget => {
      const claimed = await reserveFullSpecBudget(productionFullSpecBudgetStore(projectId), access.userId, runId,
        { key: claimKey, kind: "completion", openAiCents: Math.round(budget.ceilingUsd * 100), firecrawlCredits: 0 });
      if (!claimed) throw new FullSpecBudgetError("This dimension suggestion was already attempted. Open the saved review; no duplicate request was made.");
    }, async response => {
      if (await terminalSpecReviewResponse(response)) await settleFullSpecBudget(productionFullSpecBudgetStore(projectId), access.userId, runId, claimKey);
    });
    const [freshItem, freshDocument, freshBoard, freshRoom] = await Promise.all([
      admin.from("material_items").select("*,product:products(*)").eq("id", itemId).eq("project_id", projectId).maybeSingle(),
      latestDocument(projectId),
      admin.from("design_boards").select("board_state").eq("project_id", projectId).maybeSingle(),
      admin.from("rooms").select("id,name").eq("id", item.room_id).eq("project_id", projectId).maybeSingle(),
    ]);
    if (freshItem.error || freshDocument.error || freshBoard.error || freshRoom.error) throw new Error("Could not confirm current sources");
    if (JSON.stringify(item) !== JSON.stringify(freshItem.data) || JSON.stringify(roomResult.data) !== JSON.stringify(freshRoom.data) ||
      document.id !== freshDocument.data?.[0]?.id || document.updated_at !== freshDocument.data?.[0]?.updated_at ||
      staleSpecBookMaterialIds(projectId, [item], freshBoard.data?.board_state).length)
      return json({ error: "The selection or construction document changed. Check again for a current dimension suggestion." }, 409);
    const finding = findings.find(finding => finding.item_id === itemId && finding.field === "dimensions");
    const suggestion: PlanDimensionSuggestion = !finding ? { ...result, status: "not_found", message:
      "No clear dimensions were explicitly specified for this item. Confirm its size from the exact product or with the designer." } : { ...result, status: "suggested", dimensions: finding.suggested,
      dimension_scope: finding.dimension_scope ?? null, page: finding.page, sheet: finding.sheet, evidence: finding.evidence,
      message: finding.dimension_scope === "proposed_layout" ?
        "Planned size from the drawings. Confirm the selected product matches before saving its dimensions." :
        "Dimensions specified in the construction document. Verify the selected product/variant before saving." };
    try { await saveCompletionSuggestion(projectId, item, { kind: "dimensions", value: suggestion, document_updated_at: document.updated_at }); }
    catch { suggestion.message += " This suggestion could not be saved; keep this review open or copy it before leaving."; }
    return json(suggestion);
  } catch (error) {
    return json({ ...result, message: error instanceof CreditsUnavailable ?
      "Dimension suggestions need AI credits. The dimensions remain unconfirmed." :
      error instanceof SpecReviewCostError || error instanceof FullSpecBudgetError ? `${error.message} The dimensions remain unconfirmed.` :
      "Could not review the latest construction document. The dimensions remain unconfirmed." });
  }
}
