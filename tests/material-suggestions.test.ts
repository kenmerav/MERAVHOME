import { expect, it } from "vitest";
import { materialCoversTemplateSuggestion, suggestedTemplatesForRoom, type BathroomPlanEvidence } from "@/lib/materialSuggestions";
import { templateForRoomName } from "@/lib/roomTemplates";
import type { MaterialItem } from "@/lib/db";
const matches = (label: string, suggestion: string, patch = {}, room = "Bathroom 3") =>
  materialCoversTemplateSuggestion({ item_label: label, category: null, ...patch } as MaterialItem,
    { label: suggestion, category: "Hardware" }, room);

it.each(["Bathroom 2", "Primary Bath", "Powder Bath", "Kitchen", "Office"])("has one generic lighting suggestion in %s", room => {
  expect(templateForRoomName(room).filter(item => item.category === "Lighting").map(item => item.label)).toEqual(["Lighting"]);
  expect(templateForRoomName(room).map(item => item.label)).not.toContain("Sink Drain");
});
it.each(["Vanity Sconce", "Vanity Light", "Ceiling light", "Flush-mount", "Chandelier", "Pendant", "Ceiling Fan"])("recognizes %s as existing lighting", label => {
  for (const suggestion of ["Lighting", "Pendant", "Sconce"]) expect(matches(label, suggestion)).toBe(true);
});
it("recognizes lighting through catalog category when the material label is arbitrary", () => {
  expect(matches("Naomi", "Lighting", { category: "Other", product: { name: "Naomi", category: "Lighting" } })).toBe(true);
  expect(matches("Light Oak Cabinet", "Lighting", { category: "Cabinetry" })).toBe(false);
});
it.each(["Hooks", "Robe Hook", "Double robe hooks", "Wall hook", "Bath hook", "Towel hooks"])("recognizes %s as a bathroom towel hook", label => {
  expect(matches(label, "Towel Hook")).toBe(true);
});
it("uses catalog and product URL identity to recognize mislabeled hooks", () => {
  expect(matches("Purist", "Towel Hook", { product: { name: "Purist robe hook" } })).toBe(true);
  expect(matches("Bathroom accessory", "Towel Hook", { product_url: "https://vendor.com/purist-robe-hook" })).toBe(true);
});
it("does not confuse other accessories or notes with towel hooks", () => {
  expect(matches("Shower curtain hooks", "Towel Hook")).toBe(false);
  expect(matches("Cabinet hooks", "Towel Hook")).toBe(false);
  expect(matches("Hooks", "Towel Hook", {}, "Kitchen")).toBe(false);
  expect(matches("Towel bar", "Towel Hook", { notes: "Still need robe hook" })).toBe(false);
  expect(matches("Hand towel holder", "Towel Hook")).toBe(false);
});
it("recognizes common accessory and shower aliases without confusing toilet seats or sink drains", () => {
  expect(matches("Tissue holder", "Toilet Paper Holder")).toBe(true);
  expect(matches("Toilet roll holder", "Toilet Paper Holder")).toBe(true);
  expect(matches("Showerhead", "Shower System")).toBe(true);
  expect(matches("Shower tub combo", "Shower System")).toBe(true);
  expect(matches("Shower faucet", "Shower System")).toBe(true);
  expect(matches("Bathroom 2 shower-faucet", "Shower System")).toBe(true);
  expect(matches("Selected plumbing", "Shower System", { product: { name: "Delta Shower Faucet" } })).toBe(true);
  expect(matches("Sink faucet", "Shower System")).toBe(false);
  expect(matches("Shower drain", "Shower System")).toBe(false);
  expect(matches("Bathroom toilet", "Toilet")).toBe(true);
  expect(matches("Toilet seat", "Toilet")).toBe(false);
  expect(matches("Sink drain", "Sink", { category: "Plumbing" })).toBe(false);
  expect(matches("Stone sink with faucet hole", "Sink", { category: "Plumbing" })).toBe(true);
});
it("recognizes a toilet whose catalog title says the seat is not included", () => {
  expect(matches("Kohler Memoirs Stately Toilet with AquaPiston - Seat Not Included", "Toilet")).toBe(true);
});
const absent: BathroomPlanEvidence = { room_id: "bath-a", shower: "absent", confidence: "high", page: 4,
  sheet: "ID2.1", evidence: "Complete proposed layout shows only a toilet and vanity." };
it("lets a clearly identified shower override a powder-bath name", () => {
  expect(templateForRoomName("Powder Bathroom", true).map(item => item.label)).toContain("Shower Tile");
});
it("suppresses only shower suggestions for a confirmed no-shower bathroom", () => {
  const suggestions = suggestedTemplatesForRoom(templateForRoomName("Bathroom 3"), absent).map(item => item.label);
  expect(suggestions).not.toContain("Shower Tile"); expect(suggestions).not.toContain("Shower Drain");
  expect(suggestions).not.toContain("Shower System"); expect(suggestions).toContain("Toilet");
  expect(suggestions).toContain("Tile"); expect(suggestions).toContain("Flooring");
});
it.each([undefined, { ...absent, shower: "unknown" }, { ...absent, confidence: "medium" },
  { ...absent, evidence: "" }, { ...absent, page: null }, { ...absent, shower: "present" }])(
  "retains shower suggestions for uncertain or positive evidence: %j", evidence => {
    expect(suggestedTemplatesForRoom(templateForRoomName("Bathroom 3"), evidence as any).map(item => item.label)).toContain("Shower Tile");
  });
