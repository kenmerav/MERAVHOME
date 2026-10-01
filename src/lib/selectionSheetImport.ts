import { inferMaterialCategory } from "./roomTemplates";

export type SelectionSheetRow = {
  sourceId: string;
  room: string;
  item: string;
  name: string;
  vendor: string | null;
  finish: string | null;
  dimensions: string | null;
  quantity: number | null;
  productUrl: string | null;
  status: string;
  notes: string | null;
  category: string;
};

export const selectedSheetStatus = (status: string) =>
  /^(selected(?:; details open)?|purchased)$/i.test(status.trim());

export const SOURCE_ROOM_TARGET = "__keep_source_room__";

export function blankMissing(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return !text || /^(tbd|n\/?a|n\.a\.|not provided|not specified|unknown|none|[-—])$/i.test(text)
    ? null
    : text;
}

const key = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// RFC 4180 fields, including quoted multiline notes and escaped quotes.
export function readSelectionCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field === "") quoted = !quoted;
      else throw new Error("A CSV quote must begin a field or be escaped.");
    } else if (!quoted && char === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export function parseSelectionSheet(text: string): SelectionSheetRow[] {
  const [headers, ...data] = readSelectionCsv(text);
  if (!headers?.length) throw new Error("The CSV is empty.");
  const columns = headers.map(key);
  const has = (...aliases: string[]) => aliases.some((alias) => columns.includes(key(alias)));
  if (!has("Room / area", "Room") || !has("Item", "Item label") || !has("ID", "Source ID")) {
    throw new Error("Include ID, Room, and Item columns. Export the Selections tab as CSV.");
  }
  const ids = new Set<string>();
  return data.map((cells, index) => {
    if (cells.length !== headers.length)
      throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
    const get = (...aliases: string[]) => {
      const column = columns.findIndex((name) => aliases.some((alias) => name === key(alias)));
      return column < 0 ? "" : cells[column].trim();
    };
    const sourceId = get("ID", "Source ID");
    const room = get("Room / area", "Room");
    const item = get("Item", "Item label");
    if (!sourceId || !room || !item)
      throw new Error(`CSV row ${index + 2} needs an ID, room and item.`);
    if (!/^[\w.-]{1,100}$/.test(sourceId))
      throw new Error(`Invalid selection ID on row ${index + 2}.`);
    if (ids.has(sourceId)) throw new Error(`Duplicate selection ID: ${sourceId}.`);
    ids.add(sourceId);
    const productUrl = blankMissing(get("Product link", "Product URL"));
    if (productUrl) {
      let url: URL;
      try {
        url = new URL(productUrl);
      } catch {
        throw new Error(`Invalid product link for ${sourceId}.`);
      }
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error(`Invalid product link for ${sourceId}.`);
    }
    const quantityText = blankMissing(get("Quantity", "Qty"));
    const quantity = quantityText === null ? null : Number(quantityText);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0))
      throw new Error(`Invalid quantity for ${sourceId}.`);
    const noteFields = [
      ["Dimensions / quantity", get("Dimensions / quantity")],
      ["Installation", get("Installation / layout notes", "Installation")],
      ["Still needed", get("Still needed")],
      ["Notes", get("Notes")],
      ["Source date", get("Source date")],
      ["Source", get("Source")],
      ["Source link", get("Source link")],
    ].filter(([, value]) => blankMissing(value));
    return {
      sourceId,
      room,
      item,
      name: blankMissing(get("Product / direction", "Product", "Product name")) ?? item,
      vendor: blankMissing(get("Brand / supplier", "Vendor", "Brand")),
      finish: blankMissing(get("Finish / model", "Finish")),
      // A mixed dimensions/quantity column is kept as a note, never guessed into quantity.
      dimensions: blankMissing(get("Dimensions")),
      quantity,
      productUrl,
      status: get("Status"),
      notes: noteFields.map(([label, value]) => `${label}: ${value}`).join("\n") || null,
      category: get("Category") || inferMaterialCategory(item, productUrl),
    };
  });
}

export function selectionImportMarker(projectId: string, sourceId: string) {
  return `Selection reference: ${projectId}/${sourceId}`;
}

export async function selectionImportId(reference: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reference)),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function selectionImportNotes(projectId: string, row: SelectionSheetRow) {
  return [
    selectionImportMarker(projectId, row.sourceId),
    `Source area: ${row.room}`,
    row.status ? `Selection status: ${row.status}` : null,
    row.notes,
  ]
    .filter(Boolean)
    .join("\n");
}

export type ExistingSelection = {
  id: string;
  room_id: string;
  item_label: string;
  product_url?: string | null;
  product_id?: string | null;
  client_product_name?: string | null;
  color?: string | null;
  quantity?: number | null;
  notes?: string | null;
  not_needed?: boolean;
  product?: {
    name?: string | null;
    vendor?: string | null;
    finish?: string | null;
    dimensions?: string | null;
  } | null;
};

export function matchSelectionImport(
  projectId: string,
  roomId: string,
  row: SelectionSheetRow,
  existing: ExistingSelection[],
) {
  const inRoom = existing.filter((entry) => entry.room_id === roomId);
  const marker = selectionImportMarker(projectId, row.sourceId);
  const references = inRoom.filter((entry) => entry.notes?.split("\n").includes(marker));
  if (references.length > 1)
    throw new Error(`Multiple existing entries match ${row.sourceId}; resolve them before import.`);
  if (references[0]) return references[0];
  const equivalent = inRoom.filter(
    (entry) =>
      entry.product_id &&
      key(entry.item_label) === key(row.item) &&
      key(entry.product?.name ?? entry.client_product_name ?? "") === key(row.name) &&
      (!row.productUrl || entry.product_url === row.productUrl) &&
      (!row.vendor || key(entry.product?.vendor ?? "") === key(row.vendor)) &&
      (!row.finish || key(entry.color ?? entry.product?.finish ?? "") === key(row.finish)) &&
      (!row.dimensions || key(entry.product?.dimensions ?? "") === key(row.dimensions)),
  );
  if (equivalent.length > 1)
    throw new Error(`Multiple selected ${row.item} entries match; review them before import.`);
  if (equivalent[0]) return equivalent[0];
  // Fill one genuinely empty checklist slot, preserving existing selected variants.
  const empty = inRoom.filter(
    (entry) =>
      key(entry.item_label) === key(row.item) &&
      !entry.product_id &&
      !entry.product_url &&
      !entry.not_needed,
  );
  if (empty.length > 1)
    throw new Error(`Multiple empty ${row.item} entries need review in this room.`);
  return empty[0] ?? null;
}

export function fillSelectionBlanks(
  projectId: string,
  row: SelectionSheetRow,
  existing: ExistingSelection | null,
) {
  const notes = selectionImportNotes(projectId, row);
  const marker = selectionImportMarker(projectId, row.sourceId);
  return {
    // Reimports fill missing fields; a spreadsheet blank never clears existing work.
    product_url: existing?.product_url || row.productUrl,
    client_product_name: existing?.client_product_name || row.name,
    color: existing?.color || row.finish,
    quantity: existing?.quantity ?? row.quantity,
    notes: existing?.notes?.split("\n").includes(marker)
      ? existing.notes
      : [existing?.notes, notes].filter(Boolean).join("\n\n"),
  };
}
