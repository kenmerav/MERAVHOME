// Required-items templates for each room type.
// Each item has a `category` used to group products visually on the presentation page.

import { PRODUCT_CATEGORIES, type ProductCategory } from "@/lib/productCategories";

export type ItemTemplate = { label: string; category: string };
export { PRODUCT_CATEGORIES } from "@/lib/productCategories";

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
  "Accent Mirrors",
  "Accessories",
  "Appliances",
  "Cabinetry & Hardware",
  "Countertops",
  "Doors Base & Case",
  "Flooring",
  "Furniture",
  "Hardware",
  "Lighting",
  "Other",
  "Paint",
  "Plumbing",
  "Tile & Stone",
  "Wall Coverings",
] as const;
export type ItemCategory = (typeof ALL_CATEGORIES)[number];

type ProductCategoryShape = {
  category?: ProductCategory | string | null;
  subcategory?: string | null;
  name?: string | null;
  product_url?: string | null;
};

// Map a loose template/material category to the strict product-catalog enum.
export function toProductCategory(c: string | null | undefined): ProductCategory {
  if (!c) return "Decor";
  if ((PRODUCT_CATEGORIES as readonly string[]).includes(c)) return c as ProductCategory;
  const map: Record<string, ProductCategory> = {
    "Tile & Stone": "Tile",
    Countertop: "Countertops",
    Countertops: "Countertops",
    "Cabinetry & Hardware": "Hardware",
    Cabinetry: "Hardware",
    "Doors Base & Case": "Hardware",
    "Accent Mirrors": "Decor",
    "Wall Coverings": "Decor",
    Accessories: "Decor",
    Other: "Decor",
    Sconce: "Lighting",
    Pendant: "Lighting",
  };
  return map[c] ?? "Decor";
}

export function productDisplayCategory(product: ProductCategoryShape): ItemCategory {
  if (product.category === "Tile") return "Tile & Stone";
  if (product.category === "Countertops") return "Countertops";
  if (product.category && (ALL_CATEGORIES as readonly string[]).includes(product.category)) {
    return product.category as ItemCategory;
  }

  const inferred = inferMaterialCategory(
    `${product.name ?? ""} ${product.subcategory ?? ""}`,
    product.product_url,
  );
  if (product.category === "Decor" && inferred === "Other") return "Accessories";
  return inferred;
}

export function productMatchesItemCategory(product: ProductCategoryShape, category: ItemCategory): boolean {
  if (category === "Tile & Stone") return product.category === "Tile";
  if (category === "Countertops") return product.category === "Countertops";

  const strictCategory = toProductCategory(category);
  if (product.category !== strictCategory) return false;

  if (strictCategory === "Decor" || strictCategory === "Hardware") {
    return productDisplayCategory(product) === category;
  }

  return true;
}

export function sampleAppliesToCategory(category: ItemCategory | string | null | undefined) {
  return category === "Tile & Stone" || category === "Flooring";
}

function normalizeCategoryText(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function inferMaterialCategory(label: string | null | undefined, productUrl?: string | null): ItemCategory {
  const text = normalizeCategoryText(`${label ?? ""} ${productUrl ?? ""}`);

  if (/\b(sink|sinks|basin|lavatory|undermount sink|farmhouse sink|tub|tubs|bathtub|freestanding tub|soaking tub)\b/.test(text)) {
    return "Plumbing";
  }

  if (
    /\b(appliance|appliances|range|rangetop|cooktop|oven|double oven|wall oven|microwave|speed oven|refrigerator|fridge|freezer|dishwasher|washer|dryer|coffee maker|coffee machine|espresso|ice maker|wine cooler|beverage center|stove hood|range hood|hood insert|vent hood|ventilation|miele|subzero|sub zero|wolf|thermador|monogram|cafe appliances|kitchenaid|fisher paykel|bosch|ajmadison)\b/.test(text)
  ) {
    return "Appliances";
  }

  if (/\b(wallpaper|wall paper|wallcovering|wall covering|grasscloth|grass cloth)\b/.test(text)) {
    return "Wall Coverings";
  }

  if (
    /\b(robe hook|coat hook|towel hook|hook|hooks|toilet paper holder|paper holder|tp holder|hand towel holder|towel ring|towel bar)\b/.test(text)
  ) {
    return "Hardware";
  }

  if (/\b(door|doors|baseboard|base board|casing|case moulding|case molding|trim|moulding|molding|door stop|door hardware|hinge|hinges)\b/.test(text)) {
    return "Doors Base & Case";
  }

  if (/\b(mirror|mirrors|medicine cabinet)\b/.test(text)) {
    return "Accent Mirrors";
  }

  if (
    /\b(cabinet|cabinetry|hardware|knob|knobs|pull|pulls|latch|latches|appliance pull|cabinet finish|cabinet color|cabinet paint)\b/.test(text)
  ) {
    return "Cabinetry & Hardware";
  }

  if (/\b(faucet|shower|toilet|plumbing|pot filler|drain|valve|trim kit|hand shower)\b/.test(text)) {
    return "Plumbing";
  }

  if (/\b(countertop|countertops|counter top|counter tops|slab|marble|quartz|quartzite|granite|soapstone|stone counter)\b/.test(text)) {
    return "Countertops";
  }

  if (/\b(tile|zellige|backsplash|mosaic|stone tile|floor tile|wall tile)\b/.test(text)) {
    return "Tile & Stone";
  }

  if (/\b(pendant|sconce|lamp|light|lighting|chandelier|lantern|flush mount|semi flush)\b/.test(text)) {
    return "Lighting";
  }

  if (/\b(paint|limewash|lime wash|wall paint|ceiling paint|trim paint|cabinet paint|stain)\b/.test(text)) {
    return "Paint";
  }

  if (/\b(floor|flooring|wood floor|carpet|rug)\b/.test(text)) {
    return "Flooring";
  }

  if (/\b(chair|table|sofa|sectional|ottoman|stool|bench|bed|nightstand|dresser|desk|console|sideboard|cabinet)\b/.test(text)) {
    return "Furniture";
  }

  if (/\b(towel hook|toilet paper holder|robe hook|basket|art|decor|accessory|accessories)\b/.test(text)) {
    return "Accessories";
  }

  return "Other";
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
  { label: "Flooring", category: "Flooring" },
  { label: "Paint", category: "Paint" },
];

const BEDROOM_OFFICE: ItemTemplate[] = [
  { label: "Lighting", category: "Lighting" },
  { label: "Sconce", category: "Lighting" },
  { label: "Flooring", category: "Flooring" },
  { label: "Paint", category: "Paint" },
];

const LIVING_ROOM: ItemTemplate[] = [
  { label: "Lighting", category: "Lighting" },
  { label: "Tile", category: "Tile & Stone" },
  { label: "Flooring", category: "Flooring" },
  { label: "Paint", category: "Paint" },
];

const DINING_ROOM: ItemTemplate[] = [
  { label: "Lighting", category: "Lighting" },
  { label: "Flooring", category: "Flooring" },
  { label: "Paint", category: "Paint" },
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
  { label: "Flooring", category: "Flooring" },
  { label: "Paint", category: "Paint" },
  { label: "Towel Hook", category: "Hardware" },
  { label: "Toilet Paper Holder", category: "Hardware" },
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
