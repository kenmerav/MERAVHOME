import type { MaterialItem } from "./db";
import type { CompletionFinding } from "./specCompletion";
import { materialVisibleInProcurement } from "./materialSelection";
import { drawingMatchItems, nativeDrawingMatches, drawingRoomHeadings } from "./specDrawingMatches";
import { drawingNameEvidence } from "./specDrawingNameMatches";
import { tileManualAnswerConfirmed, tileJointWidthConfirmed } from "./tileManualAnswers";

export const TILE_REVIEW_VERSION = "tile-installation-v1";
export type TileField = "grout" | "tile_layout";
// Installation details belong on the selected tile, not as another generic
// missing catalog product suggested independently by the AI plan comparison.
export const isTileInstallationLabel = (label: string) => /\bgrout\b|\btile (?:layout|lay|pattern)\b/i.test(label);
export type TileProof = { text: string; source: "notes" | "board" | "plans"; page: number | null; sheet: string };
export type TileInstallationReview = {
  version: string;
  document: { id: string; title: string; updated_at: string } | null;
  plan_status: "checked" | "no_document" | "unavailable";
  message: string;
  checked_items: number;
  findings: CompletionFinding[];
  covered: { item_id: string; field: TileField; evidence: TileProof[] }[];
  unverified: { item_id: string; message: string }[];
};
const identity = (item: Partial<MaterialItem>) => [item.item_label, item.client_product_name, item.product?.name, item.product?.subcategory].filter(Boolean).join(" ");
const inactive = /\b(cancel(?:ed|led)?|superseded|historical reference|reference only|not selected|no installation|do not (?:order|install)|option[, ]+not final)\b/i;
export function needsTileInstallation(item: Partial<MaterialItem> & { item_label: string }) {
  if (!materialVisibleInProcurement(item) || inactive.test(item.item_label) ||
    /^(?:CANCEL(?:ED|LED)|SUPERSEDED|HISTORICAL REFERENCE|REFERENCE ONLY|NOT SELECTED|DO NOT (?:ORDER|INSTALL))\b/i.test((item.notes || "").trim())) return false;
  const name = identity(item);
  // A tile-in drain, a slab countertop, a wood herringbone floor, or a tile
  // manufacturer's vanity is not an installed tiled surface.
  if (/\b(drains?|faucets?|sinks?|vanit(?:y|ies)|toilets?|mirrors?|pendants?|sconces?|lamps?|chandeliers?|grout|refractory|firebox|wallpaper|vinyl|laminate|hardwood|white oak|wood(?:en)? panels?|mdf)\b/i.test(name)) return false;
  if (/\b(countertops?|slabs?|plaster|limewash|roman clay)\b/i.test(name) && !/\b(?:tile|mosaic)\b/i.test(name)) return false;
  return /\b(tiles?|mosaics?|zellige|terracotta|porcelain|ceramic|pavers?)\b/i.test(name) ||
    (/\b(stone|marble|travertine|limestone)\b/i.test(name) && /\b(floor|flooring|wall|backsplash|surround)\b/i.test(name)) ||
    (/^(?:Tile|Tile & Stone)$/i.test(item.category || item.product?.category || "") && /\b(floor|wall|backsplash|shower|surround|border)\b/i.test(name));
}

// A pending choice mentioning a pattern/color is not a selection. Scope this
// per sentence so "running bond. Grout TBD" keeps the confirmed layout.
function confirmedSegments(value: string) {
  return value.replace(/\\n/g, "\n").split(/[\n;!]+|(?<!\d)\.|\.(?!\d)/).map(s => s.trim()).filter(s => s &&
    !/\b(tbd|tbc|pending|unknown|unsure|undecided|not sure|unselected|unresolved|choose|select|selection (?:still )?needed|decision needed|confirm (?:the )?(?:grout|pattern|layout)|to be (?:confirmed|selected|determined)|remain(?:s)? to be|(?:grout|layout|pattern).{0,30}(?:require|need).{0,15}(?:approval|review|confirm)|OR|versus)\b/i.test(s) &&
    !inactive.test(s) && !/\b(?:not|no) (?:yet )?(?:confirmed|selected|specified)\b/i.test(s));
}
const layout = /\b(straight[ -]?(?:set|lay)|stack(?:ed)?(?:[ -]bond)?|running[ -]bond|broken[ -]joint|herringbone|herringbione|chevron|basket[ -]?weave|brick[ -]bond|crosshatch|diagonal|checkerboard|offset(?: (?:lay|rows|pattern))?|rows? offset|octagon|hexagon|penny round)\b/i;
const width = /(?:\b(?:\d+\s+)?\d+\s*\/\s*\d+|\b\d+(?:\.\d+)?|[⅛¼⅜½¾])\s*[-–]?\s*(?:["″]|inch(?:es)?\b|in\b|mm\b|millimet(?:er|re)s?\b)/i;
const color = /\b(?:off[ -]?white|offwhite|white|black|gr[ae]y|greige|beige|ivory|cream|almond|charcoal|silver|taupe|sand|brown|tan|buff|pewter|linen|frost|bone|alabaster|bright white|warm gr[ae]y)\b/i;
const groutColor = new RegExp(`(?:${color.source})\\s+(?:colou?red\\s+)?grout\\b|\\bgrout(?:\\s+colou?r)?\\s*[:=-]?\\s*(?:(?:to be|is|in)\\s+)?(?:(?:light|medium|dark|warm|cool|bright|pure|antique)\\s+)?(?:${color.source})`, "i");
const groutWidth = new RegExp(`(?:${width.source})\\s*(?:wide\\s+)?(?:grout|joints?)\\b|\\b(?:grout|joint(?:s| width)?)\\s*[:=,-]?\\s*(?:(?:width|is|of)\\s*)?(?:${width.source})`, "i");
function groutParts(value: string) {
  // Only inspect grout/joint sentences, never mistake a tile's color/size for grout.
  const segments = confirmedSegments(value).filter(s => /\b(grout|joint(?:s)?)\b/i.test(s));
  return {
    color: segments.some(s => /\bgrout\b/i.test(s) && (/^grout colou?r\s*:\s*(?!(?:n\/a|na|none|not applicable)\s*$)\S.{1,}/i.test(s) || groutColor.test(s) || /\b(?:match(?:ing)?|blend(?:ing)?)\b/i.test(s) ||
      /\b(?:mapei|laticrete|spectralock|prism|polyblend|custom building|ardex|tec)\b.{0,60}(?:#\s*\w+|\d{2,})/i.test(s))),
    width: segments.some(s => groutWidth.test(s)),
  };
}
export function tileDetailConfirmed(field: TileField, value: string) {
  // Explicit unfinished fields must not be hidden by an older pattern or grout note.
  const labelled = value.replace(/\\n/g, "\n").split("\n").filter(line =>
    (field === "grout" ? /^\s*Grout(?: color| joint width)?\s*:/i : /^\s*Tile (?:layout|lay direction)\s*:/i).test(line));
  if (labelled.some(line => /:\s*(?:$|(?:tbd|tbc|pending|unknown|unsure|undecided|not sure|n\/a|none|not applicable)\b)/i.test(line))) return false;
  const explicit = (label: string) => value.replace(/\\n/g, "\n").split("\n")
    .find(line => new RegExp(`^\\s*${label}\\s*:`, "i").test(line))?.split(":").slice(1).join(":").trim();
  if (field === "tile_layout") {
    const pattern = explicit("Tile layout"), direction = explicit("Tile lay direction");
    if (pattern !== undefined) return tileManualAnswerConfirmed(pattern) && (direction === undefined || tileManualAnswerConfirmed(direction));
  }
  if (field === "grout") {
    const groutColor = explicit("Grout color"), jointWidth = explicit("Grout joint width");
    if (groutColor !== undefined || jointWidth !== undefined) return tileManualAnswerConfirmed(groutColor || "") &&
      !/^(?:mapei|laticrete|ardex|tec|prism|polyblend)$/i.test((groutColor || "").trim()) && tileJointWidthConfirmed(jointWidth || "");
  }
  if (field === "grout" && confirmedSegments(value).some(s => /\b(no grout(?: is)? (?:required|needed)|grout(?: is)? not (?:required|needed)|groutless|dry[ -]stack)\b/i.test(s))) return true;
  if (field === "grout") { const p = groutParts(value); return p.color && p.width; }
  return confirmedSegments(value).some(s => layout.test(s) || /\b(?:tile lay|tile layout|installation|laid|lay).{0,30}(?:like|per|as shown|see).{0,35}(?:example|photo|image|board|drawing|reference)\b/i.test(s));
}
export function tileInstallationNote(field: TileField, value: string, notes: string | null) {
  const text = value.trim();
  if (!text || text.length > 1000 || !tileDetailConfirmed(field, `${field === "grout" ? "Grout" : "Tile layout"}: ${text}`))
    throw Error(field === "grout" ? 'Enter a confirmed grout color and joint width, for example "Off-white, 1/8 inch joints".' : 'Enter a confirmed tile pattern / direction, for example "Vertical straight set".');
  const label = field === "grout" ? "Grout" : "Tile layout";
  // Replace only our own labelled line; keep every other project note intact.
  return [...(notes || "").split("\n").filter(line => !new RegExp(`^${label}:`, "i").test(line)), `${label}: ${text}`].filter(Boolean).join("\n");
}

function boardNotes(item: MaterialItem, board: any): TileProof[] {
  if (!Array.isArray(board?.pages)) return [];
  return board.pages.flatMap((page: any) => !page?.hidden && Array.isArray(page.elements) ? page.elements.flatMap((el: any) => {
    const linked = el?.materialItemId === item.id || (item.source_board_id === item.project_id &&
      item.source_board_page_id === page.id && item.source_board_element_id === el?.id);
    if (!linked || el.materialExcludeFromMaterials || (el.materialRoomId && el.materialRoomId !== item.room_id) ||
      (el.productId && item.product_id && el.productId !== item.product_id)) return [];
    return [el.notes, el.materialNotes].filter((s): s is string => typeof s === "string" && !!s.trim())
      .map(text => ({ text, source: "board" as const, page: null, sheet: "" }));
  }) : []);
}
function notesFor(item: MaterialItem, all: MaterialItem[], board: unknown): TileProof[] {
  const direct: TileProof[] = [item.notes, item.product?.notes].filter((s): s is string => !!s)
    .map(text => ({ text, source: "notes", page: null, sheet: "" }));
  direct.push(...boardNotes(item, board));
  // A separate room grout record may apply to a single tiled surface, or an
  // explicitly scoped/all-tile note. Never spread shower grout to another floor.
  const tiles = all.filter(x => x.room_id === item.room_id && needsTileInstallation(x));
  for (const other of all.filter(x => !x.not_needed && x.room_id === item.room_id && /\bgrout\b/i.test(identity(x)))) {
    const note = other.notes || "";
    const area = /\b(shower|backsplash|floor|wall)\b/i.exec(identity(item))?.[1];
    if (tiles.length !== 1 && !/\b(all (?:room )?(?:tiles?|stone)|throughout (?:this|the) room)\b/i.test(note) &&
      !(area && new RegExp(`\\b${area}\\b`, "i").test(`${other.item_label} ${note}`))) continue;
    direct.push({ text: `Grout: ${[other.color, other.product?.name, other.product?.finish].filter(Boolean).join(" ")}. ${note}`, source: "notes", page: null, sheet: "" });
  }
  // Patterned sheet mosaics already determine their own pattern, unlike a field
  // tile product photo. A field tile named Herringbone is not installation proof.
  if (/\bmosaic\b/i.test(identity(item)) && layout.test(identity(item))) direct.push({ text: `Tile layout: ${identity(item)}`, source: "notes", page: null, sheet: "" });
  return direct;
}

export function tilePlanProofs(items: MaterialItem[], rooms: { id: string; name: string }[], pages: { page: number; text: string }[]) {
  const drawingItems = drawingMatchItems(items, rooms);
  const matches = nativeDrawingMatches(pages, drawingItems);
  const proofs: Record<string, TileProof[]> = {};
  const general = pages.flatMap(page => {
    if (/\b(?:demo|demolition)\s+(?:floor\s+)?(?:plan|elevation)\b/i.test(page.text)) return [];
    const lines = page.text.split(/\n/).map(s => s.trim()).filter(Boolean);
    const headings = drawingRoomHeadings(page.page, lines.map(text => ({ text, confidence: 100 })), drawingItems, "pdf_heading");
    return lines.flatMap((line, index) => {
      const all = /^(?:NOTE\s*:\s*)?ALL\s+(?:(WALL|FLOOR|SHOWER|BACKSPLASH)\s+)?TILES?\b/i.exec(line);
      if (!all) return [];
      const universal = /\bthroughout (?:the )?(?:project|house|home)\b/i.test(line);
      if (!universal && headings.length !== 1) return [];
      let text = line;
      for (const following of lines.slice(index + 1, index + 4)) {
        if (!/^(?:GROUT|JOINT|INSTALL|PATTERN|LAYOUT)\b/i.test(following)) break;
        text += " " + following;
      }
      return [{ area: all[1], universal, roomId: headings[0]?.roomId,
        proof: { text, source: "plans" as const, page: page.page, sheet: "" } }];
    });
  });
  for (const item of items.filter(needsTileInstallation)) {
    const ref = drawingItems.find(x => x.id === item.id);
    if (!ref) continue;
    for (const match of matches.filter(x => x.itemId === item.id && ["product", "location"].includes(x.kind))) {
      const lines = pages.find(x => x.page === match.page)!.text.split(/\n/).map(s => s.trim()).filter(Boolean);
      const index = drawingNameEvidence(ref, lines, drawingItems, true)?.index ?? lines.findIndex(s => ref.sku && s.includes(ref.sku));
      if (index < 0) continue;
      // A callout's installation notes follow its identity, ending at the next
      // selection callout. Do not accept arbitrary notes elsewhere on the sheet.
      let end = Math.min(index + 12, lines.length);
      for (const other of drawingItems.filter(x => x.id !== ref.id && x.roomId === ref.roomId)) {
        const next = drawingNameEvidence(other, lines.slice(index + 3, end), drawingItems, true);
        if (next?.basis === "product_name") end = Math.min(end, index + 3 + next.index);
      }
      (proofs[item.id] ??= []).push({ text: lines.slice(index, end).join(" "), source: "plans", page: match.page, sheet: match.sheet });
    }
    for (const note of general) {
      if (note.area && !new RegExp(`\\b${note.area}\\b`, "i").test(identity(item))) continue;
      if (note.universal || note.roomId === item.room_id) (proofs[item.id] ??= []).push(note.proof);
    }
  }
  return proofs;
}

export function reviewTileInstallation(items: MaterialItem[], rooms: { id: string; name: string }[], options: {
  board?: unknown; document?: TileInstallationReview["document"]; planStatus: TileInstallationReview["plan_status"];
  pages?: { page: number; text: string }[]; planProofs?: Record<string, TileProof[]>;
}): TileInstallationReview {
  const active = items.filter(x => rooms.some(r => r.id === x.room_id));
  const tiles = active.filter(needsTileInstallation);
  const proofs = options.planProofs || tilePlanProofs(active, rooms, options.pages || []);
  const result: TileInstallationReview = { version: TILE_REVIEW_VERSION, document: options.document || null,
    plan_status: options.planStatus, message: options.planStatus === "unavailable"
      ? "Saved notes were checked. Some construction details could not be read; unverified items need a drawing review."
      : options.planStatus === "no_document" ? "Saved notes were checked. No current construction document is attached."
      : "Saved notes, linked Design Board notes and current construction callouts were checked.",
    checked_items: tiles.length, findings: [], covered: [], unverified: [] };
  for (const item of tiles) {
    const notes = notesFor(item, active, options.board);
    const sources = [...notes, ...(proofs[item.id] || [])];
    for (const field of ["grout", "tile_layout"] as const) {
      const confirmed = sources.filter(x => tileDetailConfirmed(field, x.text));
      // Color and width can be split between notes and an explicit PDF callout.
      const grout = sources.map(x => groutParts(x.text));
      const complete = field === "grout" ? !!confirmed.length || (grout.some(x => x.color) && grout.some(x => x.width)) : !!confirmed.length;
      if (complete) { result.covered.push({ item_id: item.id, field, evidence: confirmed.length ? confirmed : sources }); continue; }
      const missing = field === "grout" ? [!grout.some(x => x.color) && "grout color", !grout.some(x => x.width) && "joint width"].filter(Boolean).join(" and ") : "tile pattern / direction";
      const unverified = options.planStatus === "unavailable" || (options.document && !(proofs[item.id]?.length));
      if (unverified) result.unverified.push({ item_id: item.id, message: `${missing}: not confirmed in saved notes; the matching construction callout needs review.` });
      result.findings.push({ id: `${item.id}:${field}`, room_id: item.room_id, item_id: item.id,
        item_label: item.client_product_name || item.item_label, field, source: "details",
        message: unverified ? `Check ${missing} in the construction drawing; it could not be verified automatically.` : `Confirm ${missing} for this tiled area.`,
        current: "", suggested: "", page: null, sheet: "", evidence: "" });
    }
  }
  return result;
}
