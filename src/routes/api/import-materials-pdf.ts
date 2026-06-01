import { createFileRoute } from "@tanstack/react-router";
import type { PDFParse } from "pdf-parse";
import pdfWorkerSource from "pdfjs-dist/legacy/build/pdf.worker.mjs?raw";
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

type TextSegment = {
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  yCenter: number;
};

type ImportedPdfItem = {
  room_name: string;
  item_label: string;
  product_url: string;
};

function ensurePdfJsGlobals() {
  const globalScope = globalThis as typeof globalThis & {
    DOMMatrix?: typeof DOMMatrix;
    ImageData?: typeof ImageData;
    Path2D?: typeof Path2D;
  };

  if (!globalScope.DOMMatrix) {
    globalScope.DOMMatrix = class DOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;

      constructor(init?: number[] | string) {
        if (Array.isArray(init)) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }

      multiplySelf() { return this; }
      preMultiplySelf() { return this; }
      translateSelf() { return this; }
      scaleSelf() { return this; }
      rotateSelf() { return this; }
      invertSelf() { return this; }
      transformPoint(point?: { x?: number; y?: number }) {
        return { x: point?.x ?? 0, y: point?.y ?? 0 };
      }
    } as typeof DOMMatrix;
  }

  if (!globalScope.ImageData) {
    globalScope.ImageData = class ImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    } as typeof ImageData;
  }

  if (!globalScope.Path2D) {
    globalScope.Path2D = class Path2D {} as typeof Path2D;
  }
}

function pickRoomNameFromText(text: string) {
  const nonLinkLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("](") && !line.startsWith("--"));
  const uppercaseLines = nonLinkLines.filter((line) => /^[A-Z0-9' &/-]+$/.test(line));
  return titleCase(uppercaseLines[1] || uppercaseLines[0] || "Imported Room");
}

function extractMarkdownLinks(text: string, roomName: string): ImportedPdfItem[] {
  const imported: ImportedPdfItem[] = [];
  const seen = new Set<string>();
  const linkPattern = /\[([^\]]+)\]\((https?:[^)]+)\)([A-Z])?/g;
  for (const match of text.matchAll(linkPattern)) {
    const rawLabel = `${match[1]}${match[3] ?? ""}`.trim();
    const url = match[2].trim();
    if (!rawLabel || !url || normalize(rawLabel) === normalize(roomName)) continue;

    const item = {
      room_name: roomName,
      item_label: titleCase(rawLabel),
      product_url: url,
    };
    const key = `${normalize(item.room_name)}::${normalize(item.item_label)}::${item.product_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    imported.push(item);
  }
  return imported;
}

async function extractPdfItems(file: File): Promise<ImportedPdfItem[]> {
  let parser: PDFParse | null = null;
  try {
    ensurePdfJsGlobals();
    const { PDFParse } = await import("pdf-parse");
    PDFParse.setWorker(`data:text/javascript;base64,${Buffer.from(pdfWorkerSource).toString("base64")}`);
    parser = new PDFParse({ data: Buffer.from(await file.arrayBuffer()) });
    const [info, textResult] = await Promise.all([
      parser.getInfo(),
      parser.getText({ parseHyperlinks: true }),
    ]);
    const outlineTitle = info.outline?.find((item: any) => item?.title)?.title;
    const roomName = titleCase(outlineTitle || pickRoomNameFromText(textResult.text));
    return extractMarkdownLinks(textResult.text, roomName);
  } finally {
    await parser?.destroy();
  }
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
