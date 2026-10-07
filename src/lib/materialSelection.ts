import type { MaterialItem } from "@/lib/db";

export function materialHasUserSelection(item: Partial<MaterialItem>) {
  return Boolean(
    item.product_id ||
    item.product ||
    item.product_url?.trim() ||
    item.image_url?.trim() ||
    item.color?.trim() ||
    item.quantity != null ||
    item.quantity_tbd === true ||
    item.quantity_unit === "square_feet" ||
    item.notes?.trim() ||
    item.cad_label?.trim() ||
    item.ordered_by ||
    item.ordered === true ||
    item.source_board_id ||
    item.source_board_page_id ||
    item.source_board_element_id ||
    item.scrape_error ||
    item.room_product,
  );
}

export function materialVisibleInProcurement(item: Partial<MaterialItem>) {
  return !item.not_needed && (item.is_required === false || materialHasUserSelection(item));
}
