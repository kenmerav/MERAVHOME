import type { MaterialItem } from "./db";
import { completionItems, hasCompletionValue } from "./specCompletion";
import { completionProductLink } from "./specCompletionPresentation";
import { fixtureFamily } from "./specDrawingMatches";
import type { CompletionRoom } from "./specCompletion";

/** Existing project selections are leads to investigate, not evidence of a room's choice. */
export function missingFixtureAlternatives(label: string, roomId: string, items: MaterialItem[], rooms: CompletionRoom[] = [], limit = 3) {
  const family = fixtureFamily(label);
  if (!family) return [];
  const targetRoom = rooms.find(room => room.id === roomId)?.name || "";
  const bathroom = /\b(?:bath(?:room)?|powder|toilet|sauna)\b/i;
  const targetIsBathroom = bathroom.test(targetRoom);
  const seen = new Set<string>();
  return completionItems(items).flatMap(item => {
    if (item.room_id === roomId || fixtureFamily(item.item_label || "") !== family) return [];
    const candidateRoom = rooms.find(room => room.id === item.room_id)?.name || "";
    if (targetIsBathroom && !bathroom.test(candidateRoom)) return [];
    const name = item.product?.name?.trim() || "";
    const url = completionProductLink(item.product_url || item.product?.product_url);
    if (!url || !hasCompletionValue(name) || /^(?:untitled product|product|unknown)$/i.test(name)) return [];
    const key = item.product_id || url;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ itemId: item.id, roomId: item.room_id, name, url, color: item.color || item.product?.finish || "" }];
  }).slice(0, limit);
}
