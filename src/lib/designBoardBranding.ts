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

export const BOARD_TITLE_RECT = { x: 568, y: 24, width: 800, height: 72 };
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
    element.visible !== false &&
    element.x < 500 &&
    element.y + element.height > 0 &&
    element.y < 160 &&
    isDesignBoardLogo(element)
  );
}

function boardRoomHeading(page?: BrandingPage) {
  return page?.elements.find(
    (element) =>
      element.visible !== false &&
      element.type === "text" &&
      Boolean(element.text?.trim()) &&
      !isDesignBoardLogo(element) &&
      element.y + element.height > 0 &&
      element.y < 160 &&
      element.x + element.width / 2 >= 700 &&
      element.width >= 250 &&
      (element.fontSize ?? 24) >= 18,
  );
}

export function designBoardLogoRect(page?: BrandingPage, width = 340) {
  const heading = boardRoomHeading(page);
  const lineCenter = heading
    ? heading.y + heading.height / 2
    : BOARD_TITLE_RECT.y + BOARD_TITLE_RECT.height / 2;
  const scale = width / LOGO_SOURCE_WIDTH;
  return {
    x: LOGO_INSET,
    y: lineCenter - LOGO_HEADLINE_CENTER_Y * scale,
    width,
    height: LOGO_SOURCE_HEIGHT * scale,
  };
}

// Align header logos for display without rewriting saved layers or their history.
export function designBoardDisplayElement<T extends BrandingElement>(
  element: T,
  page?: BrandingPage,
): T {
  if (element.type !== "image" || !isDesignBoardLogo(element)) return element;
  return {
    ...element,
    ...(isCornerLogo(element)
      ? {
          ...designBoardLogoRect(page, element.width),
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
        }
      : {}),
    src: DESIGN_BOARD_LOGO,
    backgroundRemovedUrl: null,
    hideDetails: true,
    imageCropZoom: 1,
    imageCropX: 0,
    imageCropY: 0,
  };
}

// A rendering-only header: opening a board never writes, moves, or deletes layers.
// Existing headings and logo objects are reused, so no duplicate layers are added.
export function designBoardBranding(page: BrandingPage, roomName?: string | null) {
  const hasLogo = page.elements.some(isCornerLogo);
  const hasTitle = Boolean(boardRoomHeading(page));
  const title = roomName?.trim() || page.title.trim() || "Design Board";
  return { showLogo: !hasLogo, showTitle: !hasTitle, title };
}
