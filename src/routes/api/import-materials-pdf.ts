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

function ensurePdfDomPolyfills() {
  if (!("DOMMatrix" in globalThis)) {
    class ServerDOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      m11 = 1;
      m12 = 0;
      m13 = 0;
      m14 = 0;
      m21 = 0;
      m22 = 1;
      m23 = 0;
      m24 = 0;
      m31 = 0;
      m32 = 0;
      m33 = 1;
      m34 = 0;
      m41 = 0;
      m42 = 0;
      m43 = 0;
      m44 = 1;
      is2D = true;
      isIdentity = true;

      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
          this.m11 = this.a;
          this.m12 = this.b;
          this.m21 = this.c;
          this.m22 = this.d;
          this.m41 = this.e;
          this.m42 = this.f;
        }
      }

      multiplySelf() { return this; }
      preMultiplySelf() { return this; }
      translateSelf() { return this; }
      scaleSelf() { return this; }
      rotateSelf() { return this; }
      invertSelf() { return this; }
      transformPoint(point: { x?: number; y?: number }) {
        return { x: point.x ?? 0, y: point.y ?? 0, z: 0, w: 1 };
      }
    }

    (globalThis as any).DOMMatrix = ServerDOMMatrix;
  }
}

function buildTextSegments(items: any[]): TextSegment[] {
  const textItems = items
    .map((item) => {
      const text = String(item.str ?? "").trim();
      if (!text) return null;
      const x = Number(item.transform?.[4] ?? 0);
      const y = Number(item.transform?.[5] ?? 0);
      const width = Number(item.width ?? 0);
      const height = Number(item.height || item.transform?.[0] || 10);
      return { text, xMin: x, xMax: x + width, yMin: y, yMax: y + height, yCenter: y + height / 2 };
    })
    .filter(Boolean) as TextSegment[];

  const rows: TextSegment[][] = [];
  for (const item of textItems.sort((a, b) => b.yCenter - a.yCenter || a.xMin - b.xMin)) {
    const row = rows.find((candidate) => Math.abs(candidate[0].yCenter - item.yCenter) < 3);
    if (row) row.push(item);
    else rows.push([item]);
  }

  const segments: TextSegment[] = [];
  for (const row of rows) {
    const sorted = row.sort((a, b) => a.xMin - b.xMin);
    let current: TextSegment | null = null;
    for (const item of sorted) {
      if (!current || item.xMin - current.xMax > 18) {
        current = { ...item };
        segments.push(current);
      } else {
        current.text = `${current.text} ${item.text}`.replace(/\s+/g, " ");
        current.xMax = Math.max(current.xMax, item.xMax);
        current.yMin = Math.min(current.yMin, item.yMin);
        current.yMax = Math.max(current.yMax, item.yMax);
        current.yCenter = (current.yMin + current.yMax) / 2;
      }
    }
  }

  return segments;
}

function pickRoomName(segments: TextSegment[], pageWidth: number, pageHeight: number) {
  const candidates = segments
    .filter((segment) => segment.xMin > pageWidth * 0.45 && segment.yCenter > pageHeight * 0.65)
    .sort((a, b) => (b.yMax - b.yMin) - (a.yMax - a.yMin) || b.yCenter - a.yCenter);
  return titleCase(candidates[0]?.text || "Imported Room");
}

function matchLabel(rect: number[], segments: TextSegment[]) {
  const [x1, y1, x2, y2] = rect;
  const xCenter = (x1 + x2) / 2;
  const yCenter = (y1 + y2) / 2;
  const candidates = segments
    .filter((segment) => {
      const yClose = yCenter >= segment.yMin - 8 && yCenter <= segment.yMax + 8;
      const xClose = xCenter >= segment.xMin - 10 && xCenter <= segment.xMax + 10;
      return yClose && xClose;
    })
    .sort((a, b) => {
      const ad = Math.abs(a.yCenter - yCenter) + Math.abs((a.xMin + a.xMax) / 2 - xCenter);
      const bd = Math.abs(b.yCenter - yCenter) + Math.abs((b.xMin + b.xMax) / 2 - xCenter);
      return ad - bd;
    });
  return candidates[0]?.text.trim() ?? "";
}

async function extractPdfItems(file: File): Promise<ImportedPdfItem[]> {
  ensurePdfDomPolyfills();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
  const imported: ImportedPdfItem[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    const segments = buildTextSegments(text.items);
    const roomName = pickRoomName(segments, page.view[2] - page.view[0], page.view[3] - page.view[1]);
    const annotations = await page.getAnnotations({ intent: "display" });
    const seen = new Set<string>();

    for (const annotation of annotations as any[]) {
      const url = String(annotation.url ?? "").trim();
      const rect = annotation.rect as number[] | undefined;
      if (!url || !rect?.length) continue;

      const label = matchLabel(rect, segments);
      if (!label || normalize(label) === normalize(roomName)) continue;

      const key = `${normalize(roomName)}::${normalize(label)}::${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      imported.push({ room_name: roomName, item_label: titleCase(label), product_url: url });
    }
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
