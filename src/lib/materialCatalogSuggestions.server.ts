import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeCompletionProject } from "@/lib/specCompletion.server";
import { cleanUuid } from "@/lib/ids";
import {
  rankCatalogSuggestions,
  catalogProductMatches,
  untouchedCatalogPlaceholder,
  type CatalogUse,
} from "@/lib/materialCatalogSuggestions";
import { templateForRoomName } from "@/lib/roomTemplates";
import { buildClientProductName } from "@/lib/clientProductName";
import { materialCoversTemplateSuggestion } from "@/lib/materialSuggestions";
import { materialVisibleInProcurement } from "@/lib/materialSelection";
import { staleSpecBookMaterialIds } from "@/lib/specBookSources";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, MaterialItem } from "@/lib/db";
import { loadCatalogFitContext } from "@/lib/materialCatalogFit.server";
import { assessCatalogFit, roomCoordinationSources } from "@/lib/materialCatalogFit";
import { completionCatalogTemplate } from "@/lib/specCompletionCatalog";
import type { SavedCompletionIssue } from "@/lib/savedSpecCompletion";
import { setCompletionIssueStatus } from "@/lib/savedSpecCompletion.server";
import { sharedCompletionCoversMissing } from "@/lib/specSharedMaterials";

const admin: SupabaseClient = supabaseAdmin;
type CatalogHistory = {
  product_id: string | null;
  project_id: string;
  not_needed: boolean;
  room: { name: string } | null;
};
type RoomCatalogHistory = { product_id: string; room: { name: string; project_id: string } | null };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function allRows<T>(table: string, select: string) {
  const rows: T[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error } = await admin
      .from(table)
      .select(select)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
  throw new Error("Catalog is too large for this lookup.");
}

export async function materialCatalogRequest(request: Request) {
  const access = await authorizeCompletionProject(request, [
    "project_id",
    "room_id",
    "label",
    "action",
    "product_id",
    "existing_item_id",
    "expected_updated_at",
    "criteria",
    "context_key",
    "refresh_plan",
    "expected_product_updated_at",
    "completion_issue_key",
    "expected_issue_updated_at",
    "consider_shared",
  ]);
  if (access instanceof Response) return access;
  const { projectId, userId, body } = access;
  const roomId = cleanUuid(body.room_id);
  if (
    !roomId ||
    !["list", "add", "replace"].includes(body.action) ||
    typeof body.label !== "string" ||
    body.label.length > 180
  )
    return json({ error: "Choose a room and missing item." }, 400);
  const { data: room, error: roomError } = await admin
    .from("rooms")
    .select("id,name")
    .eq("id", roomId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room) return json({ error: "This room is not in the project." }, 404);
  let template = templateForRoomName(room.name, true).find((item) => item.label === body.label);
  let completionIssue: SavedCompletionIssue | undefined;
  if (body.completion_issue_key !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(body.completion_issue_key)) return json({ error: "Choose a current review issue." }, 400);
    const { data: saved, error } = await admin.from("spec_completion_reviews").select("report,issues")
      .eq("project_id", projectId).maybeSingle();
    if (error) throw error;
    completionIssue = saved?.issues?.[body.completion_issue_key] as SavedCompletionIssue | undefined;
    if (!completionIssue || completionIssue.status !== "open" || completionIssue.finding.room_id !== roomId ||
      completionIssue.last_seen_at !== saved?.report?.checked_at || saved?.report?.plan_status === "checking" ||
      (body.action !== "list" && completionIssue.status_updated_at !== body.expected_issue_updated_at))
      return json({ error: "This review issue changed. Reopen the saved review before choosing a product." }, 409);
    let label = completionIssue.finding.item_label;
    let category: string | null = null;
    if (completionIssue.finding.item_id) {
      const { data: item, error: itemError } = await admin.from("material_items").select("*")
        .eq("id", completionIssue.finding.item_id).eq("project_id", projectId).eq("room_id", roomId).maybeSingle();
      if (itemError) throw itemError;
      if (!item || item.not_needed || item.id !== body.existing_item_id ||
        (completionIssue.item_preview?.product_id && completionIssue.item_preview.product_id !== item.product_id))
        return json({ error: "This material selection changed. Run a new check before replacing it." }, 409);
      label = item.item_label; category = item.category;
    } else if (completionIssue.finding.field !== "missing_item") return json({ error: "Choose an item to review." }, 400);
    if (body.label !== label && body.label !== completionIssue.finding.item_label) return json({ error: "This label does not match the review issue." }, 400);
    template = completionCatalogTemplate(label, category);
  }
  if (body.action === "replace" && !completionIssue?.finding.item_id)
    return json({ error: "Choose a current material from the Spec Book review to replace." }, 400);
  if (!template) return json({ error: "Choose an item from this room’s missing-items list." }, 400);
  if (body.refresh_plan !== undefined && typeof body.refresh_plan !== "boolean")
    return json({ error: "Choose a valid plan review action." }, 400);
  if (body.consider_shared !== undefined && typeof body.consider_shared !== "boolean")
    return json({ error: "Choose a valid shared-material review action." }, 400);
  if (body.action === "list") {
    const criteria = body.criteria ?? {};
    if (
      !criteria ||
      typeof criteria !== "object" ||
      Array.isArray(criteria) ||
      Object.keys(criteria).some((key) => !["search", "width", "mount"].includes(key)) ||
      (criteria.search !== undefined &&
        (typeof criteria.search !== "string" || criteria.search.length > 100)) ||
      (criteria.width != null &&
        (typeof criteria.width !== "number" ||
          !Number.isFinite(criteria.width) ||
          criteria.width <= 0 ||
          criteria.width > 200)) ||
      (criteria.mount !== undefined &&
        !["any", "wall", "undermount", "vessel", "drop_in"].includes(criteria.mount))
    )
      return json({ error: "Enter valid catalog filters." }, 400);
    const context = await loadCatalogFitContext(projectId, room, true, body.refresh_plan === true);
    const [products, history, roomHistory] = await Promise.all([
      allRows<Product>("products", "*"),
      allRows<CatalogHistory>(
        "material_items",
        "id,product_id,project_id,not_needed,room:rooms!material_items_room_id_fkey(name)",
      ),
      allRows<RoomCatalogHistory>(
        "room_products",
        "id,product_id,room:rooms!room_products_room_id_fkey(name,project_id)",
      ),
    ]);
    const uses: CatalogUse[] = history
      .filter((row) => row.product_id && !row.not_needed)
      .map((row) => ({
        product_id: row.product_id!,
        project_id: row.project_id,
        room_name: row.room?.name || "",
      }));
    for (const row of roomHistory) {
      if (row.room?.project_id)
        uses.push({
          product_id: row.product_id,
          project_id: row.room.project_id,
          room_name: row.room.name,
        });
    }
    const candidates = rankCatalogSuggestions(
      products,
      uses,
      projectId,
      room.name,
      template.label,
      template.category,
      criteria,
      products.length,
    ).map((candidate) => ({
      ...candidate,
      fit: assessCatalogFit(candidate.product, template.label, context.items, context.plan),
    }));
    const fits = candidates.filter((candidate) => candidate.fit.status !== "conflict");
    fits.sort(
      (a, b) =>
        Number(b.fit.status === "matches_recorded_requirements") -
          Number(a.fit.status === "matches_recorded_requirements") ||
        Number(b.fit.finish_match) - Number(a.fit.finish_match) ||
        Number(b.used_here) - Number(a.used_here) ||
        b.project_count - a.project_count,
    );
    return json({
      suggestions: fits.slice(0, 12),
      context_key: context.contextKey,
      context: {
        plan: context.plan,
        related: roomCoordinationSources(template.label, context.items),
        excluded_conflicts: candidates.length - fits.length,
      },
    });
  }
  const productId = cleanUuid(body.product_id);
  if (!productId || (body.existing_item_id != null && !cleanUuid(body.existing_item_id)))
    return json({ error: "Choose a catalog product." }, 400);
  const context = await loadCatalogFitContext(projectId, room, false);
  const [
    { data: product, error: productError },
    { data: items, error: itemsError },
    { data: board, error: boardError },
  ] = await Promise.all([
    admin.from("products").select("*").eq("id", productId).maybeSingle(),
    admin
      .from("material_items")
      .select("*,product:products(*)")
      .eq("room_id", roomId)
      .eq("project_id", projectId),
    admin.from("design_boards").select("board_state").eq("project_id", projectId).maybeSingle(),
  ]);
  if (productError || itemsError || boardError) throw productError || itemsError || boardError;
  if (!product || !catalogProductMatches(product, template.label, template.category, room.name))
    return json({ error: "Choose a matching catalog product." }, 400);
  if (body.expected_product_updated_at !== product.updated_at)
    return json(
      { error: "This catalog product changed. Refresh the suggestions before adding it." },
      409,
    );
  if (body.context_key !== context.contextKey || context.plan.status === "checking")
    return json(
      {
        error:
          "The room selections or plans changed, or the plan check is still running. Refresh the catalog suggestions before adding.",
      },
      409,
    );
  if (assessCatalogFit(product, template.label, context.items, context.plan).status === "conflict")
    return json(
      {
        error:
          "This catalog product conflicts with the current construction requirements. Choose another product.",
      },
      409,
    );
  const currentItems = (items ?? []) as MaterialItem[];
  const stale = new Set(staleSpecBookMaterialIds(projectId, currentItems, board?.board_state));
  const selected = currentItems.find(
    (item) =>
      !stale.has(item.id) &&
      materialVisibleInProcurement(item) &&
      materialCoversTemplateSuggestion(item, template, room.name),
  );
  const replacing = body.action === "replace";
  if (!replacing && (body.consider_shared || completionIssue)) {
    const [allItems, allRooms] = await Promise.all([
      admin.from("material_items").select("*,product:products(*)").eq("project_id", projectId),
      admin.from("rooms").select("id,name").eq("project_id", projectId),
    ]);
    if (allItems.error || allRooms.error) throw allItems.error || allRooms.error;
    const projectItems = (allItems.data ?? []) as MaterialItem[];
    const staleShared = new Set(staleSpecBookMaterialIds(projectId, projectItems, board?.board_state));
    if (sharedCompletionCoversMissing(projectItems.filter(item => !staleShared.has(item.id)), allRooms.data ?? [], roomId, template.label))
      return json({ error: "Materials Throughout already covers this item. Refresh the review before adding another selection." }, 409);
  }
  if (selected && !replacing)
    return json(
      { error: "This item already has a selection. Refresh Materials to review it." },
      409,
    );
  if (!replacing && currentItems.some((item) => item.not_needed && item.item_label === template.label))
    return json({ error: "This item was marked not needed. Restore it in Materials first." }, 409);
  const existing = body.existing_item_id
    ? currentItems.find((item) => item.id === body.existing_item_id)
    : currentItems.find(
        (item) => item.item_label === template.label && untouchedCatalogPlaceholder(item),
      );
  if (
    body.existing_item_id &&
    (!existing ||
      (!replacing && ((completionIssue ? completionCatalogTemplate(existing.item_label, existing.category).label !== template.label : existing.item_label !== template.label) || !untouchedCatalogPlaceholder(existing))) ||
      existing.not_needed ||
      existing.updated_at !== body.expected_updated_at)
  )
    return json({ error: "This item changed. Refresh Materials before adding a product." }, 409);
  if (replacing && (!existing || existing.id !== completionIssue?.finding.item_id ||
    existing.ordered || existing.received || existing.installed))
    return json({ error: "This selection is already ordered, received or installed. Review its replacement in Materials." }, 409);
  const patch = {
    product_id: product.id,
    product_url: product.product_url,
    image_url: product.image_url,
    color: product.finish,
    is_required: false,
    not_needed: false,
    ...(!replacing ? { quantity: null, quantity_tbd: true, quantity_unit: "count" as const } : {}),
    scrape_status: "scraped",
    scrape_error: null,
  };
  // Manual selection: retain the catalog product and leave quantity for staff to confirm.
  let update = existing ? admin
        .from("material_items")
        .update(patch)
        .eq("id", existing.id)
        .eq("project_id", projectId)
        .eq("room_id", roomId)
        .eq("updated_at", existing.updated_at)
        : null;
  if (update && existing) update = existing.product_id ? update.eq("product_id", existing.product_id) : update.is("product_id", null);
  const result = update
    ? await update.select("id").maybeSingle()
    : await admin
        .from("material_items")
        .insert({
          ...patch,
          project_id: projectId,
          room_id: roomId,
          item_label: template.label,
          client_product_name: buildClientProductName(room.name, template.label),
          category: template.category,
          sort_order: currentItems.length,
          source_board_id: null,
          source_board_page_id: null,
          source_board_element_id: null,
          ordered: false,
        })
        .select("id")
        .single();
  if (result.error) throw result.error;
  if (!result.data)
    return json({ error: "This item changed. Refresh Materials before adding." }, 409);
  const { data: links, error: linksError } = await admin
    .from("room_products")
    .select("id")
    .eq("room_id", roomId)
    .eq("product_id", productId)
    .limit(1);
  if (linksError)
    return json(
      {
        error:
          "The material was added, but its room connection could not be confirmed. Refresh Materials.",
      },
      409,
    );
  if (!links?.length) {
    const { error } = await admin
      .from("room_products")
      .insert({ room_id: roomId, product_id: productId, is_key_selection: false });
    if (error)
      return json(
        {
          error:
            "The material was added, but its room connection could not be confirmed. Refresh Materials.",
        },
        409,
      );
  }
  // A catalog choice completes missing/assignment/link issues only. A fit or
  // quantity correction still requires staff confirmation against the plans.
  if (completionIssue && ["missing_item", "product", "link"].includes(completionIssue.finding.field)) {
    try {
      await setCompletionIssueStatus(projectId, userId, completionIssue.key, "completed", completionIssue.status_updated_at);
    } catch {
      return json({ item_id: result.data.id, warning: "The product is saved to Materials and the Spec Book. Reopen the review to confirm this issue’s status." });
    }
  }
  return json({ item_id: result.data.id });
}
