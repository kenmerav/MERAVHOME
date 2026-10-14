import type { MaterialItem } from "@/lib/db";
import type { CompletionRoom } from "@/lib/specCompletion";
import { inferMaterialCategory, templateForRoomName, type ItemTemplate } from "@/lib/roomTemplates";
import { materialCoversTemplateSuggestion, normalizeMaterialSuggestionLabel, suggestedTemplatesForRoom, type BathroomPlanEvidence } from "@/lib/materialSuggestions";
import { untouchedCatalogPlaceholder } from "@/lib/materialCatalogSuggestions";
import { sharedCompletionCoversMissing } from "@/lib/specSharedMaterials";

// Catalog search uses the functional item type, rather than room-prefixed labels.
export function completionCatalogTemplate(label: string, category?: string | null): ItemTemplate {
  const text = normalizeMaterialSuggestionLabel(label);
  const types: [RegExp, string, string][] = [
    [/\bshower.*drain\b/, "Shower Drain", "Plumbing"],
    [/\b(?:sink|basin|lavatory).*drain\b/, "Sink Drain", "Plumbing"],
    [/\b(?:toilet paper|toilet roll|tissue|tp).*holder\b/, "Toilet Paper Holder", "Hardware"],
    [/\b(?:hand towel holder|towel ring|towel bar)\b/, "Hand Towel Holder", "Hardware"],
    [/\b(?:towel|robe).*hook\b/, "Towel Hook", "Hardware"],
    [/\b(?:cabinet hardware|knobs?|pulls?|latches?)\b/, "Cabinet Hardware", "Hardware"],
    [/\bshower (?:system|trim|valve|head|faucet)\b/, "Shower System", "Plumbing"],
    [/\bfaucets?\b/, "Faucet", "Plumbing"],
    [/\b(?:sinks?|basins?|lavator(?:y|ies))\b/, "Sink", "Plumbing"],
    [/\b(?:toilets?|water closet)\b/, "Toilet", "Plumbing"],
    [/\bshower.*tile\b/, "Shower Tile", "Tile & Stone"],
    [/\bceiling fans?\b/, "Ceiling Fan", "Lighting"],
    [/\bsconces?\b/, "Sconce", "Lighting"],
    [/\bpendants?\b/, "Pendant", "Lighting"],
    [/\b(?:lights?|lighting|chandeliers?)\b/, "Lighting", "Lighting"],
    [/\b(?:mirrors?|medicine cabinet)\b/, "Accent Mirrors", "Accent Mirrors"],
    [/\bcounter ?tops?\b/, "Countertops", "Countertops"],
    [/\b(?:cabinet|cabinetry).*(?:finish|paint|color|stain)\b/, "Cabinetry Finish", "Cabinetry"],
    [/\b(?:paint|limewash|roman clay)\b/, "Paint", "Paint"],
    [/\b(?:flooring|wood floor|carpet)\b/, "Flooring", "Flooring"],
    [/\btiles?\b/, "Tile", "Tile & Stone"],
  ];
  const match = types.find(([pattern]) => pattern.test(text));
  return match ? { label: match[1], category: match[2] } : { label, category: category || inferMaterialCategory(label) };
}

export function completionPossibleItems(room: CompletionRoom, rooms: CompletionRoom[], items: MaterialItem[], evidence?: BathroomPlanEvidence) {
  const local = items.filter(item => item.room_id === room.id);
  return suggestedTemplatesForRoom(templateForRoomName(room.name, evidence?.shower === "present"), evidence).flatMap(template => {
    if (sharedCompletionCoversMissing(items, rooms, room.id, template.label) || local.some(item =>
      (item.not_needed || !untouchedCatalogPlaceholder(item)) && materialCoversTemplateSuggestion(item, template, room.name))) return [];
    return [{ ...template, existingItem: local.find(item =>
      untouchedCatalogPlaceholder(item) && normalizeMaterialSuggestionLabel(item.item_label) === normalizeMaterialSuggestionLabel(template.label)) ?? null }];
  });
}
