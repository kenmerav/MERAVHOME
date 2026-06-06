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

export const SUBCATEGORIES: Record<ProductCategory, string[]> = {
  Lighting: ["Pendants", "Sconces", "Recessed Lighting", "Chandeliers", "Flush Mount", "Lamps"],
  Plumbing: ["Faucets", "Pot Fillers", "Shower Systems", "Tubs", "Sinks", "Toilets"],
  Hardware: ["Pulls", "Knobs", "Hinges", "Latches"],
  Appliances: ["Refrigerators", "Ranges", "Dishwashers", "Hoods", "Microwaves", "Ovens"],
  Flooring: ["Wood", "Stone", "Tile", "Carpet"],
  Tile: ["Wall", "Floor", "Backsplash", "Shower"],
  Countertops: ["Slab", "Quartzite", "Marble", "Quartz", "Granite", "Soapstone"],
  Paint: ["Wall", "Trim", "Ceiling", "Cabinet"],
  Furniture: ["Seating", "Tables", "Storage", "Beds"],
  Decor: ["Art", "Textiles", "Accessories", "Mirrors"],
};
