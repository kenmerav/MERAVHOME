import { boardMaterialsFingerprint, type createBoardMaterialsSnapshot } from "./boardMaterialsSnapshot";
import type { MaterialItem } from "./db";

type Source = Pick<MaterialItem, "id" | "room_id" | "source_board_id" | "source_board_page_id" | "source_board_element_id">;
type LinkFields = { link?: string | null; materialLinkCleared?: boolean };
type Layer = LinkFields & { id: string; type: string; materialItemId?: string | null; materialRoomId?: string | null };
type Page = {
  id: string;
  roomId?: string | null;
  elements: Layer[];
  materialsSyncSnapshot?: ReturnType<typeof createBoardMaterialsSnapshot>;
  materialsSyncFingerprint?: string;
};
type Board = { pages: Page[] };
const clean = (value?: string | null) => value?.trim() || "";
const sameLink = (a: LinkFields, b: LinkFields) =>
  clean(a.link) === clean(b.link) && Boolean(a.materialLinkCleared) === Boolean(b.materialLinkCleared);

export function planMaterialBoardLink(
  state: unknown,
  projectId: string,
  source: Source,
  previousLink: string,
  nextLink: string,
) {
  const board = state as Board | null;
  if (!Array.isArray(board?.pages)) return { board: state, changed: 0, conflicts: 0 };
  let changed = 0;
  let conflicts = 0;
  const patch = { link: clean(nextLink), materialLinkCleared: !clean(nextLink) };
  const pages = board.pages.map((page) => {
    if (!Array.isArray(page.elements)) return page;
    const snapshot = page.materialsSyncSnapshot;
    const saved = new Map((snapshot?.materialImages ?? []).map(
      (item: LinkFields & { id: string }) => [item.id, item] as const,
    ));
    const applied = new Set<string>();
    const elements = page.elements.map((layer) => {
      if (layer.type !== "image") return layer;
      const roomId = page.roomId || layer.materialRoomId;
      if (roomId && roomId !== source.room_id) return layer;
      const exactSource = source.source_board_id === projectId &&
        source.source_board_page_id === page.id && source.source_board_element_id === layer.id;
      if (layer.materialItemId ? layer.materialItemId !== source.id : !exactSource) return layer;
      const baseline = saved.get(layer.id);
      // A blank legacy layer can inherit its catalog link. Do not erase a
      // different link someone deliberately entered on the board.
      if (!sameLink(layer, patch) && !(baseline ? sameLink(layer, baseline) :
        clean(layer.link) === clean(previousLink) || (!layer.materialLinkCleared && !clean(layer.link)))) {
        conflicts++;
        return layer;
      }
      if (sameLink(layer, patch) && (!baseline || sameLink(baseline, patch))) return layer;
      applied.add(layer.id);
      changed++;
      return { ...layer, ...patch };
    });
    if (!applied.size) return page;
    if (!snapshot || !Array.isArray(snapshot.materialImages)) return { ...page, elements };
    // Advance only this link's baseline. Pending edits on other fields or
    // other selections must still be detected on the next send.
    const materialsSyncSnapshot = {
      ...snapshot,
      materialImages: snapshot.materialImages.map((item) => applied.has(item.id) ? { ...item, ...patch } : item),
    };
    return {
      ...page, elements, materialsSyncSnapshot,
      materialsSyncFingerprint: boardMaterialsFingerprint(materialsSyncSnapshot),
    };
  });
  return { board: changed ? { ...board, pages } : state, changed, conflicts };
}
