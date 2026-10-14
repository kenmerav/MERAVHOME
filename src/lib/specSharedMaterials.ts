import type { MaterialItem } from "@/lib/db";
import { materialVisibleInProcurement } from "@/lib/materialSelection";
import { materialCoversTemplateSuggestion, normalizeMaterialSuggestionLabel } from "@/lib/materialSuggestions";
import { inferMaterialCategory } from "@/lib/roomTemplates";
import { specQuantityUnit } from "@/lib/specQuantity";

type Room = { id: string; name: string };

export function isSharedCompletionRoom(room: Room) {
  return /^(?:(?:materials|appliances) throughout|whole house(?: materials| appliances)?|project wide(?: materials| appliances)?)$/.test(normalizeMaterialSuggestionLabel(room.name));
}

export function completionSuggestionLabel(label: string) {
  const key = normalizeMaterialSuggestionLabel(label);
  if (/^(?:bathroom |bath |kitchen |laundry )?(?:sinks?|basins?|lavatories)$/.test(key)) return "Sink";
  if (/^(?:toilets?|water closets?|wc)$/.test(key)) return "Toilet";
  if (/\b(?:towel|robe) hooks?\b/.test(key)) return "Towel Hook";
  if (/\b(?:toilet paper|toilet roll|tissue|tp) holders?\b/.test(key)) return "Toilet Paper Holder";
  return label;
}

function selectionText(item: MaterialItem) {
  return normalizeMaterialSuggestionLabel([item.item_label, item.client_product_name, item.cad_label,
    item.product?.name, item.product?.subcategory].filter(Boolean).join(" "));
}

function sinkUse(text: string) {
  if (/\b(?:kitchen|bar|prep|farmhouse|apron)\b/.test(text)) return "kitchen";
  if (/\b(?:laundry|utility|service|mop)\b/.test(text)) return "laundry";
  if (/\b(?:bath|bathroom|lavatory|lavatories)\b/.test(text)) return "bathroom";
  return null;
}

// Shared selections are defaults, but a default of a different functional type
// cannot cover a room's requirement (a kitchen sink is not a bathroom sink).
export function sharedSelectionCovers(item: MaterialItem, label: string, roomName: string) {
  const canonical = completionSuggestionLabel(label);
  const requested = normalizeMaterialSuggestionLabel(label);
  const selected = selectionText(item);
  if (canonical === "Sink") {
    const intended = sinkUse(requested) ?? sinkUse(normalizeMaterialSuggestionLabel(roomName));
    const supplied = sinkUse(selected);
    if (intended && supplied !== intended) return false;
  }
  if (/\bshower\b/.test(requested) && !/\bshower\b/.test(selected)) return false;
  if (/\b(?:cabinet|cabinetry)\b/.test(requested) && /\bpaint|finish|colou?r\b/.test(requested) &&
    !/\b(?:cabinet|cabinetry)\b/.test(selected)) return false;
  if (/\bfloor tiles?\b/.test(requested) && !/\b(?:tile|porcelain|ceramic|marble|stone)\b/.test(selected)) return false;
  // A shared recessed light cannot cover a chandelier, sconce, or ceiling fan.
  for (const kind of ["sconce", "pendant", "chandelier", "ceiling fan", "recessed light"]) {
    if (requested.includes(kind) && !selected.includes(kind)) return false;
  }
  return materialCoversTemplateSuggestion(item, { label: canonical, category: inferMaterialCategory(label) }, roomName);
}

export function sharedCompletionSelections(items: MaterialItem[], rooms: Room[]) {
  const sharedRooms = new Set(rooms.filter(isSharedCompletionRoom).map(room => room.id));
  return items.filter(item => sharedRooms.has(item.room_id) && materialVisibleInProcurement(item));
}

export function sharedCompletionCoversMissing(items: MaterialItem[], rooms: Room[], roomId: string, label: string) {
  const room = rooms.find(room => room.id === roomId);
  return !!room && !isSharedCompletionRoom(room) && sharedCompletionSelections(items, rooms)
    .some(item => sharedSelectionCovers(item, label, room.name));
}

function variantUrl(item: MaterialItem) {
  try {
    const url = new URL(item.product_url || item.product?.product_url || "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:gclid|msclkid|epik|gad_source|gad_campaignid|gclsrc|fbclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = ""; url.searchParams.sort();
    const uid = url.searchParams.get("uid");
    if (/^(?:www\.)?(?:fergusonhome|build)\.com$/i.test(url.hostname) && uid && /^\d+$/.test(uid)) return `ferguson-variant:${uid}`;
    return url.href;
  } catch { return null; }
}

export function sameCompletionVariant(a: MaterialItem, b: MaterialItem) {
  const finish = (item: MaterialItem) => normalizeMaterialSuggestionLabel(item.color || item.product?.finish || "");
  if (finish(a) && finish(b) && finish(a) !== finish(b)) return false;
  const size = (item: MaterialItem) => normalizeMaterialSuggestionLabel(item.product?.selected_size || item.product?.dimensions || "");
  if (size(a) && size(b) && size(a) !== size(b)) return false;
  const aUrl = variantUrl(a); const bUrl = variantUrl(b);
  if (aUrl && bUrl && aUrl !== bUrl) return false;
  return !!(a.product_id && a.product_id === b.product_id) || !!(aUrl && aUrl === bUrl);
}

function roomSelections(shared: MaterialItem, items: MaterialItem[], rooms: Room[]) {
  const byRoom = new Map(rooms.filter(room => !isSharedCompletionRoom(room)).map(room => [room.id, room]));
  return items.filter(item => materialVisibleInProcurement(item) && byRoom.has(item.room_id) &&
    sharedSelectionCovers(shared, item.item_label, byRoom.get(item.room_id)!.name));
}

export function sharedCompletionContext(items: MaterialItem[], rooms: Room[]) {
  return sharedCompletionSelections(items, rooms).map(shared => ({
    item_id: shared.id, room_id: shared.room_id, label: shared.item_label, scope: "project_default",
    room_selections: roomSelections(shared, items, rooms).map(item => ({
      item_id: item.id, room_id: item.room_id, quantity: item.quantity,
      quantity_tbd: item.quantity_tbd === true, quantity_unit: specQuantityUnit(item),
      same_variant: sameCompletionVariant(shared, item),
    })),
  }));
}

// Validate the model's room allocation, then calculate the shared remainder
// ourselves. Seven planned sinks minus two room-specific sinks means five shared.
export function sharedCompletionQuantity(shared: MaterialItem, row: any, items: MaterialItem[], rooms: Room[]) {
  if (row.allocation_scope_complete !== true || !Array.isArray(row.quantity_allocations) || !row.quantity_allocations.length) return null;
  const sharedItems = sharedCompletionSelections(items, rooms);
  if (sharedItems.some(item => item.id !== shared.id && sharedSelectionCovers(shared, item.item_label, ""))) return null;
  const validRooms = new Map(rooms.filter(room => !isSharedCompletionRoom(room)).map(room => [room.id, room]));
  const allocations = new Map<string, number>();
  for (const allocation of row.quantity_allocations) {
    const quantity = allocation?.quantity;
    if (!validRooms.has(allocation?.room_id) || allocations.has(allocation.room_id) ||
      typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9 ||
      (row.quantity_unit === "count" && !Number.isInteger(quantity))) return null;
    allocations.set(allocation.room_id, quantity);
  }
  const local = roomSelections(shared, items, rooms);
  // An exact-variant count must include every separately selected copy. Competing
  // variants or unresolved room quantities make a proposed allocation uncertain.
  for (const item of local) {
    if (!allocations.has(item.room_id)) {
      if (sameCompletionVariant(shared, item)) return null;
      continue;
    }
    if (!sameCompletionVariant(shared, item) || item.quantity_tbd || specQuantityUnit(item) !== row.quantity_unit ||
      item.quantity == null || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
      (row.quantity_unit === "count" && !Number.isInteger(item.quantity))) return null;
    const remaining = allocations.get(item.room_id)! - item.quantity;
    if (remaining < 0) return null;
    allocations.set(item.room_id, remaining);
  }
  const quantity = [...allocations.values()].reduce((sum, value) => sum + value, 0);
  return quantity > 0 && quantity <= 1e9 ? quantity : null;
}
