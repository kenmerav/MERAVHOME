import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildClientProductName } from "@/lib/clientProductName";
import { extractMaterialPdfItemsFromText } from "@/lib/materialPdfExtract";
import { cleanUuid } from "@/lib/ids";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanImportedItems(value: unknown): ImportedPdfItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    const roomName = String(item?.room_name ?? "").trim();
    const itemLabel = String(item?.item_label ?? "").trim();
    const productUrl = String(item?.product_url ?? "").trim();
    if (!roomName || !itemLabel || !/^https?:\/\//i.test(productUrl)) return [];
    const quantity = Number(item?.quantity);
    return [{
      room_name: roomName,
      item_label: itemLabel,
      product_url: productUrl,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
      color: item?.color ? String(item.color).trim() : null,
    }];
  });
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function materialMatchKey(value: string) {
  const n = normalize(value).replace(/\bcabinetry\b/g, "cabinet").replace(/\bcabinets\b/g, "cabinet");
  if (/\bhardware\b/.test(n) && /\bknob\b|\bknobs\b|\bpull\b|\bpulls\b/.test(n)) return "cabinet hardware";
  if (/\bcabinet\b/.test(n) && /\bhardware\b|\bknob\b|\bpull\b/.test(n)) return "cabinet hardware";
  if (/\bcabinet\b/.test(n) && /\bcolor\b|\bfinish\b|\bpaint\b/.test(n)) return "cabinet finish";
  if (/\bcountertop\b|\bcountertops\b|\bcounter\b/.test(n)) return "countertop";
  if (/\bbacksplash\b/.test(n)) return "tile";
  if (/\bwallpaper\b/.test(n)) return "wallpaper";
  if (/\blimewash\b|\blime wash\b/.test(n)) return "limewash";
  if (/\bmirror\b/.test(n) && !/\bheart\b/.test(n)) return "mirror";
  if (/\bpendant\b|\bpendants\b/.test(n)) return "pendant";
  if (/\bsconce\b|\bsconces\b/.test(n)) return "sconce";
  if (/\bsink\b/.test(n)) return "sink";
  if (/\bfaucet\b/.test(n)) return "faucet";
  if (/\bpot filler\b/.test(n)) return "pot filler";
  if (/\brange hood\b/.test(n)) return "range hood";
  return n;
}

function materialImportKey(roomId: string, label: string, productUrl: string | null | undefined) {
  return `${roomId}::${materialMatchKey(label)}::${normalize(productUrl ?? "")}`;
}

function materialRoomLabelKey(roomId: string, label: string) {
  return `${roomId}::${materialMatchKey(label)}`;
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
  if (/(countertop|countertops|counter top|counter tops|slab|marble|quartz|quartzite|granite|soapstone)/.test(n)) {
    return "Countertops";
  }
  if (/(tile|stone|zellige)/.test(n)) return "Tile & Stone";
  if (/(cabinet|hardware|knob|pull)/.test(n)) return "Cabinetry & Hardware";
  if (/(floor|rug|carpet|paint|limewash|wallpaper)/.test(n)) return "Flooring & Paint";
  if (/(chair|table|sofa|cushion|drapery|basket|mirror|mobile|rack|kitchen|tent)/.test(n)) return "Accessories";
  return "Other";
}

type ImportedPdfItem = {
  room_name: string;
  item_label: string;
  product_url: string;
  quantity: number | null;
  color: string | null;
};

function pickRoomNameFromText(text: string) {
  for (const match of text.matchAll(/\/E\s*\(([^)]{2,120})\)/g)) {
    const heading = decodePdfLiteral(match[1]);
    if (!/(fixture|finish|material|selection)/i.test(heading)) continue;
    if (/materials list/i.test(heading) || /^\d+\./.test(heading.trim())) continue;
    const roomName = heading.replace(/\s*(?:fixtures?|finishes|materials?|selections?).*$/i, "").trim();
    if (roomName) return titleCase(roomName);
  }

  const taggedHeadings = Array.from(text.matchAll(/\/E\s*\(([^)]{2,120})\)/g)).map((match) =>
    decodePdfLiteral(match[1]),
  );
  const materialsListIndex = taggedHeadings.findIndex((heading) => /materials list/i.test(heading));
  if (materialsListIndex > 0) {
    const previousHeading = taggedHeadings[materialsListIndex - 1].trim();
    const looksLikeRoomName =
      previousHeading.length <= 40 &&
      !/^\d+\./.test(previousHeading) &&
      !/[|:]/.test(previousHeading) &&
      !/https?:\/\//i.test(previousHeading);
    if (looksLikeRoomName) return titleCase(previousHeading);
  }

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

function extractTaggedLabels(rawPdf: string) {
  return Array.from(rawPdf.matchAll(/\/E\s*\(([^)]{2,160})\)/g)).map((match) => decodePdfLiteral(match[1]));
}

function enrichTruncatedLabel(label: string, taggedLabels: string[]) {
  const labelKey = normalize(cleanItemLabel(label));
  if (!labelKey) return label;
  const fullLabel = taggedLabels.find((taggedLabel) => normalize(cleanItemLabel(taggedLabel)) === labelKey);
  if (!fullLabel) return label;

  const labelHasQuantity = /\b(?:QTY|QUANTITY)\s*:\s*\d/i.test(label);
  const fullHasQuantity = /\b(?:QTY|QUANTITY)\s*:\s*\d/i.test(fullLabel);
  const labelHasFinish = /\bFINISH\s*:\s*\S/i.test(label);
  const fullHasFinish = /\bFINISH\s*:\s*\S/i.test(fullLabel);
  return (!labelHasQuantity && fullHasQuantity) || (!labelHasFinish && fullHasFinish) ? fullLabel : label;
}

function isUrlLabel(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function cleanItemLabel(value: string) {
  return value
    .replace(/^\s*\d+\.\s*/, "")
    .replace(/\bHARWARE\b/gi, "HARDWARE")
    .split(/\s+\|\s+/)[0]
    .split(/\s+I\s+(?:QTY|QUANTITY)\s*:/i)[0]
    .trim();
}

function extractQuantity(value: string) {
  const match = value.match(/\b(?:QTY|QUANTITY)\s*:\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function extractColor(value: string) {
  const match = value.match(/\bFINISH\s*:\s*(.+?)(?:\s+I\s+(?:QTY|QUANTITY|SIZE)\b|\s+\|\s*(?:QTY|QUANTITY|SIZE)\b|$)/i);
  return match?.[1] ? titleCase(match[1].trim()) : null;
}

function parsePdfItem(label: string, roomName: string, productUrl: string): ImportedPdfItem | null {
  if (isUrlLabel(label) || normalize(label) === normalize(roomName)) return null;
  const itemLabel = cleanItemLabel(label);
  if (!itemLabel) return null;
  return {
    room_name: roomName,
    item_label: titleCase(itemLabel),
    product_url: productUrl,
    quantity: extractQuantity(label),
    color: extractColor(label),
  };
}

function fallbackLabelFromUrl(productUrl: string) {
  let url: URL;
  try {
    url = new URL(productUrl);
  } catch {
    return "Imported Material";
  }

  const hostAndPath = `${url.hostname} ${url.pathname}`.toLowerCase();
  if (/rangehood|range-hood|stove-hood/.test(hostAndPath)) return "Range Hood";
  if (/sconce/.test(hostAndPath)) return "Sconce";
  if (/pendant/.test(hostAndPath)) return "Pendant";
  if (/zellige|tile/.test(hostAndPath)) return "Tile";
  if (/quartzite|counter|slab/.test(hostAndPath)) return "Countertop";
  if (/sink|blanco/.test(hostAndPath)) return "Sink";
  if (/pot-filler/.test(hostAndPath)) return "Pot Filler";
  if (/faucet/.test(hostAndPath)) return "Faucet";
  if (/top-knobs|knob|pull/.test(hostAndPath)) return "Cabinet Hardware";
  if (/cabinet|sollid/.test(hostAndPath)) return "Cabinet Finish";

  const slug = url.pathname.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ");
  return slug ? titleCase(slug) : titleCase(url.hostname.replace(/^www\./, ""));
}

async function extractPdfItems(file: File): Promise<ImportedPdfItem[]> {
  const rawPdf = Buffer.from(await file.arrayBuffer()).toString("latin1");
  return extractMaterialPdfItemsFromText(rawPdf);
}

export const Route = createFileRoute("/api/import-materials-pdf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const isJsonRequest = request.headers.get("content-type")?.includes("application/json");
          const body = isJsonRequest ? await request.json() : null;
          const form = isJsonRequest ? null : await request.formData();
          const projectId = cleanUuid(isJsonRequest ? body?.project_id : form?.get("project_id"));
          const file = form?.get("pdf");
          if (!projectId) return json({ error: "Valid project_id required" }, 400);
          if (!isJsonRequest && !(file instanceof File)) return json({ error: "PDF file required" }, 400);

          const extracted = isJsonRequest ? cleanImportedItems(body?.items) : await extractPdfItems(file as File);
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
            .select("id, room_id, item_label, product_url, quantity, color, sort_order")
            .eq("project_id", projectId)
            .in("room_id", roomIds);
          if (itemsError) return json({ error: itemsError.message }, 500);

          const existingByImportKey = new Map<string, any>();
          const blankExistingByRoomLabel = new Map<string, any[]>();
          const nextSortByRoom = new Map<string, number>();
          for (const existing of existingItems ?? []) {
            existingByImportKey.set(
              materialImportKey(existing.room_id, existing.item_label, existing.product_url),
              existing,
            );
            if (!existing.product_url) {
              const key = materialRoomLabelKey(existing.room_id, existing.item_label);
              blankExistingByRoomLabel.set(key, [...(blankExistingByRoomLabel.get(key) ?? []), existing]);
            }
            nextSortByRoom.set(existing.room_id, Math.max(nextSortByRoom.get(existing.room_id) ?? 0, Number(existing.sort_order ?? 0) + 1));
          }

          let createdItems = 0;
          let updatedItems = 0;

          for (const item of extracted) {
            const room = roomByName.get(normalize(item.room_name));
            if (!room?.id) continue;
            const blankKey = materialRoomLabelKey(room.id, item.item_label);
            const blankMatches = blankExistingByRoomLabel.get(blankKey) ?? [];
            const existing = existingByImportKey.get(materialImportKey(room.id, item.item_label, item.product_url)) ?? blankMatches.shift();
            blankExistingByRoomLabel.set(blankKey, blankMatches);
            if (existing) {
              const { error } = await supabaseAdmin
                .from("material_items")
                .update({
                  product_url: item.product_url,
                  quantity: item.quantity ?? existing.quantity ?? 1,
                  color: item.color ?? existing.color ?? null,
                  scrape_status: "pending",
                  scrape_error: null,
                  not_needed: false,
                })
                .eq("id", existing.id);
              if (error) return json({ error: error.message }, 500);
              existingByImportKey.set(materialImportKey(room.id, item.item_label, item.product_url), {
                ...existing,
                product_url: item.product_url,
              });
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
              quantity: item.quantity ?? 1,
              color: item.color,
              notes: null,
              not_needed: false,
              product_id: null,
              scrape_status: "pending",
              scrape_error: null,
            });
            if (error) return json({ error: error.message }, 500);
            existingByImportKey.set(materialImportKey(room.id, item.item_label, item.product_url), {
              room_id: room.id,
              item_label: item.item_label,
              product_url: item.product_url,
            });
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
