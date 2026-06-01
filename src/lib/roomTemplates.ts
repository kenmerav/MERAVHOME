// Required-items templates for each room type.
// Each item has a `category` used to group products visually on the presentation page.

export type ItemTemplate = { label: string; category: string };

export const PRESET_ROOMS = [
  "Kitchen",
  "Primary Bedroom",
  "Bedroom 1",
  "Bedroom 2",
  "Primary Bathroom",
  "Bathroom 1",
  "Bathroom 2",
  "Dining Room",
  "Living Room",
  "Office",
] as const;

// All categories used across templates. Keep stable — the presentation groups by these.
export const ALL_CATEGORIES = [
  "Lighting",
  "Plumbing",
  "Tile & Stone",
  "Countertops",
  "Cabinetry & Hardware",
  "Flooring & Paint",
  "Accessories",
  "Other",
] as const;
export type ItemCategory = (typeof ALL_CATEGORIES)[number];

// Product-catalog enum values (must match the products.category enum in the DB).
// Used when saving scraped products into the catalog.
export const PRODUCT_CATEGORIES = [
  "Lighting",
  "Plumbing",
  "Hardware",
  "Appliances",
  "Flooring",
  "Tile",
  "Countertops",
  "Paint",
  "Furniture",
  "Decor",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// Map a loose template/material category to the strict product-catalog enum.
export function toProductCategory(c: string | null | undefined): ProductCategory {
  if (!c) return "Decor";
  if ((PRODUCT_CATEGORIES as readonly string[]).includes(c)) return c as ProductCategory;
  const map: Record<string, ProductCategory> = {
    "Tile & Stone": "Tile",
    Countertops: "Countertops",
    "Cabinetry & Hardware": "Hardware",
    Cabinetry: "Hardware",
    "Flooring & Paint": "Flooring",
    Accessories: "Decor",
    Other: "Decor",
    Sconce: "Lighting",
    Pendant: "Lighting",
  };
  return map[c] ?? "Decor";
}

const KITCHEN: ItemTemplate[] = [
  { label: "Pendant", category: "Lighting" },
  { label: "Sconce", category: "Lighting" },
  { label: "Lighting", category: "Lighting" },
  { label: "Faucet", category: "Plumbing" },
  { label: "Pot Filler", category: "Plumbing" },
  { label: "Sink", category: "Plumbing" },
  { label: "Tile", category: "Tile & Stone" },
  { label: "Countertop", category: "Countertops" },
  { label: "Cabinet Finish", category: "Cabinetry & Hardware" },
  { label: "Cabinet Hardware", category: "Cabinetry & Hardware" },
  { label: "Flooring", category: "Flooring & Paint" },
  { label: "Paint", category: "Flooring & Paint" },
];

const BEDROOM_OFFICE: ItemTemplate[] = [
  { label: "Lighting", category: "Lighting" },
  { label: "Sconce", category: "Lighting" },
  { label: "Flooring", category: "Flooring & Paint" },
  { label: "Paint", category: "Flooring & Paint" },
];

const LIVING_ROOM: ItemTemplate[] = [
  { label: "Lighting", category: "Lighting" },
  { label: "Tile", category: "Tile & Stone" },
  { label: "Flooring", category: "Flooring & Paint" },
  { label: "Paint", category: "Flooring & Paint" },
];

const DINING_ROOM: ItemTemplate[] = [
  { label: "Lighting", category: "Lighting" },
  { label: "Flooring", category: "Flooring & Paint" },
  { label: "Paint", category: "Flooring & Paint" },
];

const BATHROOM: ItemTemplate[] = [
  { label: "Tile", category: "Tile & Stone" },
  { label: "Shower Tile", category: "Tile & Stone" },
  { label: "Countertops", category: "Countertops" },
  { label: "Sink", category: "Plumbing" },
  { label: "Faucet", category: "Plumbing" },
  { label: "Shower System", category: "Plumbing" },
  { label: "Shower Drain", category: "Plumbing" },
  { label: "Sink Drain", category: "Plumbing" },
  { label: "Pendant", category: "Lighting" },
  { label: "Sconce", category: "Lighting" },
  { label: "Lighting", category: "Lighting" },
  { label: "Accent Mirrors", category: "Accessories" },
  { label: "Cabinetry Finish", category: "Cabinetry & Hardware" },
  { label: "Cabinet Hardware", category: "Cabinetry & Hardware" },
  { label: "Flooring", category: "Flooring & Paint" },
  { label: "Paint", category: "Flooring & Paint" },
  { label: "Towel Hook", category: "Accessories" },
  { label: "Toilet Paper Holder", category: "Accessories" },
];

export function templateForRoomName(name: string): ItemTemplate[] {
  const n = name.trim().toLowerCase();
  if (n === "kitchen") return KITCHEN;
  if (n === "living room") return LIVING_ROOM;
  if (n === "dining room") return DINING_ROOM;
  if (n === "office") return BEDROOM_OFFICE;
  if (n.includes("bathroom") || n.includes("bath")) return BATHROOM;
  if (n.includes("bedroom")) return BEDROOM_OFFICE;
  return []; // "Other" / custom rooms start empty
}
