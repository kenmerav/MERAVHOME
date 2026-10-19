export const DESIGN_BOARD_LOGO = "/brand/merav-design-board-wordmark.png";

// Visually verified corner logos on existing Studio boards, October 19, 2026.
// Older uploads have screenshot/cutout filenames rather than a logo label.
const LEGACY_LOGO_FILES = [
  "1788377660755-7511bdcd-76f3-4d1a-b2c8-2374f7c7ab12",
  "1781623372042-2ba0fa5c-8de7-4a70-9636-30da22fd73d7",
  "1787766792729-fca2e12e-1104-49d9-9593-0feb1992acd2",
  "1786666605292-d9cff610-41d8-4879-92d4-b92fa21ce43c",
  "1791209619785-3bc606f7-100e-41ff-9bab-dfb2008b52e4",
  "1787075517149-77e2c50b-eec4-43c2-9194-321a5b0484b1",
  "1784221077309-dce3a655-b466-4e50-bcb2-984c7eb995ba",
  "1781615242302-2c8d2cef-ee37-4bca-b8ca-91913bbd5e48",
];

type BrandingElement = {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
  src?: string;
  originalSrc?: string;
  label?: string;
  text?: string;
  fontSize?: number;
};

export type BrandingPage = {
  title: string;
  elements: readonly BrandingElement[];
};

export const BOARD_TITLE_RECT = { x: 520, y: 38, width: 832, height: 72 };
export const BOARD_HEADER_FONT = "Montserrat, Arial, sans-serif";
export const BOARD_HEADER_FONT_SIZE = 28;
export const BOARD_HEADER_LETTER_SPACING = 2;
const LOGO_SOURCE_WIDTH = 1600;
const LOGO_SOURCE_HEIGHT = 232;
const LOGO_HEADLINE_CENTER_Y = 69;
const LOGO_INSET = 48;

export function isDesignBoardLogo(element: BrandingElement) {
  const metadata = [element.src, element.originalSrc, element.label].filter(Boolean).join(" ");
  return (
    (element.type === "image" &&
      (metadata.includes(DESIGN_BOARD_LOGO) ||
        /merav[-_ ]?(?:finalmainlogo|submark|design.board.logo)|merav.*logo|logo.*merav/i.test(
          metadata,
        ) ||
        LEGACY_LOGO_FILES.some((file) => metadata.includes(file)))) ||
    (element.type === "text" && /\bmerav\s+interiors\b/i.test(element.text ?? ""))
  );
}

function isCornerLogo(element: BrandingElement) {
  return (
    element.x < 500 &&
    element.y + element.height > 0 &&
    element.y < 160 &&
    isDesignBoardLogo(element)
  );
}

function isRoomHeading(element: BrandingElement) {
  return (
      element.type === "text" &&
      Boolean(element.text?.trim()) &&
      !isDesignBoardLogo(element) &&
      element.y + element.height > 0 &&
      element.y < 160 &&
      element.x + element.width / 2 >= 650 &&
      (element.width >= 250 || element.x >= 900) &&
      (element.fontSize ?? 24) >= 18
  );
}

function boardRoomHeading(page: BrandingPage, roomName?: string | null) {
  const candidates = page.elements.filter(element => element.visible !== false && isRoomHeading(element));
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const room = normalize(roomName?.trim() || page.title.replace(/\s*[—–-]\s*Design Board\s*\d*$/i, ""));
  // Some older templates have the project name above the room. Prefer the room line.
  return candidates.find(element => normalize(element.text ?? "") === room)
    ?? candidates.find(element => room && normalize(element.text ?? "").includes(room))
    ?? candidates[0];
}

export function designBoardLogoRect() {
  const width = 340;
  const lineCenter = BOARD_TITLE_RECT.y + BOARD_TITLE_RECT.height / 2;
  const scale = width / LOGO_SOURCE_WIDTH;
  return {
    x: LOGO_INSET,
    y: lineCenter - LOGO_HEADLINE_CENTER_Y * scale,
    width,
    height: LOGO_SOURCE_HEIGHT * scale,
  };
}

// Keep saved layers/history intact. Corner branding is replaced only at render time.
export function designBoardContentElements<T extends BrandingElement>(page: { elements: readonly T[] }) {
  return page.elements
    .filter(element => !isCornerLogo(element) && !isRoomHeading(element))
    .map(element => designBoardDisplayElement(element));
}

export function designBoardDisplayElement<T extends BrandingElement>(
  element: T,
): T {
  if (element.type !== "image" || !isDesignBoardLogo(element)) return element;
  return {
    ...element,
    src: DESIGN_BOARD_LOGO,
    backgroundRemovedUrl: null,
    hideDetails: true,
    imageCropZoom: 1,
    imageCropX: 0,
    imageCropY: 0,
  };
}

// A rendering-only header: opening a board never writes, moves, or deletes layers.
// Every surface uses one fixed header, including pages with legacy branding.
export function designBoardBranding(page: BrandingPage, roomName?: string | null) {
  const title = boardRoomHeading(page, roomName)?.text?.trim() || roomName?.trim() || page.title.trim() || "Design Board";
  return { title };
}

// Shared line breaking/font fitting for SVG previews and canvas/PDF exports.
export function designBoardTitleLayout(
  title: string,
  measureText: (text: string, fontSize: number) => number = (text, size) => text.length * size * 0.65,
) {
  const text = title.toUpperCase().replace(/\s+/g, " ").trim();
  const measure = (value: string, size: number) =>
    measureText(value, size) + Math.max(0, value.length - 1) * BOARD_HEADER_LETTER_SPACING;
  const wrap = (size: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      // Split unusually long unbroken names too; never clip a room name.
      for (const part of word.match(/.{1,32}/gu) ?? [word]) {
        const candidate = line ? `${line} ${part}` : part;
        if (line && measure(candidate, size) > BOARD_TITLE_RECT.width) {
          lines.push(line);
          line = part;
        } else line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  let fontSize = BOARD_HEADER_FONT_SIZE;
  let lines = wrap(fontSize);
  while (fontSize > 12 && (lines.length > 2 || lines.some(line => measure(line, fontSize) > BOARD_TITLE_RECT.width))) {
    lines = wrap(--fontSize);
  }
  const lineHeight = fontSize * 1.12;
  const centerY = BOARD_TITLE_RECT.y + BOARD_TITLE_RECT.height / 2;
  return {
    fontSize,
    lines: lines.map((text, index) => ({
      text,
      x: BOARD_TITLE_RECT.x + BOARD_TITLE_RECT.width,
      y: centerY + (index - (lines.length - 1) / 2) * lineHeight,
    })),
  };
}
