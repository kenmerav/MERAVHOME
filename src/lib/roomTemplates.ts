// Required-items templates for each room type.
// Each item has a `category` used to group products visually on the presentation page.

import { PRODUCT_CATEGORIES, type ProductCategory } from "@/lib/productCategories";
import { isCountertopMaterial } from "@/lib/countertopPricing";

export type ItemTemplate = { label: string; category: string };
export { PRODUCT_CATEGORIES } from "@/lib/productCategories";

export const PRESET_ROOMS = [
  "Kitchen",
  "Primary Bedroom",
  "Bedroom 1",
  "Bedroom 2",
  "Primary Bathroom",
  "Powder Bathroom",
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
  "Cabinetry",
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

export function normalizeItemCategory(value: string | null | undefined): ItemCategory | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^Cabinetry\s*&\s*Hardware$/i.test(trimmed)) return "Cabinetry";
  if (/^Doors,\s*Base,\s*Case$/i.test(trimmed)) return "Doors Base & Case";
  if (/^Tile\s*(?:\+|&|and)\s*Stone$/i.test(trimmed)) return "Tile & Stone";
  const canonical = ALL_CATEGORIES.find(category => category.toLowerCase() === trimmed.toLowerCase());
  if (canonical) return canonical;
  return null;
}

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
  const normalized = normalizeItemCategory(c) ?? c;
  if ((PRODUCT_CATEGORIES as readonly string[]).includes(normalized)) return normalized as ProductCategory;
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
  return map[normalized] ?? "Decor";
}

export function productDisplayCategory(product: ProductCategoryShape): ItemCategory {
  if (product.category === "Tile") return "Tile & Stone";
  if (product.category === "Countertops") return "Countertops";
  if (product.category === "Hardware") {
    const nameCategory = inferMaterialCategory(product.name, product.product_url);
    if (nameCategory !== "Other" && nameCategory !== "Hardware") return nameCategory;
    // A stale cabinet subtype must not pull named bathroom accessories into
    // Cabinetry. Generic model numbers can still use their saved subtype.
    if (nameCategory === "Hardware" && /\b(?:hooks?|towel|paper holder|shower door)\b/i.test(
      normalizeCategoryText(`${product.name ?? ""} ${product.product_url ?? ""}`),
    )) return "Hardware";
    const subtype = normalizeItemCategory(product.subcategory);
    if (subtype === "Doors Base & Case" || ["Base & Case", "Door Hardware", "Door Hinges"].includes(product.subcategory ?? "")) {
      return "Doors Base & Case";
    }
    if (subtype === "Cabinetry" || /^(?:Cabinet(?: Pulls| Knobs| Hinges| Latches)|Appliance Pulls)$/i.test(product.subcategory ?? "")) {
      return "Cabinetry";
    }
  }
  const normalizedCategory = normalizeItemCategory(product.category);
  if (normalizedCategory) return normalizedCategory;

  const inferred = inferMaterialCategory(
    `${product.name ?? ""} ${product.subcategory ?? ""}`,
    product.product_url,
  );
  if (product.category === "Decor" && inferred === "Other") return product.subcategory === "Other" ? "Other" : "Accessories";
  return inferred;
}

export function selectionItemCategory(
  category: string | null | undefined,
  label: string | null | undefined,
  productUrl?: string | null,
  product?: ProductCategoryShape | null,
): ItemCategory {
  const explicit = normalizeItemCategory(category);
  const inferred = inferMaterialCategory(`${label ?? ""} ${product?.name ?? ""}`, productUrl || product?.product_url);
  // Older board/catalog entries called all purchased hardware "Hardware".
  if (explicit === "Hardware" && inferred === "Cabinetry") return "Cabinetry";
  if (explicit) return explicit;
  return product ? productDisplayCategory(product) : inferred;
}

export function productMatchesItemCategory(
  product: ProductCategoryShape,
  category: ItemCategory,
): boolean {
  return productDisplayCategory(product) === category;
}

export function productMatchesMaterialSelection(product: ProductCategoryShape, item: {
  category?: string | null; item_label?: string | null; product_url?: string | null; product?: ProductCategoryShape | null;
}) {
  const category = normalizeItemCategory(item.category) ?? inferMaterialCategory(item.item_label, item.product_url);
  if (productMatchesItemCategory(product, category)) return true;
  if (category !== "Cabinetry") return false;
  const label = normalizeCategoryText(item.item_label ?? "");
  if (/\b(?:knobs?|pulls?|handles?|hinges?|latch(?:es)?|slides?|hardware)\b/.test(label)) return false;
  const finish = /\b(?:cabinet|cabinetry) (?:finish|color|paint)\b/.test(label) || item.product?.category === "Paint";
  return finish && productDisplayCategory(product) === "Paint";
}

export function sampleAppliesToCategory(category: ItemCategory | string | null | undefined) {
  return (
    category === "Tile & Stone" ||
    category === "Countertops" ||
    category === "Hardware" ||
    category === "Plumbing" ||
    category === "Flooring"
  );
}

function normalizeCategoryText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferMaterialCategory(
  label: string | null | undefined,
  productUrl?: string | null,
): ItemCategory {
  const text = normalizeCategoryText(`${label ?? ""} ${productUrl ?? ""}`);

  if (
    /\b(wallpaper|wall paper|wallcovering|wall covering|wall coverings|grasscloth|grass cloth)\b/.test(
      text,
    )
  ) {
    return "Wall Coverings";
  }

  if (/\b(mirror|mirrors|medicine cabinet)\b/.test(text)) {
    return "Accent Mirrors";
  }

  if (isCountertopMaterial({ item_label: label, product_url: productUrl })) return "Countertops";

  // Fixture names can include a material ("Tile-In Shower Drain"), and light
  // placements can mention plumbing ("over sink light"). Keep their type.
  if (/\b(faucets?|drains?|valves?|bathtubs?|tub filler|pot filler)\b/.test(text)) return "Plumbing";
  if (/\b(sconces?|pendants?|chandeliers?|ceiling fan|sink light|window light)\b/.test(text)) return "Lighting";

  if (
    /\b(tile|tiles|zellige|backsplash|mosaic|stone tile|floor tile|wall tile|shower wall)\b/.test(
      text,
    )
  ) {
    return "Tile & Stone";
  }

  if (
    /\b(?:cabinetry|cabinet) (?:finish|finishes|color|paint)\b/.test(text)
  ) {
    return "Cabinetry";
  }

  if (/\bshower door\b/.test(text) && /\b(handles?|pulls?|hinges?|knobs?)\b/.test(text)) {
    return "Hardware";
  }

  if (/\b(cabinets?|cabinetry|cupboards?|drawers?|appliance)\b/.test(text) &&
    /\b(knobs?|pulls?|handles?|hinges?|latch(?:es)?|catches?|slides?|hardware)\b/.test(text)) {
    return "Cabinetry";
  }

  if (/\b(doors?|passage|privacy|dummy|deadbolt|handleset|lockset)\b/.test(text) &&
    /\b(knobs?|pulls?|handles?|hinges?|latch(?:es)?|locks?|levers?|hardware|deadbolt|handleset|lockset)\b/.test(text)) {
    return "Doors Base & Case";
  }

  if (
    /\b(robe hook|coat hook|towel hook|hook|hooks|toilet paper holder|paper holder|tp holder|hand towel holder|towel holder|towel ring|towel bar)\b/.test(
      text,
    )
  ) {
    return "Hardware";
  }

  if (
    /\b(sink|sinks|basin|lavatory|undermount sink|farmhouse sink|shower system|shower drain|tub|tubs|bathtub|freestanding tub|soaking tub|faucet|faucets|tub filler|pot filler|shower|toilet|plumbing|drain|valve|trim kit|hand shower)\b/.test(
      text,
    )
  ) {
    return "Plumbing";
  }

  if (/\b(paint|limewash|lime wash|wall finish|ceiling finish|stain|roman clay)\b/.test(text)) {
    return "Paint";
  }

  if (
    /\b(?:ceiling fan|sconces?|pendants?|lamps?|lighting|chandelier|lantern|flush mount|semi flush)\b|\blights?\b(?! (?:blue|green|pink|gray|grey|brown|beige|taupe|cream|red|yellow|orange|purple)\b)/.test(
      text,
    )
  ) {
    return "Lighting";
  }

  if (
    /\b(appliance|appliances|range|rangetop|cooktop|oven|double oven|wall oven|microwave|speed oven|refrigerator|fridge|freezer|dishwasher|washer|dryer|coffee maker|coffee machine|espresso|ice maker|wine cooler|beverage center|stove hood|range hood|hood insert|vent hood|ventilation|miele|subzero|sub zero|wolf|thermador|monogram|cafe appliances|kitchenaid|fisher paykel|bosch|ajmadison)\b/.test(
      text,
    )
  ) {
    return "Appliances";
  }

  if (
    /\b(door|doors|baseboard|base board|casing|case moulding|case molding|trim|moulding|molding|door stop|door hardware|hinge|hinges)\b/.test(
      text,
    )
  ) {
    return "Doors Base & Case";
  }

  if (
    /\b(countertop|countertops|counter top|counter tops|slab|marble|quartz|quartzite|granite|soapstone|stone counter)\b/.test(
      text,
    )
  ) {
    return "Countertops";
  }

  if (/\b(floor|flooring|wood floor|carpet|rug)\b/.test(text)) {
    return "Flooring";
  }

  if (/\b(cabinet|cabinetry|knobs?|pulls?|latch(?:es)?)\b/.test(text)) {
    return "Cabinetry";
  }

  if (/\bhardware\b/.test(text)) return "Hardware";

  if (
    /\b(chair|table|sofa|sectional|ottoman|stool|bench|bed|nightstand|dresser|desk|console|sideboard|cabinet)\b/.test(
      text,
    )
  ) {
    return "Furniture";
  }

  if (
    /\b(towel hook|toilet paper holder|robe hook|basket|art|decor|accessory|accessories)\b/.test(
      text,
    )
  ) {
    return "Accessories";
  }

  return "Other";
}

const KITCHEN: ItemTemplate[] = [
  { label: "Lighting", category: "Lighting" },
  { label: "Faucet", category: "Plumbing" },
  { label: "Pot Filler", category: "Plumbing" },
  { label: "Sink", category: "Plumbing" },
  { label: "Tile", category: "Tile & Stone" },
  { label: "Countertop", category: "Countertops" },
  { label: "Cabinet Finish", category: "Cabinetry" },
  { label: "Cabinet Hardware", category: "Cabinetry" },
  { label: "Flooring", category: "Flooring" },
  { label: "Paint", category: "Paint" },
];

const BEDROOM_OFFICE: ItemTemplate[] = [
  { label: "Lighting", category: "Lighting" },
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
  { label: "Toilet", category: "Plumbing" },
  { label: "Shower System", category: "Plumbing" },
  { label: "Shower Drain", category: "Plumbing" },
  { label: "Lighting", category: "Lighting" },
  { label: "Accent Mirrors", category: "Accessories" },
  { label: "Cabinetry Finish", category: "Cabinetry" },
  { label: "Cabinet Hardware", category: "Cabinetry" },
  { label: "Flooring", category: "Flooring" },
  { label: "Paint", category: "Paint" },
  { label: "Towel Hook", category: "Hardware" },
  { label: "Toilet Paper Holder", category: "Hardware" },
];

const POWDER_BATHROOM: ItemTemplate[] = BATHROOM.filter(
  (item) => !["Shower Tile", "Shower System", "Shower Drain"].includes(item.label),
);

export function templateForRoomName(name: string, showerShown = false): ItemTemplate[] {
  const n = name.trim().toLowerCase();
  if (n === "kitchen") return KITCHEN;
  if (n === "living room") return LIVING_ROOM;
  if (n === "dining room") return DINING_ROOM;
  if (n === "office") return BEDROOM_OFFICE;
  if (n.includes("powder") && !showerShown) return POWDER_BATHROOM;
  if (n.includes("bathroom") || n.includes("bath") || n.includes("powder")) return BATHROOM;
  if (n.includes("bedroom")) return BEDROOM_OFFICE;
  return []; // "Other" / custom rooms start empty
}
