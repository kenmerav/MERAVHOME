import { expect, it } from "vitest";
import type { Product } from "@/lib/db";
import {
  catalogWidth,
  rankCatalogSuggestions,
  untouchedCatalogPlaceholder,
} from "@/lib/materialCatalogSuggestions";
const product = (id: string, name: string, patch = {}) =>
  ({
    id,
    name,
    category: "Plumbing",
    subcategory: null,
    product_url: null,
    dimensions: null,
    ...patch,
  }) as Product;

it("suggests toilets, excluding toilet seats and paper holders", () => {
  const products = [
    product("toilet", "Kohler Toilet — Seat Not Included"),
    product("seat", "Kohler Toilet Seat"),
    product("paper", "Toilet Paper Holder"),
  ];
  expect(
    rankCatalogSuggestions(products, [], "project", "Bathroom", "Toilet", "Plumbing").map(
      (row) => row.product.id,
    ),
  ).toEqual(["toilet"]);
});
it("does not recommend toilet accessories or a tile named for its location", () => {
  const products = [
    product("lever", "Kohler Memoirs Left Hand Toilet Lever"),
    product("tile", "backsplash/wall tile behind toilet full wall"),
    product("lid", "Toilet Tank Lid"),
    product("wc", "Wall Hung Water Closet"),
  ];
  expect(
    rankCatalogSuggestions(products, [], "p", "Bath", "Toilet", "Plumbing").map(
      (row) => row.product.id,
    ),
  ).toEqual(["wc"]);
});
it("ranks current project use ahead of prior project use and counts projects once", () => {
  const products = [
    product("new", "New Toilet"),
    product("popular", "Popular Toilet"),
    product("same", "Same Toilet"),
  ];
  const uses = [
    { product_id: "popular", project_id: "old", room_name: "Bath" },
    { product_id: "popular", project_id: "old", room_name: "Bath 2" },
    { product_id: "same", project_id: "current", room_name: "Bath" },
  ];
  const results = rankCatalogSuggestions(products, uses, "current", "Bath", "Toilet", "Plumbing");
  expect(results.map((row) => row.product.id)).toEqual(["same", "popular", "new"]);
  expect(results[1].project_count).toBe(1);
});
it("does not suggest kitchen sinks or sink accessories for a bathroom basin", () => {
  const products = [
    product("basin", "Undermount Bathroom Sink"),
    product("kitchen", "Kitchen Sink"),
    product("faucet", "Bathroom Sink Faucet"),
    product("drain", "Bathroom Sink Drain"),
    product("rack", "Sink Grid"),
  ];
  expect(
    rankCatalogSuggestions(products, [], "p", "Powder Bath", "Sink", "Plumbing").map(
      (row) => row.product.id,
    ),
  ).toEqual(["basin"]);
});
it("rejects catalog items named for their location near a sink and bar sinks in bathrooms", () => {
  const products = [
    product("basin", "Undermount Bathroom Sink"),
    product("backsplash", "backsplash behind sink/window - whole wall"),
    product("light", "flush mount over sink"),
    product("sconce", "Sconce above bathroom sink"),
    product("bar", "bar sink"),
    product("integrated", "Countertop + Integrated Sink"),
  ];
  expect(
    rankCatalogSuggestions(products, [], "p", "Bathroom 2", "Sink", "Plumbing").map(
      (row) => row.product.id,
    ),
  ).toEqual(["integrated", "basin"]);
  expect(
    rankCatalogSuggestions([products[4]], [], "p", "Wet Bar", "Sink", "Plumbing")[0]?.product.id,
  ).toBe("bar");
});
it("filters sink mounting and explicit overall width; rejects missing sizes without guessing", () => {
  const products = [
    product("fits", "Wall Mounted Sink", { dimensions: "Width: 20 in; Depth: 18 in" }),
    product("wrong", "Undermount Sink", { dimensions: "Width: 20 in" }),
    product("unknown", "Wall Mounted Sink", { dimensions: "20 x 18" }),
    product("large", "Wall Mounted Sink", { dimensions: "Width: 30 in" }),
  ];
  const results = rankCatalogSuggestions(products, [], "p", "Powder Bath", "Sink", "Plumbing", {
    width: 20,
    mount: "wall",
  });
  expect(results.map((row) => row.product.id)).toEqual(["fits"]);
  expect(results[0].reason).toContain("confirm the cutout and plumbing");
});
it.each([
  ['Width: 20-1/2"', 20.5],
  ["20 in W x 18 in D", 20],
  ["Width: 508 mm", 20],
  ["Width: 50.8 cm", 20],
  ["Height: 20 in; Width: 24 in", 24],
])("reads only labelled overall widths: %s", (value, expected) => {
  expect(catalogWidth(value as string)).toBeCloseTo(expected as number);
});
it.each(["Basin Width: 16 in", "Cutout width: 20 in", "20 x 18", "Standard", "Height: 20 in"])(
  "does not claim a fit from uncertain dimension text: %s",
  (text) => expect(catalogWidth(text)).toBeNull(),
);
it("supports a catalog search and still labels unverified sink fit", () => {
  const results = rankCatalogSuggestions(
    [product("sink", "Bathroom Sink", { finish: "White" })],
    [],
    "p",
    "Bath",
    "Sink",
    "Plumbing",
    { search: "white" },
  );
  expect(results[0].reason).toContain("Size / fit needs confirmation");
  expect(
    rankCatalogSuggestions(
      [product("sink", "Bathroom Sink")],
      [],
      "p",
      "Bath",
      "Sink",
      "Plumbing",
      { search: "black" },
    ),
  ).toEqual([]);
});
it("only reuses untouched templates and preserves intentional edits/exclusions", () => {
  expect(untouchedCatalogPlaceholder({ is_required: true, not_needed: false })).toBe(true);
  for (const patch of [
    { product_id: "chosen" },
    { notes: "Custom basin" },
    { color: "White" },
    { quantity: 1 },
    { not_needed: true },
    { is_required: false },
    { source_board_id: "p" },
  ])
    expect(untouchedCatalogPlaceholder({ is_required: true, not_needed: false, ...patch })).toBe(
      false,
    );
});
