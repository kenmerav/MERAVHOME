import type { MaterialItem } from "@/lib/db";
import { hasCompletionValue, needsCompletionColor } from "@/lib/specCompletion";

export type BoardColorSuggestion = {
  status: "suggested" | "uncertain" | "unavailable";
  color: string; confidence: number; reason: string;
  source: { page_id: string; page_name: string; image_url: string } | null;
};

export function needsBoardColorSuggestion(item: MaterialItem) {
  return !item.not_needed && needsCompletionColor(item);
}

// Use the linked image itself, never a whole-room rendering or a name-only match to another item.
export function linkedBoardImage(item: MaterialItem, board: unknown) {
  if (!board || !Array.isArray((board as any).pages)) return null;
  const matches: Array<{ page_id: string; page_name: string; image_url: string; element: any }> = [];
  for (const page of (board as any).pages) {
    if (!page || typeof page.id !== "string" || !page.id || !Array.isArray(page.elements)) continue;
    for (const element of page.elements) {
      if (!element || typeof element.id !== "string" || !element.id || element.type !== "image" || typeof element.src !== "string" || !element.src.trim() ||
        element.materialExcludeFromMaterials || element.materialInfoNotNeeded) continue;
      const exactSource = item.source_board_id === item.project_id && item.source_board_page_id === page.id && item.source_board_element_id === element.id;
      const exactMaterial = element.materialItemId === item.id;
      if (!exactSource && !exactMaterial) continue;
      if (element.materialRoomId && element.materialRoomId !== item.room_id) continue;
      if (element.materialItemId && element.materialItemId !== item.id) continue;
      if (item.product_id && element.productId && element.productId !== item.product_id) continue;
      // Color-adjusted canvas pictures do not faithfully represent the underlying source image.
      if (["imageBrightness", "imageContrast", "imageSaturation", "imageWarmth"].some(key =>
        element[key] != null && element[key] !== (key === "imageWarmth" ? 0 : 100))) continue;
      const selectedLink = item.product_url || item.product?.product_url;
      if (selectedLink && element.link && selectedLink.trim() !== element.link.trim()) continue;
      matches.push({ page_id: String(page.id), page_name: String(page.name || page.title || "Design Board"), image_url: element.src.trim(), element });
    }
  }
  const urls = new Set(matches.map(match => match.image_url));
  if (urls.size !== 1) return null; // Different linked variants require staff review.
  const { element, ...source } = matches[0];
  return source;
}

export function cleanBoardColorSuggestion(value: unknown, source: NonNullable<ReturnType<typeof linkedBoardImage>>): BoardColorSuggestion {
  const row = value as any;
  const color = typeof row?.color === "string" ? row.color.trim().slice(0, 100) : "";
  const confidence = typeof row?.confidence === "number" && Number.isFinite(row.confidence) ? Math.max(0, Math.min(1, row.confidence)) : 0;
  const reason = typeof row?.reason === "string" ? row.reason.trim().slice(0, 500) : "";
  const supported = row?.status === "suggested" && confidence >= 0.8 && hasCompletionValue(color) && reason;
  return { status: supported ? "suggested" : "uncertain", color: supported ? color : "", confidence,
    reason: reason || "The image does not show the color clearly enough. Check the exact product variant.", source };
}
