import { describe, expect, it } from "vitest";
import { productPricingPatch, type ProductPricingDraft } from "@/lib/productPricingEdit";
import { formatPriceWithUnit, productPriceUnit, inferProductPriceUnit, materialPriceUnit } from "@/lib/productPriceUnit";
import { withSavedMaterialProduct } from "@/lib/materialPricingCache";
import type { MaterialItem, Product } from "@/lib/db";

function blank(): ProductPricingDraft {
  return { price: "", retail_price: "", unit_cost: "", shipping: "", markup_percent: "",
    markup_basis: "retail_price", price_unit: "" };
}

describe("Materials price save and price basis", () => {
  it.each(["Kitchen sink faucet", "Ceiling light", "Bathroom mirror", "Cabinet knob", "Dishwasher", "Sofa", "Pilates reformer", "Rug", "Roman clay", "Interior Doors", "Filing Cabinet", "Thornton Chaise", "Bedding", "lumbar pillow"])("sets the obvious item price basis for %s", name => {
    expect(inferProductPriceUnit({ name, price: "$25", category: "Flooring" })).toBe("unit");
  });
  it("defaults ordinary tile and flooring to square feet and respects explicit sheet or box prices", () => {
    expect(materialPriceUnit({ item_label: "Floor tile", category: "Tile & Stone", product: { price: "$7.99" } })).toBe("sq_ft");
    expect(materialPriceUnit({ item_label: "Weight/Dumbbell Wall Backsplash", category: "Tile & Stone", product: { name: "Unlabeled Item", price: "$4.89" } })).toBe("sq_ft");
    expect(inferProductPriceUnit({ name: "Light grey porcelain floor tile", price: "$4.89" })).toBe("sq_ft");
    expect(inferProductPriceUnit({ name: "Engineered hardwood flooring", price: "$90 / box" })).toBe("unit");
    expect(inferProductPriceUnit({ name: "Marble mosaic", price: "$18.74 / sheet (1.19 sq ft)" })).toBe("unit");
    expect(inferProductPriceUnit({ name: "Marble mosaic", price: "$15.75 / sq. ft." })).toBe("sq_ft");
  });
  it("preserves saved choices, keeps unusual products unresolved, and never treats coverage as a price unit", () => {
    expect(inferProductPriceUnit({ name: "Floor tile", price_unit: "unit" })).toBe("unit");
    expect(inferProductPriceUnit({ name: "Marble mosaic", price: "$18.74", category: "Tile" })).toBeNull();
    expect(inferProductPriceUnit({ name: "Countertop slab", price: "$100", category: "Countertops" })).toBeNull();
    expect(inferProductPriceUnit({ name: "Flooring", price: "$8 / linear foot" })).toBeNull();
    expect(inferProductPriceUnit({ name: "Custom item covers 20 sq ft", price: "$100" })).toBeNull();
  });
  it("does not infer a scraper's raw box price as a square-foot rate from the product category", () => {
    expect(inferProductPriceUnit({ name: "Floor tile", price: "$148.16", category: "Tile" }, { allowAreaDefault: false })).toBeNull();
    expect(inferProductPriceUnit({ name: "Floor tile", price: "$8.50 / sq ft", category: "Tile" }, { allowAreaDefault: false })).toBe("sq_ft");
  });
  it("saves an automatically chosen unit without changing an existing amount", () => {
    const initial = { ...blank(), price: "$269.40" };
    expect(productPricingPatch({ ...initial, price_unit: materialPriceUnit({ item_label: "Faucet" }) || "" }, initial))
      .toEqual({ price_unit: "unit" });
  });
  it("copies a newly entered retail price into the blank display price", () => {
    const initial = blank();
    expect(productPricingPatch({ ...initial, retail_price: "7.99", price_unit: "sq_ft" }, initial))
      .toEqual({ retail_price: "$7.99", price: "$7.99", price_unit: "sq_ft" });
  });
  it("does not replace an existing manually set display price", () => {
    const initial = { ...blank(), price: "$100", retail_price: "$120" };
    expect(productPricingPatch({ ...initial, retail_price: "130" }, initial)).not.toHaveProperty("price");
  });
  it("does not undo an intentional clear", () => {
    const initial = { ...blank(), price: "$100", retail_price: "$120" };
    expect(productPricingPatch({ ...initial, price: "" }, initial).price).toBeNull();
    const costOnly = { ...blank(), price: "$80", unit_cost: "$80" };
    expect(productPricingPatch({ ...costOnly, price: "" }, costOnly).price).toBeNull();
  });
  it("publishes the single cost entered in Materials to the Spec Book", () => {
    const initial = blank();
    expect(productPricingPatch({ ...initial, unit_cost: "940.80", price_unit: "unit" }, initial))
      .toEqual({ unit_cost: "$940.80", price: "$940.80", price_unit: "unit" });
  });
  it("uses retail when both prices are supplied and preserves a manual display price", () => {
    expect(productPricingPatch({ ...blank(), retail_price: "120", unit_cost: "80" }, blank()).price)
      .toBe("$120.00");
    const initial = { ...blank(), price: "$100", unit_cost: "$80" };
    expect(productPricingPatch({ ...initial, unit_cost: "90" }, initial)).not.toHaveProperty("price");
  });
  it("can fill an existing blank display price when its single price basis is chosen", () => {
    const initial = { ...blank(), unit_cost: "$80" };
    expect(productPricingPatch({ ...initial, price_unit: "unit" }, initial))
      .toEqual({ price: "$80.00", price_unit: "unit" });
  });
  it("does not treat shipping as the product price", () => {
    expect(productPricingPatch({ ...blank(), shipping: "10" }, blank()))
      .toEqual({ shipping: "$10.00" });
  });
  it("preserves explicitly configured markup", () => {
    expect(productPricingPatch({ ...blank(), unit_cost: "80", markup_basis: "our_price", markup_percent: "25" }).price)
      .toBe("$100.00");
  });
  it("changes only the price basis when the amount has not changed", () => {
    const initial: ProductPricingDraft = { ...blank(), price: "$7.99", price_unit: "unit" };
    expect(productPricingPatch({ ...initial, price_unit: "sq_ft" }, initial)).toEqual({ price_unit: "sq_ft" });
  });
  it("changes a rug from square foot to item without converting or replacing its price", () => {
    const initial: ProductPricingDraft = { ...blank(), price: "$169", retail_price: "$169", price_unit: "sq_ft" };
    expect(productPricingPatch({ ...initial, price_unit: "unit" }, initial)).toEqual({ price_unit: "unit" });
  });
  it("keeps legacy callers from clearing a separately saved basis", () => {
    const initial = blank();
    delete initial.price_unit;
    expect(productPricingPatch({ ...initial, price: "25" }, initial)).not.toHaveProperty("price_unit");
  });
  it("formats known denominators and does not guess for legacy records", () => {
    expect(formatPriceWithUnit("$7.99", "sq_ft")).toBe("$7.99 / sq ft");
    expect(formatPriceWithUnit("$199.00", "unit")).toBe("$199.00 / unit");
    expect(productPriceUnit(undefined)).toBeNull();
    expect(formatPriceWithUnit("$18.74", undefined)).toContain("price basis not set");
  });
  it("keeps zero prices distinct from missing prices", () => {
    expect(productPricingPatch({ ...blank(), retail_price: "0" }, blank()).price).toBe("$0.00");
    expect(productPricingPatch({ ...blank(), unit_cost: "0" }, blank()).price).toBe("$0.00");
    expect(formatPriceWithUnit("$0.00", "unit")).toBe("$0.00 / unit");
    expect(formatPriceWithUnit("", "unit")).toBeNull();
  });
  it("refreshes related rows only after a confirmed product save without changing quantities", () => {
    const rows = [
      { id: "a", product_id: "p", quantity: 50, quantity_unit: "square_feet" },
      { id: "b", product_id: "p", quantity: 20, quantity_unit: "square_feet" },
      { id: "c", product_id: "q", quantity: 1 },
    ] as MaterialItem[];
    const product = { id: "p", price: "$7.99", price_unit: "sq_ft" } as Product;
    const updated = withSavedMaterialProduct(rows, "a", product)!;
    expect(updated[0].product).toBe(product);
    expect(updated[1].product).toBe(product);
    expect(updated[0].quantity).toBe(50);
    expect(updated[1].quantity).toBe(20);
    expect(updated[2]).toBe(rows[2]);
  });
});
