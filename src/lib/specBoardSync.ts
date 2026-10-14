import type { MaterialItem, Product } from "@/lib/db";
import type { CompletionRoom } from "@/lib/specCompletion";
import { materialVisibleInProcurement } from "@/lib/materialSelection";
import { materialImageUrl } from "@/lib/materialImages";
import { inferMaterialCategory } from "@/lib/roomTemplates";
import { roomDesignBoardDisplayLabel } from "@/lib/roomDesignWorkflow";
import { cleanUuid } from "@/lib/ids";

type Layer = Record<string, any> & { id: string; type: string };
type Page = Record<string, any> & { id: string; elements: Layer[] };
type State = Record<string, any> & { pages: Page[] };
export type SpecBoardSyncSummary = {
  status?: "synced" | "not_present";
  imported: number; updated: number; added: number;
  issues: Array<{ page: string; label: string; message: string }>;
};
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

// Materials owns existing selections. A full-board preflight adds unsent board
// selections without replaying old board quantities over staff's corrections.
// Conflicting variants need review, rather than silently choosing either one.
export function planSpecBoardSync(projectId: string, board: unknown, items: MaterialItem[], rooms: CompletionRoom[], products: Product[], makeId: () => string, importSelections = true) {
  validateBoard(board);
  const state: State = structuredClone(board);
  const summary: SpecBoardSyncSummary = { status: "synced", imported: 0, updated: 0, added: 0, issues: [] };
  const inserts: MaterialItem[] = [];
  const scoped = items.filter(item => item.project_id === projectId);
  const byId = new Map(scoped.map(item => [item.id, item]));
  const byProduct = new Map(products.map(product => [product.id, product]));
  const covered = new Set<string>();
  const importedReferences = new Map<string, Array<{ page: Page; layer: Layer }>>();
  const roomById = new Map(rooms.map(room => [room.id, room]));
  const issue = (page: Page, layer: Layer, message: string) => summary.issues.push({ page: text(page.title) || "Design board", label: roomDesignBoardDisplayLabel(layer) || "Unlabeled image", message });
  const resolveRoom = (page: Page, layer: Layer) => {
    const assigned = layer.materialRoomId || page.roomId;
    if (assigned) return roomById.get(assigned);
    // Do not guess when a title could refer to more than one room.
    const matches = rooms.filter(room => normalize(page.title) === normalize(room.name));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const sourceMatches = (item: MaterialItem, page: Page, layer: Layer) => item.source_board_id === projectId && item.source_board_page_id === page.id && item.source_board_element_id === layer.id;
  for (const page of state.pages) {
    for (const layer of page.elements) {
      if (layer.type !== "image") continue;
      const linked = byId.get(layer.materialItemId) || scoped.find(item => sourceMatches(item, page, layer));
      if (linked) covered.add(linked.id);
      // Excluded visual references never turn back into purchases.
      if (layer.materialExcludeFromMaterials || page.hidden || page.roomApprovalStatus === "declined") continue;
      const room = resolveRoom(page, layer);
      if (!room) { issue(page, layer, "Assign this board item to a room."); continue; }
      let item = linked;
      const product = byProduct.get(layer.productId);
      const link = layer.materialLinkCleared ? "" : text(layer.link) || product?.product_url || "";
      const label = roomDesignBoardDisplayLabel(layer);
      const finish = text(layer.materialFinish) || text(layer.finish) || product?.finish || "";
      if (item && item.room_id !== room.id) {
        issue(page, layer, "The board item and material are assigned to different rooms. Confirm the selection."); continue;
      }
      if (!item) {
        const matches = [...scoped, ...inserts].filter(candidate => candidate.room_id === room.id &&
          normalize(candidate.item_label) === normalize(label) &&
          ((layer.productId && candidate.product_id === layer.productId) || (link && url(candidate.product_url) === url(link))) &&
          normalize(candidate.color || candidate.product?.finish) === normalize(finish) &&
          (!layer.materialDimensions || normalize(candidate.product?.dimensions) === normalize(layer.materialDimensions)) &&
          (!layer.src || !materialImageUrl(candidate) || materialImageUrl(candidate) === layer.src));
        if (matches.length > 1) { issue(page, layer, "Multiple material selections match this board item. Confirm which to use."); continue; }
        item = matches[0];
      }
      if (!item) {
        if (!importSelections) { issue(page, layer, "This board selection changed during the refresh. Run the check again to include it."); continue; }
        if (!label) { issue(page, layer, "Add a product label before including this image in Materials."); continue; }
        if (!link && !product && !layer.materialInfoSkipApproved && !layer.materialInfoNotNeeded) {
          issue(page, layer, "Add a product link, or approve this item without one on the design board."); continue;
        }
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
      }
      covered.add(item.id);
      if (inserts.includes(item)) importedReferences.set(item.id, [...(importedReferences.get(item.id) || []), { page, layer }]);
      if (item.not_needed) {
        layer.materialExcludeFromMaterials = true; summary.updated++; continue;
      }
      const itemLink = item.product_url || "";
      // An explicit variant change on the board is evidence to review, not a
      // license to overwrite an already selected/ordered material.
      if ((layer.productId && item.product_id && layer.productId !== item.product_id) ||
          (link && itemLink && url(link) !== url(itemLink))) {
        issue(page, layer, "The board and Materials have different product selections. Confirm the intended product."); continue;
      }
      const before = JSON.stringify(layer);
      Object.assign(layer, {
        materialItemId: item.id, materialRoomId: item.room_id, productId: item.product_id,
        productName: item.product?.name || layer.productName || item.item_label,
        vendor: item.product?.vendor || layer.vendor || null,
        price: item.product?.price || layer.price || null,
        finish: item.color || item.product?.finish || layer.finish || null,
        materialFinish: item.color || item.product?.finish || layer.materialFinish || layer.finish || null,
        materialDimensions: item.product?.dimensions || layer.materialDimensions || null,
        materialCategory: item.category, materialQuantity: item.quantity,
        link: itemLink, materialLinkCleared: !itemLink,
      });
      // Keep the board's cutout, crop, position, labels and notes. A catalog
      // image refresh must never replace a deliberately edited board image.
      if (!layer.src && materialImageUrl(item)) layer.src = materialImageUrl(item);
      if (JSON.stringify(layer) !== before) summary.updated++;
    }
  }
  // Repeated copies on one page are discrete instances. References on other
  // pages for the same room do not multiply the purchasing quantity.
  for (const item of inserts) {
    const references = importedReferences.get(item.id) || [];
    const perPage = new Map<string, Layer[]>();
    for (const ref of references) perPage.set(ref.page.id, [...(perPage.get(ref.page.id) || []), ref.layer]);
    const counts = [...perPage.values()].map(layers => layers.length > 1 ? layers.length : item.quantity);
    if (counts.every(count => count != null)) {
      item.quantity = Math.max(...counts as number[]); item.quantity_tbd = false;
      for (const ref of references) ref.layer.materialQuantity = item.quantity;
    }
  }
  // New selections made in Materials appear on clearly named review pages.
  // Do not rearrange the designer's existing pages to squeeze them in.
  for (const item of scoped.filter(materialVisibleInProcurement)) {
    if (covered.has(item.id)) continue;
    const room = roomById.get(item.room_id);
    if (!room) continue;
    // Deleted source layers stay deleted; spec filtering already handles them.
    if (item.source_board_id === projectId && item.source_board_element_id) continue;
    const src = usableImage(materialImageUrl(item));
    if (!src) {
      summary.issues.push({ page: room.name, label: item.item_label, message: "This selected material needs an image before it can be added to the design board." }); continue;
    }
    const pageId = `spec-material-updates:${room.id}:${Math.floor(state.pages.filter(p => p.specMaterialUpdatesRoomId === room.id).reduce((sum, p) => sum + p.elements.length, 0) / 8)}`;
    let page = state.pages.find(p => p.id === pageId);
    if (!page) {
      page = { id: pageId, title: `${room.name} — Material updates`, roomId: room.id, specMaterialUpdatesRoomId: room.id, elements: [] };
      state.pages.push(page);
    }
    const index = page.elements.length;
    page.elements.push({ id: `spec-material:${item.id}`, type: "image", src,
      x: 40 + (index % 4) * 340, y: 70 + Math.floor(index / 4) * 390, width: 260, height: 230, zIndex: index + 1,
      label: item.item_label, materialItemId: item.id, materialRoomId: item.room_id,
      productId: item.product_id, productName: item.product?.name || item.item_label,
      vendor: item.product?.vendor || null, price: item.product?.price || null,
      link: item.product_url || "", materialLinkCleared: !item.product_url,
      finish: item.color || item.product?.finish || null, materialFinish: item.color || item.product?.finish || null,
      materialCategory: item.category, materialQuantity: item.quantity, materialDimensions: item.product?.dimensions || null,
      notes: item.notes || "", visible: true, rotation: 0,
    });
    covered.add(item.id); summary.added++;
  }
  return { state, inserts, summary, changed: JSON.stringify(state) !== JSON.stringify(board) };
}

// Compare selection evidence, rather than canvas geometry or comments. This
// also catches newly added board items while a long plan review is running.
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
