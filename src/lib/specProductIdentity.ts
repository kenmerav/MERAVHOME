// Only use a PDF filename as a review signal when the selected color independently
// corroborates it. A filename alone is not enough to identify a product.
const genericWords = new Set([
  "product", "products", "spec", "specs", "specification", "specifications", "sheet", "sheets",
  "technical", "details", "detail", "slab", "stone", "quartzite", "quartz", "marble", "tile",
  "countertop", "countertops", "floor", "flooring", "bathroom", "kitchen", "finish", "collection",
  "black", "white", "gray", "grey", "beige", "brown", "blue", "green", "red", "gold", "brass",
  "bronze", "nickel", "chrome", "silver", "natural", "ivory", "cream", "polished", "matte", "satin",
]);
const words = (value: string): string[] => value.toLowerCase().match(/[a-z0-9]+/g) || [];

// Materials are freshly read for a send; prefer their joined product over an
// older catalog cache when this exact board item already has a linked record.
export function latestBoardProduct<T extends { id: string }>(
  materialId: string | null | undefined, productId: string | null | undefined,
  materials: Array<{ id: string; product_id?: string | null; product?: T | null }>, cached?: T | null,
): T | null {
  if (!productId) return null;
  return materials.find(item => item.id === materialId && item.product_id === productId)?.product || cached || null;
}

export function pdfSelectionNameMismatch(link: string, color: string, productName: string) {
  let file: string;
  try {
    const url = new URL(link);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    file = decodeURIComponent(url.pathname.split("/").pop() || "");
  } catch { return null; }
  if (!/\.pdf$/i.test(file)) return null;
  const tokens = words(file.replace(/\.pdf$/i, ""));
  if (tokens.length !== 1 || tokens[0].length < 4 || genericWords.has(tokens[0]) || !/^[a-z]+$/.test(tokens[0])) return null;
  const candidate = tokens[0];
  const colorWords = words(color);
  const nameWords = words(productName);
  if (!colorWords.includes(candidate) || nameWords.includes(candidate)) return null;
  if (!nameWords.some(word => word.length >= 4 && !genericWords.has(word))) return null;
  return { sourceName: candidate, productName: productName.trim() };
}

// An unchanged board image with a generic label must keep its existing product.
export function keepNamedProductForGenericBoard(input: {
  boardName: string; boardPageId: string; boardElementId: string;
  boardProductId?: string | null; boardLink?: string | null; boardColor?: string | null;
  material?: { id: string; product_id?: string | null; product_url?: string | null; color?: string | null;
    source_board_page_id?: string | null; source_board_element_id?: string | null } | null;
  materialId?: string | null; productLink?: string | null;
}) {
  const norm = (v?: string | null) => (v || "").trim().toLowerCase().replace(/\s+/g, " ");
  const m = input.material;
  const name = norm(input.boardName);
  if (!/^(?:(?:kitchen|bathroom|bath|shower|floor|wall|vanity|quartzite|quartz|marble|stone)\s+)*(?:countertop|countertops|flooring|floor|tile|faucet|sink|mirror|sconce|pendant|cabinetry|cabinet|product|item)$/.test(name)) return false;
  if (!m || !input.materialId || m.id !== input.materialId || !input.boardProductId || m.product_id !== input.boardProductId ||
      m.source_board_page_id !== input.boardPageId || m.source_board_element_id !== input.boardElementId) return false;
  const link = norm(input.boardLink);
  if (!link || link !== norm(m.product_url) || link !== norm(input.productLink)) return false;
  return !norm(input.boardColor) || norm(input.boardColor) === norm(m.color);
}
