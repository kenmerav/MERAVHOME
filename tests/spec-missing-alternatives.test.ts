import { expect, it } from "vitest";
import type { MaterialItem } from "@/lib/db";
import { missingFixtureAlternatives } from "@/lib/specMissingAlternatives";

const selection = (patch: Partial<MaterialItem> = {}) => ({ id: "other-toilet", room_id: "guest", item_label: "Toilet", category: "Plumbing", product_id: "toilet", not_needed: false,
  product: { id: "toilet", name: "Selected Toilet", product_url: "https://retailer.test/toilet", finish: "White" }, ...patch } as MaterialItem);

it("finds a linked current selection in another room as a lead", () => {
  expect(missingFixtureAlternatives("toilet", "primary", [selection()])).toEqual([{ itemId: "other-toilet", roomId: "guest", name: "Selected Toilet", url: "https://retailer.test/toilet", color: "White" }]);
});
it("excludes removed, unlinked, duplicate, same-room, and accessory selections", () => {
  const lead = selection();
  const rows = [lead, selection({ id: "dupe" }), selection({ id: "removed", product_id: "removed", not_needed: true }),
    selection({ id: "same-room", room_id: "primary", product_id: "same" }),
    selection({ id: "accessory", item_label: "Toilet paper holder", product_id: "paper" }),
    selection({ id: "unlinked", product_id: "unlinked", product: { ...lead.product!, product_url: null } })];
  expect(missingFixtureAlternatives("toilet", "primary", rows).map(row => row.itemId)).toEqual(["other-toilet"]);
});
it("does not treat shower faucets as sink faucets or drains as sinks", () => {
  expect(missingFixtureAlternatives("faucet", "primary", [selection({ item_label: "Shower faucet" })])).toEqual([]);
  expect(missingFixtureAlternatives("sink", "primary", [selection({ item_label: "Sink drain" })])).toEqual([]);
});
it("does not suggest a kitchen sink for a powder room", () => {
  const rooms = [{ id: "primary", name: "Powder Room 2" }, { id: "guest", name: "Kitchen" }, { id: "bath", name: "Bathroom 3" }];
  const kitchen = selection({ item_label: "Kitchen sink" });
  const bath = selection({ id: "bath-sink", room_id: "bath", item_label: "Undermount sink", product_id: "bath-sink" });
  expect(missingFixtureAlternatives("sink", "primary", [kitchen, bath], rooms).map(item => item.itemId)).toEqual(["bath-sink"]);
});
