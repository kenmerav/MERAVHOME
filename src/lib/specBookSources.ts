export type BoardSourcedMaterial = {
  id: string;
  project_id: string;
  source_board_id?: string | null;
  source_board_page_id?: string | null;
  source_board_element_id?: string | null;
};

type BoardReferences = {
  materialIds: Set<string>;
  sourceElements: Map<string, Set<string>>;
};

// Only a complete, persisted board is authoritative. Missing or malformed
// state must not make valid Materials selections disappear.
function boardReferences(state: unknown): BoardReferences | null {
  if (!state || typeof state !== "object" || !Array.isArray((state as any).pages)) return null;
  const materialIds = new Set<string>();
  const sourceElements = new Map<string, Set<string>>();
  for (const page of (state as any).pages) {
    if (!page || typeof page.id !== "string" || !page.id || !Array.isArray(page.elements)) return null;
    if (sourceElements.has(page.id)) return null;
    const elements = new Set<string>();
    for (const element of page.elements) {
      if (!element || typeof element.id !== "string" || !element.id) return null;
      elements.add(element.id);
      if (typeof element.materialItemId === "string") materialIds.add(element.materialItemId);
    }
    // Include hidden pages and repeated references on other pages. Visibility
    // in a presentation does not determine whether a material is selected.
    sourceElements.set(page.id, elements);
  }
  return { materialIds, sourceElements };
}

export function staleSpecBookMaterialIds(
  projectId: string,
  items: readonly BoardSourcedMaterial[],
  boardState: unknown,
): string[] {
  const references = boardReferences(boardState);
  if (!references) return [];
  return items.filter((item) => {
    // Keep manual Materials and legacy rows without a complete board source.
    if (item.project_id !== projectId || item.source_board_id !== projectId ||
      !item.source_board_page_id || !item.source_board_element_id) return false;
    return !references.materialIds.has(item.id) &&
      !references.sourceElements.get(item.source_board_page_id)?.has(item.source_board_element_id);
  }).map((item) => item.id);
}
