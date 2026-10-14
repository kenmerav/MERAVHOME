export function extensionImportDestination(
  input: {
    destination?: unknown;
    roomId?: string;
    requiredItemKey?: string;
  },
  roomDesignProject: boolean,
): "room_design" | "design_board" {
  if (input.destination === "room_design" || input.destination === "design_board")
    return input.destination;
  if (input.destination !== undefined && input.destination !== null && input.destination !== "")
    throw new Error(
      "The extension sent an unrecognized destination. Reload the MERAV extension and choose the destination again.",
    );
  if (input.roomId && input.requiredItemKey) return "room_design";
  if (roomDesignProject)
    throw new Error(
      "The extension did not confirm a destination for this Room Design project. Reload the MERAV extension, then choose the room and product type again. Nothing was imported.",
    );
  return "design_board";
}
