import { expect, it } from "vitest";
import { completionCatalogTemplate, completionPossibleItems } from "@/lib/specCompletionCatalog";
import { catalogProductMatches } from "@/lib/materialCatalogSuggestions";

it.each([["Kitchen sink", "Sink"], ["Primary Shower Drain", "Shower Drain"], ["Bedroom 4 Ceiling Fan", "Ceiling Fan"], ["Powder Hand Towel Holder", "Hand Towel Holder"], ["Bathroom Faucet", "Faucet"], ["Primary Shower Faucet", "Shower System"]])("uses the item type from %s for catalog lookup", (label, expected) => {
  expect(completionCatalogTemplate(label).label).toBe(expected);
});
it("keeps fan, pendant and sconce replacements in their functional type", () => {
  const product: any = { name: "Crystal Chandelier", category: "Lighting" };
  expect(catalogProductMatches(product, "Ceiling Fan", "Lighting", "Bedroom 2")).toBe(false);
  expect(catalogProductMatches({ ...product, name: "52 inch Ceiling Fan" }, "Ceiling Fan", "Lighting", "Bedroom 2")).toBe(true);
});
it("omits existing selections, explicit exclusions, and shared bathroom sinks", () => {
  const room = { id: "bath", name: "Bathroom 2" };
  const rooms = [room, { id: "shared", name: "Materials Throughout" }];
  const items: any[] = [
    { room_id: "shared", item_label: "Bathroom sinks", category: "Plumbing", product_id: "sink", is_required: false },
    { room_id: "bath", item_label: "Toilet", not_needed: true },
    { room_id: "bath", item_label: "Brass faucet", product_id: "faucet", is_required: false },
    { room_id: "bath", item_label: "Shower Drain", is_required: true, not_needed: false },
  ];
  const suggestions = completionPossibleItems(room, rooms, items);
  expect(suggestions.map(row => row.label)).not.toContain("Sink");
  expect(suggestions.map(row => row.label)).not.toContain("Toilet");
  expect(suggestions.map(row => row.label)).not.toContain("Faucet");
  expect(suggestions.find(row => row.label === "Shower Drain")?.existingItem).toBe(items[3]);
});
it("uses confirmed bathroom plans to omit shower suggestions", () => {
  const room = { id: "bath", name: "Bathroom 2" };
  expect(completionPossibleItems(room, [room], [], { room_id: room.id, shower: "absent", confidence: "high", page: 2, sheet: "A2", evidence: "No shower" }).map(row => row.label)).not.toContain("Shower Drain");
});
