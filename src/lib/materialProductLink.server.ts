import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeCompletionProject } from "@/lib/specCompletion.server";
import { cleanUuid } from "@/lib/ids";
import { buildClientProductName } from "@/lib/clientProductName";
import { inferMaterialCategory } from "@/lib/roomTemplates";
import { completionCatalogTemplate } from "@/lib/specCompletionCatalog";
import { materialCoversTemplateSuggestion } from "@/lib/materialSuggestions";
import { materialVisibleInProcurement } from "@/lib/materialSelection";
import { untouchedCatalogPlaceholder } from "@/lib/materialCatalogSuggestions";
import { staleSpecBookMaterialIds } from "@/lib/specBookSources";
import { sharedCompletionCoversMissing } from "@/lib/specSharedMaterials";
import type { MaterialItem } from "@/lib/db";

const admin = supabaseAdmin as any;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function saveMaterialProductLinkRequest(request: Request) {
  const access = await authorizeCompletionProject(request, ["action", "project_id", "room_id", "label", "existing_item_id", "expected_updated_at", "product_url", "completion_issue_key", "expected_issue_updated_at"]);
  if (access instanceof Response) return access;
  const { projectId, body } = access;
  const roomId = cleanUuid(body.room_id);
  const itemId = cleanUuid(body.existing_item_id);
  let url: URL;
  try { url = new URL(body.product_url?.trim()); }
  catch { return json({ error: "Paste a full product link starting with https:// or http://." }, 400); }
  if (!roomId || (body.existing_item_id != null && !itemId) || typeof body.label !== "string" || !body.label.trim() || body.label.length > 180 ||
    !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 4000)
    return json({ error: "Choose an item and a valid product link." }, 400);
  const productUrl = body.product_url.trim();
  const [roomResult, itemsResult, boardResult, roomsResult] = await Promise.all([
    admin.from("rooms").select("id,name").eq("id", roomId).eq("project_id", projectId).maybeSingle(),
    admin.from("material_items").select("*,product:products(*)").eq("project_id", projectId),
    admin.from("design_boards").select("board_state").eq("project_id", projectId).maybeSingle(),
    admin.from("rooms").select("id,name").eq("project_id", projectId),
  ]);
  if (roomResult.error || itemsResult.error || boardResult.error || roomsResult.error) throw roomResult.error || itemsResult.error || boardResult.error || roomsResult.error;
  const room = roomResult.data;
  if (!room) return json({ error: "This room is not in the project." }, 404);
  const items = (itemsResult.data ?? []) as MaterialItem[];
  const stale = new Set(staleSpecBookMaterialIds(projectId, items, boardResult.data?.board_state));
  const local = items.filter(item => item.room_id === roomId && !stale.has(item.id));
  if (body.completion_issue_key !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(body.completion_issue_key)) return json({ error: "Choose a current review issue." }, 400);
    const { data: saved, error } = await admin.from("spec_completion_reviews").select("report,issues").eq("project_id", projectId).maybeSingle();
    if (error) throw error;
    const issue = saved?.issues?.[body.completion_issue_key];
    if (!issue || issue.status !== "open" || issue.status_updated_at !== body.expected_issue_updated_at || issue.last_seen_at !== saved.report?.checked_at ||
      saved.report?.plan_status === "checking" || issue.finding.room_id !== roomId ||
      (issue.finding.item_id ? issue.finding.item_id !== itemId : issue.finding.field !== "missing_item"))
      return json({ error: "This review issue changed. Reopen the saved review before adding a link." }, 409);
    if (!issue.finding.item_id && body.label !== issue.finding.item_label) return json({ error: "Choose the item from this review." }, 400);
  }
  const template = completionCatalogTemplate(body.label);
  const existing = itemId ? local.find(item => item.id === itemId) : local.find(item => untouchedCatalogPlaceholder(item) && completionCatalogTemplate(item.item_label).label === template.label);
  if (itemId && (!existing || existing.updated_at !== body.expected_updated_at)) return json({ error: "This material changed. Refresh before saving the link." }, 409);
  if (existing?.not_needed) return json({ error: "Restore this item in Materials before adding a link." }, 409);
  if ((!existing || untouchedCatalogPlaceholder(existing)) && (local.some(item => item.id !== existing?.id && materialVisibleInProcurement(item) && materialCoversTemplateSuggestion(item, template, room.name)) ||
    sharedCompletionCoversMissing(items.filter(item => !stale.has(item.id)), roomsResult.data ?? [], roomId, template.label)))
    return json({ error: "This item already has a selection, including Materials Throughout. Refresh to review it." }, 409);
  const changed = !!existing && ((existing.product_url || existing.product?.product_url || "").trim() !== productUrl ||
    (!!existing.product?.product_url && existing.product.product_url.trim() !== productUrl));
  if (changed && (existing.ordered || existing.received || existing.installed)) return json({ error: "Review this ordered item’s replacement in Materials before changing its link." }, 409);
  const patch = { product_url: productUrl, is_required: false, scrape_status: "pending", scrape_error: null,
    ...(changed ? { product_id: null } : {}) };
  const result = existing ? await admin.from("material_items").update(patch).eq("id", existing.id).eq("project_id", projectId).eq("room_id", roomId)
    .eq("updated_at", existing.updated_at).select("id").maybeSingle() : await admin.from("material_items").insert({ ...patch,
      project_id: projectId, room_id: roomId, item_label: body.label.trim(), client_product_name: buildClientProductName(room.name, body.label.trim()),
      category: inferMaterialCategory(body.label), sort_order: Math.max(-1, ...local.map(item => item.sort_order ?? 0)) + 1,
      product_id: null, not_needed: false, quantity: null, quantity_tbd: true, quantity_unit: "count",
      source_board_id: null, source_board_page_id: null, source_board_element_id: null, ordered: false,
    }).select("id").single();
  if (result.error) throw result.error;
  if (!result.data) return json({ error: "This material changed before the link could be saved. Refresh and try again." }, 409);
  return json({ item_id: result.data.id });
}
