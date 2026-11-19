export function buildClientProductName(roomName: string, itemLabel: string) {
  return [roomName.trim(), itemLabel.trim()].filter(Boolean).join(" ");
}

export function clientProductName(
  item: { client_product_name?: string | null; item_label: string },
  room: { name: string },
) {
  return item.client_product_name?.trim() || buildClientProductName(room.name, item.item_label);
}

export function clientProductNameForBoardSync(
  item: { client_product_name?: string | null; item_label: string },
  previousRoomName: string | undefined,
  roomName: string,
  itemLabel: string,
) {
  const saved = item.client_product_name?.trim();
  if (
    !saved ||
    (previousRoomName &&
      (saved === buildClientProductName(previousRoomName, item.item_label) ||
        saved === buildClientProductName(previousRoomName, "Unlabeled Item")))
  ) {
    return buildClientProductName(roomName, itemLabel);
  }
  const previousPrefix = previousRoomName?.trim();
  if (
    previousPrefix &&
    roomName.trim() !== previousPrefix &&
    saved.toLowerCase().startsWith(previousPrefix.toLowerCase() + " ")
  ) {
    return buildClientProductName(roomName, saved.slice(previousPrefix.length));
  }
  return saved;
}
