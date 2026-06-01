import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildClientProductName } from "@/lib/clientProductName";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function materialMatchKey(value: string) {
  const n = normalize(value).replace(/\bcabinetry\b/g, "cabinet").replace(/\bcabinets\b/g, "cabinet");
  if (/\bcabinet\b/.test(n) && /\bhardware\b|\bknob\b|\bpull\b/.test(n)) return "cabinet hardware";
  if (/\bcabinet\b/.test(n) && /\bcolor\b|\bfinish\b|\bpaint\b/.test(n)) return "cabinet finish";
  if (/\bcountertop\b|\bcountertops\b|\bcounter\b/.test(n)) return "countertop";
  if (/\bwallpaper\b/.test(n)) return "wallpaper";
  if (/\blimewash\b|\blime wash\b/.test(n)) return "limewash";
  if (/\bmirror\b/.test(n) && !/\bheart\b/.test(n)) return "mirror";
  if (/\bpendant\b/.test(n)) return "pendant";
  return n;
}

function titleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function inferCategory(label: string) {
  const n = normalize(label);
  if (/(pendant|sconce|lamp|light|chandelier)/.test(n)) return "Lighting";
  if (/(faucet|sink|shower|tub|toilet|plumbing)/.test(n)) return "Plumbing";
  if (/(tile|stone|counter|slab|marble|quartz)/.test(n)) return "Tile & Stone";
  if (/(cabinet|hardware|knob|pull)/.test(n)) return "Cabinetry & Hardware";
  if (/(floor|rug|carpet|paint|limewash|wallpaper)/.test(n)) return "Flooring & Paint";
  if (/(chair|table|sofa|cushion|drapery|basket|mirror|mobile|rack|kitchen|tent)/.test(n)) return "Accessories";
  return "Other";
}

type ImportedPdfItem = {
  room_name: string;
  item_label: string;
  product_url: string;
};

function pickRoomNameFromText(text: string) {
  const outlineTitleMatch = text.match(/\/Title\s*\(([^)]{2,80})\)[\s\S]{0,120}?\/Dest\s*\[/);
  const titleMatch = text.match(/\/Title\s*\(([^)]{2,80})\)/);
  const taggedTitleMatch = text.match(/\/T\s*\(([^)]{2,80})\)/);
  return titleCase(outlineTitleMatch?.[1] || titleMatch?.[1] || taggedTitleMatch?.[1] || "Imported Room");
}

function decodePdfLiteral(value: string) {
  return value
    .replace(/\\([\\()nrtbf])/g, (_, escaped) => {
      if (escaped === "n") return "\n";
      if (escaped === "r") return "\r";
      if (escaped === "t") return "\t";
      if (escaped === "b") return "\b";
      if (escaped === "f") return "\f";
      return escaped;
    })
    .trim();
}

function extractActionUrls(rawPdf: string) {
  const actionUrls = new Map<string, string>();
  for (const objectBlock of rawPdf.split(/\bendobj/)) {
    if (!objectBlock.includes("/S /URI")) continue;
    const objectId = objectBlock.match(/(\d+)\s+0\s+obj/)?.[1];
    const uri = objectBlock.match(/\/URI\s*\(([\s\S]*?)\)/)?.[1];
    if (objectId && uri) actionUrls.set(objectId, decodePdfLiteral(uri));
  }
  return actionUrls;
}

async function extractPdfItems(file: File): Promise<ImportedPdfItem[]> {
  const rawPdf = Buffer.from(await file.arrayBuffer()).toString("latin1");
  const roomName = pickRoomNameFromText(rawPdf);
  const actionUrls = extractActionUrls(rawPdf);
  const imported: ImportedPdfItem[] = [];
  const seen = new Set<string>();

  for (const annotation of rawPdf.split(/\bendobj/)) {
    if (!annotation.includes("/Subtype /Link")) continue;
    const actionRef = annotation.match(/\/A\s+(\d+)\s+0\s+R/)?.[1];
    const labelValue = annotation.match(/\/Contents\s*\(([\s\S]*?)\)/)?.[1];
    const url = actionRef ? actionUrls.get(actionRef) : null;
    const label = labelValue ? decodePdfLiteral(labelValue) : "";
    if (!url || !label || normalize(label) === normalize(roomName)) continue;

    const item = { room_name: roomName, item_label: titleCase(label), product_url: url };
    const key = `${normalize(item.room_name)}::${normalize(item.item_label)}::${item.product_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    imported.push(item);
  }

  return imported;
}

export const Route = createFileRoute("/api/import-materials-pdf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const projectId = String(form.get("project_id") ?? "");
          const file = form.get("pdf");
          if (!projectId) return json({ error: "project_id required" }, 400);
          if (!(file instanceof File)) return json({ error: "PDF file required" }, 400);

          const extracted = await extractPdfItems(file);
          if (!extracted.length) return json({ error: "No linked material items were found in that PDF." }, 400);

          const { data: rooms, error: roomsError } = await supabaseAdmin
            .from("rooms")
            .select("id, name, sort_order")
            .eq("project_id", projectId);
          if (roomsError) return json({ error: roomsError.message }, 500);

          const roomByName = new Map((rooms ?? []).map((room: any) => [normalize(room.name), room]));
          const maxSort = Math.max(-1, ...(rooms ?? []).map((room: any) => Number(room.sort_order ?? 0)));
          let createdRooms = 0;
          const roomSortOffset = new Map<string, number>();

          for (const item of extracted) {
            const roomKey = normalize(item.room_name);
            if (roomByName.has(roomKey)) continue;
            const sortOrder = maxSort + 1 + roomSortOffset.size;
            roomSortOffset.set(roomKey, sortOrder);
            const { data: created, error } = await supabaseAdmin
              .from("rooms")
              .insert({ project_id: projectId, name: item.room_name, sort_order: sortOrder })
              .select("id, name, sort_order")
              .single();
            if (error) return json({ error: error.message }, 500);
            roomByName.set(roomKey, created);
            createdRooms += 1;
          }

          const roomIds = Array.from(new Set(Array.from(roomByName.values()).map((room: any) => room.id)));
          const { data: existingItems, error: itemsError } = await supabaseAdmin
            .from("material_items")
            .select("id, room_id, item_label, sort_order")
            .eq("project_id", projectId)
            .in("room_id", roomIds);
          if (itemsError) return json({ error: itemsError.message }, 500);

          const existingByRoomLabel = new Map<string, any>();
          const nextSortByRoom = new Map<string, number>();
          for (const existing of existingItems ?? []) {
            existingByRoomLabel.set(`${existing.room_id}::${materialMatchKey(existing.item_label)}`, existing);
            nextSortByRoom.set(existing.room_id, Math.max(nextSortByRoom.get(existing.room_id) ?? 0, Number(existing.sort_order ?? 0) + 1));
          }

          let createdItems = 0;
          let updatedItems = 0;

          for (const item of extracted) {
            const room = roomByName.get(normalize(item.room_name));
            if (!room?.id) continue;
            const existing = existingByRoomLabel.get(`${room.id}::${materialMatchKey(item.item_label)}`);
            if (existing) {
              const { error } = await supabaseAdmin
                .from("material_items")
                .update({ product_url: item.product_url, scrape_status: "pending", scrape_error: null, not_needed: false })
                .eq("id", existing.id);
              if (error) return json({ error: error.message }, 500);
              updatedItems += 1;
              continue;
            }

            const sortOrder = nextSortByRoom.get(room.id) ?? 0;
            nextSortByRoom.set(room.id, sortOrder + 1);
            const { error } = await supabaseAdmin.from("material_items").insert({
              room_id: room.id,
              project_id: projectId,
              item_label: item.item_label,
              client_product_name: buildClientProductName(room.name, item.item_label),
              category: inferCategory(item.item_label),
              is_required: false,
              sort_order: sortOrder,
              cad_label: null,
              product_url: item.product_url,
              quantity: 1,
              color: null,
              notes: null,
              not_needed: false,
              product_id: null,
              scrape_status: "pending",
              scrape_error: null,
            });
            if (error) return json({ error: error.message }, 500);
            createdItems += 1;
          }

          return json({
            ok: true,
            imported: extracted.length,
            created_rooms: createdRooms,
            created_items: createdItems,
            updated_items: updatedItems,
            room_names: Array.from(new Set(extracted.map((item) => item.room_name))),
          });
        } catch (e: any) {
          return json({ error: e?.message || "Could not import PDF" }, 500);
        }
      },
    },
  },
});
