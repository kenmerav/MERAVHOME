// Extension imports add a layer to an existing board, not replace its settings.
// Preserve fields owned by other Studio workflows, including future metadata.
export type ExtensionBoardPage<Element extends object> = {
  [key: string]: unknown;
  id: string;
  title: string;
  roomId: string | null;
  elements: Element[];
};

export type ExtensionBoardState<Element extends object> = {
  [key: string]: unknown;
  pages: ExtensionBoardPage<Element>[];
  selectedPageId: string;
  comments: unknown[];
  versions: unknown[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeExtensionBoardState<Element extends object = Record<string, unknown>>(
  value: unknown,
): ExtensionBoardState<Element> {
  const candidate = isObject(value) ? value : {};
  const pages = Array.isArray(candidate.pages)
    ? candidate.pages.flatMap((page, index) => {
        if (!isObject(page)) return [];
        return [{
          ...page,
          id: typeof page.id === "string" && page.id ? page.id : crypto.randomUUID(),
          title: typeof page.title === "string" ? page.title : `Design Board ${index + 1}`,
          roomId: typeof page.roomId === "string" && page.roomId ? page.roomId : null,
          elements: Array.isArray(page.elements)
            ? page.elements.filter(isObject) as Element[]
            : [],
        }];
      })
    : [];
  const safePages = pages.length
    ? pages
    : [{ id: "board-1", title: "Design Board 1", roomId: null, elements: [] }];
  const selectedPageId = typeof candidate.selectedPageId === "string" &&
    safePages.some((page) => page.id === candidate.selectedPageId)
    ? candidate.selectedPageId : safePages[0].id;
  return {
    ...candidate,
    pages: safePages,
    selectedPageId,
    comments: Array.isArray(candidate.comments) ? candidate.comments : [],
    versions: Array.isArray(candidate.versions) ? candidate.versions : [],
  };
}
