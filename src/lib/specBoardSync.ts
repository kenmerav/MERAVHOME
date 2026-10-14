import type { MaterialItem, Product } from "@/lib/db";
import type { CompletionRoom } from "@/lib/specCompletion";
import { materialImageUrl } from "@/lib/materialImages";
import { inferMaterialCategory } from "@/lib/roomTemplates";
import { roomDesignBoardDisplayLabel } from "@/lib/roomDesignWorkflow";
import { cleanUuid } from "@/lib/ids";
import { createBoardMaterialsSnapshot, boardMaterialsFingerprint } from "@/lib/boardMaterialsSnapshot";

type Layer = Record<string, any> & { id: string; type: string };
type Page = Record<string, any> & { id: string; elements: Layer[] };
type State = Record<string, any> & { pages: Page[] };
export type SpecBoardSyncSummary = {
  status?: "synced" | "not_present";
  imported: number; updated: number; added: number;
  issues: Array<{ page: string; label: string; message: string }>;
};
export type SpecBoardMaterialUpdate = { item: MaterialItem; patch: Partial<MaterialItem> };
export class SpecBoardSyncConflict extends Error {}
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalize = (value: unknown) => text(value).toLowerCase().replace(/\bbathrooms?\b/g, "bath").replace(/[^a-z0-9]+/g, " ").trim();
const url = (value: unknown) => text(value).replace(/\/+$/, "");
const usableImage = (value: unknown) => /^https?:\/\//i.test(text(value)) ? text(value) : null;

function validateBoard(value: unknown): asserts value is State {
  const state = value as State;
  if (!state || !Array.isArray(state.pages)) throw new SpecBoardSyncConflict("The design board could not be read. Open it and retry the check.");
  const pages = new Set<string>(), layers = new Set<string>();
  for (const page of state.pages) {
    if (!page?.id || pages.has(page.id) || !Array.isArray(page.elements)) throw new SpecBoardSyncConflict("The design board has invalid pages. Open it before checking the Spec Book.");
    pages.add(page.id);
    for (const layer of page.elements) {
      if (!layer?.id || layers.has(layer.id)) throw new SpecBoardSyncConflict("The design board has invalid item references. Open it before checking the Spec Book.");
      layers.add(layer.id);
    }
  }
}

// One way: send the included full board to Materials. Existing board snapshots
// distinguish new board edits from unchanged values that staff corrected in
// Materials. Never replay old quantities, erase ordering history or add pages.
export function planSpecBoardSync(projectId: string, board: unknown, items: MaterialItem[], rooms: CompletionRoom[], products: Product[], makeId: () => string, importSelections = true) {
  validateBoard(board);
  const state: State = structuredClone(board);
  const summary: SpecBoardSyncSummary = { status: "synced", imported: 0, updated: 0, added: 0, issues: [] };
  const inserts: MaterialItem[] = [];
  const updates: SpecBoardMaterialUpdate[] = [];
  const scoped = items.filter(item => item.project_id === projectId);
  const byId = new Map(scoped.map(item => [item.id, item]));
  const byProduct = new Map(products.map(product => [product.id, product]));
  const references = new Map<string, Array<{ page: Page; layer: Layer; changedQuantity: boolean; newLayer: boolean }>>();
  const roomById = new Map(rooms.map(room => [room.id, room]));
  const issue = (page: Page, layer: Layer, message: string) => summary.issues.push({ page: text(page.title) || "Design board", label: roomDesignBoardDisplayLabel(layer) || "Unlabeled image", message });
  const patchFor = (item: MaterialItem) => {
    let update = updates.find(update => update.item.id === item.id);
    if (!update) { update = { item, patch: {} }; updates.push(update); }
    return update.patch;
  };
  for (const page of state.pages) {
    let pageComplete = true;
    for (const layer of page.elements) {
      if (layer.type !== "image" || layer.materialExcludeFromMaterials || page.hidden || page.roomApprovalStatus === "declined") continue;
      const baseline = page.materialsSyncSnapshot?.materialImages?.find((saved: any) => saved.id === layer.id);
      const currentSnapshot = createBoardMaterialsSnapshot({ ...page, elements: [layer] }).materialImages[0];
      const changed = (key: string) => !!baseline && JSON.stringify(baseline[key] ?? null) !== JSON.stringify(currentSnapshot[key] ?? null);
      const assigned = page.roomId && layer.materialItemId && layer.materialRoomId && page.roomId !== layer.materialRoomId
        ? page.roomId : layer.materialRoomId || page.roomId;
      const matchedRooms = rooms.filter(room => normalize(page.title) === normalize(room.name));
      const room = assigned ? roomById.get(assigned) : matchedRooms.length === 1 ? matchedRooms[0] : undefined;
      if (!room) { issue(page, layer, "Assign this board item to a room."); pageComplete = false; continue; }
      let item = byId.get(layer.materialItemId) || scoped.find(candidate => candidate.source_board_id === projectId && candidate.source_board_page_id === page.id && candidate.source_board_element_id === layer.id);
      // A copied image assigned to a new room must not move the original row.
      if (item?.room_id !== room.id) item = undefined;
      if (item?.not_needed) continue; // Preserve an explicit staff removal.
      const linkedProduct = byProduct.get(layer.productId);
      const link = layer.materialLinkCleared ? "" : text(layer.link) || linkedProduct?.product_url || "";
      const product = linkedProduct && (!link || !linkedProduct.product_url || url(linkedProduct.product_url) === url(link)) ? linkedProduct : undefined;
      const label = roomDesignBoardDisplayLabel(layer);
      const finish = text(layer.materialFinish) || text(layer.finish) || product?.finish || "";
      if (!item) {
        const matches = [...scoped, ...inserts].filter(candidate => candidate.room_id === room.id &&
          normalize(candidate.item_label) === normalize(label) &&
          ((link && url(candidate.product_url) === url(link)) || (!link && product && candidate.product_id === product.id)) &&
          normalize(candidate.color || candidate.product?.finish) === normalize(finish) &&
          (!layer.materialDimensions || normalize(candidate.product?.dimensions) === normalize(layer.materialDimensions)) &&
          (!layer.src || !materialImageUrl(candidate) || materialImageUrl(candidate) === layer.src));
        if (matches.length > 1) { issue(page, layer, "Multiple material selections match this board item. Confirm which to use."); pageComplete = false; continue; }
        item = matches[0];
      }
      if (item?.not_needed) continue;
      const variantChanged = !!(item && (!baseline || changed("productId") || changed("link") || changed("materialLinkCleared")) && ((link && item.product_url && url(link) !== url(item.product_url)) ||
        (product && item.product_id && product.id !== item.product_id &&
          (!link || !item.product_url || (product.finish && normalize(product.finish) !== normalize(item.product?.finish))))));
      if (item && variantChanged && (item.ordered || item.received || item.installed)) {
        issue(page, layer, "This board product differs from an ordered material. Confirm the replacement before updating it."); pageComplete = false; continue;
      }
      if (!label) { issue(page, layer, "Add a product label before including this image in Materials."); pageComplete = false; continue; }
      if (!item && !importSelections) { issue(page, layer, "This board selection changed during the refresh. Run the check again to include it."); pageComplete = false; continue; }
      if (!item) {
        // Include labeled selections even without a retailer link. The detail
        // check can then flag missing information in the actual Spec Book.
        const id = cleanUuid(layer.materialItemId) || makeId();
        const quantity = typeof layer.materialQuantity === "number" && layer.materialQuantity > 0 ? layer.materialQuantity : null;
        item = {
          id, project_id: projectId, room_id: room.id, item_label: label,
          client_product_name: `${room.name} ${label}`, category: layer.materialCategory || product?.category || inferMaterialCategory(label, link) || "Other",
          is_required: false, sort_order: Math.max(0, ...scoped.filter(row => row.room_id === room.id).map(row => row.sort_order), ...inserts.filter(row => row.room_id === room.id).map(row => row.sort_order)) + 1,
          product_id: product?.id || null, product: product || null, product_url: link || null,
          image_url: usableImage(layer.src) || usableImage(layer.backgroundRemovedUrl) || product?.image_url || null,
          color: finish || null, notes: text(layer.notes) || null, quantity, quantity_tbd: quantity === null,
          quantity_unit: "count", not_needed: false, cad_label: null,
          source_board_id: projectId, source_board_page_id: page.id, source_board_element_id: layer.id,
          scrape_status: "pending", scrape_error: null,
        } as MaterialItem;
        inserts.push(item); byId.set(item.id, item); summary.imported++;
      } else if (importSelections) {
        const patch = patchFor(item);
        if (variantChanged || changed("link") || changed("materialLinkCleared")) {
          patch.product_url = link || null;
          // A changed URL must not retain the old variant's catalog ID/pricing.
          if (variantChanged) patch.product_id = product?.id || null;
          patch.scrape_status = "pending"; patch.scrape_error = null;
        }
        if (changed("label")) {
          patch.item_label = label; patch.client_product_name = `${room.name} ${label}`;
        }
        if (finish && (variantChanged || changed("materialFinish") || changed("finish") || !item.color)) patch.color = finish;
        if (layer.materialCategory && (changed("materialCategory") || !item.category)) patch.category = layer.materialCategory;
        if (changed("notes") || (!item.notes && text(layer.notes))) patch.notes = text(layer.notes) || null;
        if (usableImage(layer.src) && (variantChanged || changed("src") || !item.image_url)) patch.image_url = layer.src;
        // Preserve quantity basis, ordering and manual notes/categories that
        // have not actually changed on the board since its last send.
      }
      references.set(item.id, [...(references.get(item.id) || []), { page, layer, changedQuantity: changed("materialQuantity"), newLayer: !!page.materialsSyncSnapshot && !baseline }]);
      if (importSelections) Object.assign(layer, { materialItemId: item.id, materialRoomId: room.id });
      if (!link && !product && !item.product_id) issue(page, layer, "This selection has no product link. Add one in Materials to scrape its product information.");
    }
    if (importSelections && pageComplete && !page.hidden && page.roomApprovalStatus !== "declined") {
      const snapshot = createBoardMaterialsSnapshot(page);
      if (JSON.stringify(page.materialsSyncSnapshot) !== JSON.stringify(snapshot)) {
        page.materialsSyncSnapshot = snapshot;
        page.materialsSyncFingerprint = boardMaterialsFingerprint(snapshot);
        page.materialsSyncedAt = new Date().toISOString();
      }
    }
  }
  for (const [id, refs] of references) {
    const item = byId.get(id)!;
    const isNew = inserts.includes(item);
    const perPage = new Map<string, Layer[]>();
    for (const ref of refs) perPage.set(ref.page.id, [...(perPage.get(ref.page.id) || []), ref.layer]);
    const newSamePageCopy = refs.some(ref => ref.newLayer &&
      (perPage.get(ref.page.id)?.length || 0) > 1);
    if (!isNew && (!importSelections || (!newSamePageCopy && !refs.some(ref => ref.changedQuantity)))) continue;
    const counts = [...perPage.values()].map(layers => layers.length > 1 ? layers.length
      : typeof layers[0].materialQuantity === "number" && layers[0].materialQuantity > 0 ? layers[0].materialQuantity : null);
    const quantity = counts.every(count => count != null) ? Math.max(...counts as number[]) : null;
    if (isNew) { item.quantity = quantity; item.quantity_tbd = quantity === null; }
    else Object.assign(patchFor(item), { quantity, quantity_tbd: quantity === null });
  }
  // Excluded or deleted board-sourced selections leave the active Spec Book
  // through recoverable removal. Manually added Materials remain untouched.
  const activeLayers = new Set(state.pages.flatMap(page => page.hidden || page.roomApprovalStatus === "declined" ? []
    : page.elements.filter(layer => layer.type === "image" && !layer.materialExcludeFromMaterials).map(layer => `${page.id}:${layer.id}`)));
  const linkedActive = new Set(state.pages.flatMap(page => page.hidden || page.roomApprovalStatus === "declined" ? []
    : page.elements.filter(layer => layer.type === "image" && !layer.materialExcludeFromMaterials).map(layer => layer.materialItemId)));
  if (importSelections) for (const item of scoped) {
    if (!item.not_needed && item.source_board_id === projectId && item.source_board_element_id &&
        !activeLayers.has(`${item.source_board_page_id}:${item.source_board_element_id}`) && !linkedActive.has(item.id)) patchFor(item).not_needed = true;
  }
  const changedUpdates = updates.map(update => ({ ...update, patch: Object.fromEntries(Object.entries(update.patch)
    .filter(([key, value]) => JSON.stringify((update.item as any)[key] ?? null) !== JSON.stringify(value))) }))
    .filter(update => Object.keys(update.patch).length);
  summary.updated = changedUpdates.length;
  return { state, inserts, updates: changedUpdates, summary, changed: JSON.stringify(state) !== JSON.stringify(board) };
}

// Compare selection evidence, rather than canvas geometry or comments.
export function specBoardSelectionEvidence(board: unknown) {
  const state = board as State | null;
  if (!Array.isArray(state?.pages)) return null;
  return state.pages.map(page => [page.id, page.title, page.roomId, page.hidden === true, page.roomApprovalStatus,
    (page.elements || []).filter(layer => layer.type === "image").map(layer => [
      layer.id, layer.label, layer.productName, layer.productId, layer.materialItemId, layer.materialRoomId,
      layer.link, layer.materialLinkCleared === true, layer.materialExcludeFromMaterials === true,
      layer.materialQuantity, layer.materialFinish, layer.materialDimensions, layer.src,
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}
