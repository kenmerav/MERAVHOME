export function buildClientProductName(roomName: string, itemLabel: string) {
  return [roomName.trim(), itemLabel.trim()].filter(Boolean).join(" ");
}

export function clientProductName(
  item: { client_product_name?: string | null; item_label: string },
  room: { name: string },
) {
  return item.client_product_name?.trim() || buildClientProductName(room.name, item.item_label);
}
