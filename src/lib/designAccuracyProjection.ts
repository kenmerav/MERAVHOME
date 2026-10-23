import {
  accuracyOutputs,
  type AccuracyCommand,
  type AccuracyOutput,
  type AccuracyState,
} from "./designAccuracy";
import type { RoomDesignSelection } from "./roomDesignWorkflow";
import type { MaterialItem, Product } from "./db";
import { specQuantityUnitFromSelection } from "./specQuantity";
import { roomDetailValue } from "./roomDesignDetails";
import { roomDesignTileFields } from "./roomDesignTile";

/** Fill empty draft fields from links; changed facts remain proposals, never approval evidence. */
export function accuracyImportCommands(
  state: AccuracyState,
  roomId: string,
  selections: RoomDesignSelection[],
): AccuracyCommand[] {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return [];
  const commands: AccuracyCommand[] = [];
  const reserved = new Set<string>();
  for (const selection of selections) {
    const item =
      room.items.find((i) => i.selectionId === selection.id) ??
      room.items.find(
        (i) =>
          !reserved.has(i.id) &&
          i.category.toLowerCase() === selection.category.toLowerCase() &&
          (!i.selectionId || i.selectionId === selection.id),
      );
    // Different variants in one category get separate stable requirements; never merge by SKU or family URL.
    const id = item?.id ?? `${roomId}:selection:${selection.id}`;
    reserved.add(id);
    if (!item)
      commands.push({
        type: "item",
        roomId,
        id,
        category: selection.category,
        kind: "retail",
        sizeRequired: (selection.sizeOptions?.length ?? 0) > 1,
      });
    else if ((selection.sizeOptions?.length ?? 0) > 1 && !item.sizeRequired)
      commands.push({
        type: "item",
        roomId,
        id,
        category: item.category,
        kind: item.kind,
        sizeRequired: true,
      });
    if (item?.selectionId !== selection.id)
      commands.push({ type: "bind", roomId, itemId: id, selectionId: selection.id });
    if (!item?.selectionId && (!item?.decision || item.decision.disposition === "unresolved"))
      commands.push({ type: "decision", roomId, itemId: id, disposition: "select" });
    const tile = roomDesignTileFields(selection.notes);
    const facts = { ...selection, ...selection.scrapeFacts };
    const values = {
      productName: facts.productName,
      manufacturer: facts.manufacturer || null,
      surfaceFinish: selection.surfaceFinish || null,
      sku: facts.sku || null,
      color: facts.finish || null,
      url: selection.url || null,
      imageUrl: facts.imageUrl || null,
      quantity: selection.quantity ?? null,
      quantityUnit: selection.quantityUnit || null,
      selectedSize: facts.selectedSize || null,
      overallDimensions: facts.dimensions || null,
      notes: selection.notes || null,
      grout: tile.groutColor || null,
      joint: tile.jointWidth || null,
      layout: tile.layout || null,
      direction: tile.direction || null,
      edge: tile.edgeTreatment || roomDetailValue(selection.notes, "Edge profile") || null,
      sheen: roomDetailValue(selection.notes, "Paint sheen") || null,
      thickness: roomDetailValue(selection.notes, "Material thickness") || null,
      overhang: roomDetailValue(selection.notes, "Overhang") || null,
    };
    for (const [key, value] of Object.entries(values)) {
      const field = item?.fields[key];
      if (value === null || value === "" || field?.value === value || field?.proposal === value)
        continue;
      commands.push({
        type: "field",
        roomId,
        itemId: id,
        key,
        value,
        proposal: field?.value !== undefined && field.value !== null && field.value !== "",
      });
    }
  }
  return commands;
}
/** Explicit application to the existing workflow. Unrelated/manual fields stay untouched. */
export function accuracyRoomSelections(
  state: AccuracyState,
  roomId: string,
  existing: RoomDesignSelection[],
) {
  const room = state.rooms.find((r) => r.id === roomId);
  const rows = accuracyOutputs(state);
  return existing.map((selection) => {
    const item = room?.items.find((i) => i.selectionId === selection.id);
    const row = item && rows.find((r) => r.sourceId === item.id);
    if (!item) return selection;
    if (!row) return { ...selection, state: "draft" as const };
    return {
      ...selection,
      scrapeFacts: undefined,
      productName: row.productName || selection.productName,
      vendor: row.manufacturer || selection.vendor,
      finish: row.color,
      sku: row.sku,
      dimensions: row.overallDimensions,
      selectedSize: row.selectedSize,
      url: row.url,
      imageUrl: row.imageUrl,
      quantity: row.quantity,
      quantityUnit: row.quantityUnit,
      // Purchasing waste is distinct; it is not copied to the board as an assumed design fact.
      wastePercent: 0,
      state: row.designResolved ? ("locked" as const) : ("selected" as const),
      accuracySource: { id: row.sourceId, version: row.selectionVersion },
    };
  });
}
export function projectMaterialAccuracy<T extends MaterialItem>(item: T): T {
  const fact = item.design_accuracy_fact;
  if (!fact || !fact.sourceId) return item;
  return {
    ...item,
    client_product_name: item.client_product_name || fact.productName || fact.customId,
    quantity: fact.quantity,
    quantity_tbd: fact.quantity === null,
    color: fact.color,
    image_url: fact.imageUrl || null,
    product_url: fact.url || null,
    product: {
      ...(item.product ?? {}),
      id: item.product?.id ?? item.id,
      name: fact.productName || fact.customId || item.item_label,
      vendor: fact.manufacturer,
      finish: fact.color,
      sku: fact.sku || null,
      selected_size: fact.selectedSize,
      price: fact.price === null ? null : String(fact.price),
      price_unit: fact.priceUnit === "sq ft" ? "sq_ft" : fact.priceUnit ? "unit" : null,
      dimensions: fact.overallDimensions || null,
      image_url: fact.imageUrl || null,
      product_url: fact.url || null,
    } as Product,
  };
}
export function accuracyHandoff(state: AccuracyState, kind: "board" | "spec" | "drawing-handoff") {
  return {
    kind,
    projectId: state.projectId,
    revision: state.revision,
    label: "Design draft",
    rows: accuracyOutputs(state),
  };
}

export function accuracyInvoiceTerms(fact: AccuracyOutput) {
  // A price per box can use only the checked box purchase count, never the design square feet.
  const ready =
    fact.purchaseReady && fact.purchaseQuantity !== null && fact.priceUnit === fact.purchaseUnit;
  return {
    quantity: ready ? String(fact.purchaseQuantity) : "TBD",
    quantityUnit: specQuantityUnitFromSelection(fact.purchaseUnit),
    selected: ready,
    unitPrice: fact.price === null ? "" : String(fact.price),
  };
}
