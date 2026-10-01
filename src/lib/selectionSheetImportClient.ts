import { supabase } from "@/integrations/supabase/client";
import type { MaterialItem, Product, Room } from "./db";
import { toProductCategory } from "./roomTemplates";
import {
  fillSelectionBlanks,
  matchSelectionImport,
  selectionImportId,
  selectionImportMarker,
  SOURCE_ROOM_TARGET,
  type SelectionSheetRow,
} from "./selectionSheetImport";

export async function importSelectionSheet(
  projectId: string,
  rows: SelectionSheetRow[],
  roomMapping: Record<string, string[]>,
  progress: (saved: number, total: number) => void,
) {
  // Use the signed-in browser client and existing RLS; no privileged import endpoint.
  const [roomsResult, itemsResult] = await Promise.all([
    supabase.from("rooms").select("*").eq("project_id", projectId),
    supabase.from("material_items").select("*, product:products(*)").eq("project_id", projectId),
  ]);
  for (const result of [roomsResult, itemsResult]) if (result.error) throw result.error;
  const rooms = (roomsResult.data ?? []) as Room[];
  const items = (itemsResult.data ?? []) as MaterialItem[];
  const products = new Map<string, Product>();
  const resolvedMapping = { ...roomMapping };
  const plannedRooms: Array<{ id: string; project_id: string; name: string; sort_order: number }> =
    [];
  const normalizeRoom = (name: string) => name.trim().toLowerCase();
  for (const area of new Set(rows.map((row) => row.room))) {
    const targets = [...new Set(roomMapping[area] ?? [])];
    if (!targets.includes(SOURCE_ROOM_TARGET)) continue;
    if (targets.length !== 1)
      throw new Error(`Choose the source room or existing rooms for ${area}.`);
    const matching = rooms.filter((room) => normalizeRoom(room.name) === normalizeRoom(area));
    if (matching.length > 1)
      throw new Error(`Multiple project rooms are named ${area}; choose one.`);
    if (matching[0]) {
      resolvedMapping[area] = [matching[0].id];
      continue;
    }
    const planned = {
      id: await selectionImportId(`selection-room:${projectId}:${normalizeRoom(area)}`),
      project_id: projectId,
      name: area.trim(),
      sort_order: Math.max(-1, ...rooms.map((room) => room.sort_order ?? 0)) + 1,
    };
    plannedRooms.push(planned);
    rooms.push(planned as Room);
    resolvedMapping[area] = [planned.id];
  }
  const allowedRooms = new Set(rooms.map((room) => room.id));
  const work = rows.flatMap((row) => {
    const targets = [...new Set(resolvedMapping[row.room] ?? [])];
    if (!targets.length) throw new Error(`Assign a room for ${row.room}.`);
    if (targets.length > 1 && row.quantity !== null)
      throw new Error(
        `Assign ${row.sourceId} to one room so its stated quantity is not counted twice.`,
      );
    return targets.map((roomId) => {
      if (!allowedRooms.has(roomId)) throw new Error("The selected room is not in this project.");
      return { row, roomId, existing: matchSelectionImport(projectId, roomId, row, items) };
    });
  });
  const matchedIds = new Set<string>();
  for (const { existing } of work) {
    if (!existing) continue;
    if (matchedIds.has(existing.id))
      throw new Error(
        "Two selections match the same existing entry; review the room assignments before import.",
      );
    matchedIds.add(existing.id);
  }
  // All ambiguous matches and room assignments are checked before the first write.
  for (const room of plannedRooms) {
    const result = await supabase.from("rooms").insert(room).select("id").single();
    if (result.error) throw result.error;
  }
  let saved = 0,
    created = 0,
    updated = 0;
  for (const { row, roomId, existing } of work) {
    const marker = selectionImportMarker(projectId, row.sourceId);
    let productId = existing?.product_id;
    if (!productId) {
      const importProductId = await selectionImportId(
        `selection-product:${projectId}:${row.sourceId}`,
      );
      let product = products.get(importProductId);
      if (!product) {
        const lookup = await supabase
          .from("products")
          .select("*")
          .eq("id", importProductId)
          .maybeSingle();
        if (lookup.error) throw lookup.error;
        product = (lookup.data as Product | null) ?? undefined;
      }
      if (!product) {
        const result = await supabase
          .from("products")
          .insert({
            id: importProductId,
            name: row.name,
            category: toProductCategory(row.category),
            vendor: row.vendor,
            finish: row.finish,
            dimensions: row.dimensions,
            product_url: row.productUrl,
            image_url: null,
            notes: marker,
          })
          .select("*")
          .single();
        if (result.error) throw result.error;
        product = result.data as Product;
      }
      products.set(importProductId, product);
      productId = product.id;
    }
    const patch = { ...fillSelectionBlanks(projectId, row, existing), product_id: productId };
    if (existing) {
      const result = await supabase
        .from("material_items")
        .update(patch)
        .eq("id", existing.id)
        .eq("project_id", projectId)
        .select("id")
        .single();
      if (result.error) throw result.error;
      updated++;
    } else {
      const sortOrder =
        Math.max(
          -1,
          ...items.filter((item) => item.room_id === roomId).map((item) => item.sort_order ?? 0),
        ) + 1;
      const result = await supabase
        .from("material_items")
        .insert({
          id: await selectionImportId(`selection-material:${projectId}:${roomId}:${row.sourceId}`),
          ...patch,
          project_id: projectId,
          room_id: roomId,
          item_label: row.item,
          category: row.category,
          is_required: false,
          sort_order: sortOrder,
          not_needed: false,
          scrape_status: row.productUrl ? "pending" : "skipped",
        })
        .select("*")
        .single();
      if (result.error) throw result.error;
      items.push(result.data as MaterialItem);
      created++;
    }
    progress(++saved, work.length);
  }
  return { created, updated, saved };
}
