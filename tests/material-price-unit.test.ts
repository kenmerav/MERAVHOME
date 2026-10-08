import { describe, expect, it } from "vitest";
import { productPricingPatch, type ProductPricingDraft } from "@/lib/productPricingEdit";
import { formatPriceWithUnit, productPriceUnit } from "@/lib/productPriceUnit";
import { withSavedMaterialProduct } from "@/lib/materialPricingCache";
import type { MaterialItem, Product } from "@/lib/db";

function blank(): ProductPricingDraft {
  return { price: "", retail_price: "", unit_cost: "", shipping: "", markup_percent: "",
    markup_basis: "retail_price", price_unit: "" };
}

describe("Materials price save and price basis", () => {
  it("copies a newly entered retail price into the blank display price", () => {
    const initial = blank();
    expect(productPricingPatch({ ...initial, retail_price: "7.99", price_unit: "sq_ft" }, initial))
      .toEqual({ retail_price: "$7.99", price: "$7.99", price_unit: "sq_ft" });
  });
  it("does not replace an existing manually set display price", () => {
    const initial = { ...blank(), price: "$100", retail_price: "$120" };
    expect(productPricingPatch({ ...initial, retail_price: "130" }, initial)).not.toHaveProperty("price");
  });
  it("does not undo an intentional clear or expose internal cost", () => {
    const initial = { ...blank(), price: "$100", retail_price: "$120" };
    expect(productPricingPatch({ ...initial, price: "" }, initial).price).toBeNull();
    expect(productPricingPatch({ ...blank(), unit_cost: "80" }, blank())).not.toHaveProperty("price");
  });
  it("preserves explicitly configured markup", () => {
    expect(productPricingPatch({ ...blank(), unit_cost: "80", markup_basis: "our_price", markup_percent: "25" }).price)
      .toBe("$100.00");
  });
  it("changes only the price basis when the amount has not changed", () => {
    const initial: ProductPricingDraft = { ...blank(), price: "$7.99", price_unit: "unit" };
    expect(productPricingPatch({ ...initial, price_unit: "sq_ft" }, initial)).toEqual({ price_unit: "sq_ft" });
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
