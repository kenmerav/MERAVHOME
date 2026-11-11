import type { MaterialItem } from "./db";
import { specQuantityUnitFromSelection } from "./specQuantity";

export type BoardMaterialSnapshotItem = {
  id: string;
  src: string | null;
  label: string | null;
  notes: string | null;
  link: string | null;
  materialLinkCleared: boolean;
  productId: string | null;
  productName: string | null;
  finish: string | null;
  materialRoomId: string | null;
  materialCategory: string | null;
  materialQuantity: number | null;
  materialQuantityTbd?: boolean;
  materialQuantityUnit?: string;
  materialWastePercent?: number;
  materialFinish: string | null;
  materialDimensions: string | null;
  materialInfoNotNeeded: boolean;
  materialInfoSkipApproved: boolean;
  materialExcludeFromMaterials: boolean;
};

export type BoardMaterialChange =
  | "room" | "label" | "notes" | "link" | "product" | "color" | "dimensions" | "image"
  | "category" | "quantity" | "inclusion";

/** Compare board to board, so an edit in Materials never looks like a board edit. */
export function boardMaterialChanges(
  before: BoardMaterialSnapshotItem,
  after: BoardMaterialSnapshotItem,
  previousRoomId: string | null,
  nextRoomId: string | null,
): Set<BoardMaterialChange> {
  const changes = new Set<BoardMaterialChange>();
  const text = (value?: string | null) => value?.trim() || "";
  const add = (field: BoardMaterialChange, left?: string | null, right?: string | null) => {
    if (text(left) !== text(right)) changes.add(field);
  };
  add("room", previousRoomId, nextRoomId);
  add("label", before.label, after.label);
  add("notes", before.notes, after.notes);
  add("link", before.link, after.link);
  if (before.materialLinkCleared !== after.materialLinkCleared) changes.add("link");
  add("product", before.productId, after.productId);
  add("product", before.productName, after.productName);
  add("color", before.materialFinish || before.finish, after.materialFinish || after.finish);
  add("dimensions", before.materialDimensions, after.materialDimensions);
  add("image", before.src, after.src);
  add("category", before.materialCategory, after.materialCategory);
  if (before.materialExcludeFromMaterials !== after.materialExcludeFromMaterials) changes.add("inclusion");
  // Compare recorded quantities, including blanks, rather than numbers now saved in Materials.
  if (
    before.materialQuantity !== after.materialQuantity ||
    Boolean(before.materialQuantityTbd) !== Boolean(after.materialQuantityTbd) ||
    specQuantityUnitFromSelection(before.materialQuantityUnit) !==
      specQuantityUnitFromSelection(after.materialQuantityUnit) ||
    (before.materialWastePercent || 0) !== (after.materialWastePercent || 0)
  ) changes.add("quantity");
  return changes;
}

export function boardMaterialFieldsForChanges(
  patch: Partial<MaterialItem>,
  changes: ReadonlySet<BoardMaterialChange>,
  replacement: boolean,
): Partial<MaterialItem> {
  const fields: Partial<MaterialItem> = {};
  if (changes.has("room")) fields.room_id = patch.room_id;
  if (changes.has("label")) {
    fields.item_label = patch.item_label;
    if (patch.client_product_name !== undefined) fields.client_product_name = patch.client_product_name;
  }
  if (changes.has("category")) fields.category = patch.category;
  if (changes.has("notes")) fields.notes = patch.notes;
  if (changes.has("link") || replacement) fields.product_url = patch.product_url;
  if (changes.has("color") || replacement) fields.color = patch.color;
  if (changes.has("image") || replacement) fields.image_url = patch.image_url;
  if (changes.has("product") || changes.has("dimensions") || replacement) {
    fields.product_id = patch.product_id;
  }
  return fields;
}

export function planBoardMaterialLayer(
  before: BoardMaterialSnapshotItem | undefined,
  after: BoardMaterialSnapshotItem,
  previousRoomId: string | null,
  nextRoomId: string | null,
  hasSavedMaterial: boolean,
  restored = false,
) {
  const changes = before ? boardMaterialChanges(before, after, previousRoomId, nextRoomId) :
    new Set<BoardMaterialChange>();
  if (restored) changes.add("inclusion");
  return { changes, send: changes.size > 0 || (!before && !hasSavedMaterial) };
}

export function boardMaterialWasRemoved(
  item: MaterialItem, projectId: string, pageIds: ReadonlySet<string>,
  activeLayerIds: ReadonlySet<string>, retainedMaterialIds: ReadonlySet<string>,
) {
  return !item.not_needed && item.source_board_id === projectId &&
    !!item.source_board_page_id && pageIds.has(item.source_board_page_id) &&
    !!item.source_board_element_id && !activeLayerIds.has(item.source_board_element_id) &&
    !retainedMaterialIds.has(item.id);
}
