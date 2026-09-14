import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifiedProductPrices, type VerifiedCartPricing } from "@/lib/procurementPricing";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  writes: [] as any[],
  failProduct: false,
  conflict: false,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async () => ({ data: [{ run_id: "run" }], error: null }),
    from: (table: string) => {
      let patch: any;
      const filters: Array<[string, any]> = [];
      const result = (single = false) => {
        const rows = state.tables[table].filter((row) =>
          filters.every(([key, value]) => row[key] === value),
        );
        if (patch && table === "products" && state.failProduct)
          return { data: null, error: new Error("Write failed") };
        if (patch && table === "products" && state.conflict) return { data: null, error: null };
        if (patch) {
          state.writes.push({ table, patch: structuredClone(patch) });
          rows.forEach((row) => Object.assign(row, structuredClone(patch)));
        }
        return { data: structuredClone(single ? (rows[0] ?? null) : rows), error: null };
      };
      const query: any = {
        select: () => query,
        update: (value: any) => {
          patch = value;
          return query;
        },
        eq: (key: string, value: any) => {
          filters.push([key, value]);
          return query;
        },
        is: (key: string, value: any) => {
          filters.push([key, value]);
          return query;
        },
        order: () => query,
        single: async () => result(true),
        maybeSingle: async () => result(true),
        then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
      };
      return query;
    },
  },
}));
import { updateAuthorizedProcurementItem } from "@/lib/procurementRuns.server";

const productUrl = "https://www.retailer.example/product";
const item: any = {
  id: "item",
  run_id: "run",
  product_id: "product",
  spec_book_item_id: "material",
  status: "prepared",
  product_name: "Cabinet knob",
  product_url: productUrl,
  sku: "KNOB-BLACK",
  requested_quantity: 2,
  requested_options: { quantity_unit: "pieces", procurement_method: "online_cart" },
  observed_options: {},
  expected_price: 20,
  observed_price: null,
};
const pricing: VerifiedCartPricing = {
  cart_verified: true,
  currency: "USD",
  retail_unit_price: 25,
  retail_price_unit: "pieces",
  retail_price_url: productUrl,
  cart_unit_price: 18,
  cart_price_unit: "pieces",
  cart_quantity: 2,
  cart_url: "https://www.retailer.example/cart",
  evidence:
    "Retail $25 each. Verified cart shows 2 exact knobs, net line subtotal $36 before tax/shipping.",
};
const update = (extra: any = {}) =>
  updateAuthorizedProcurementItem({
    runAuthorization: "a".repeat(43),
    runItemId: "item",
    status: "added",
    verifiedPricing: pricing,
    ...extra,
  });
beforeEach(() => {
  state.tables = {
    procurement_runs: [
      {
        id: "run",
        created_by: "ken",
        project_id: "project",
        status: "prepared",
        project: { id: "project", name: "Fixture" },
      },
    ],
    procurement_run_items: [structuredClone(item)],
    user_profiles: [{ id: "ken", email: "ken@meravinteriors.com", is_active: true }],
    material_items: [{ id: "material", project_id: "project", product_id: "product" }],
    products: [
      {
        id: "product",
        price: "$20.00",
        unit_cost: "$15.00",
        sku: item.sku,
        product_url: productUrl,
        shipping: "$5.00",
      },
    ],
  };
  state.writes = [];
  state.failProduct = false;
  state.conflict = false;
});

describe("verified cart pricing", () => {
  it.each(["katie@meravinteriors.com", "brynn@meravinteriors.com", "client@example.com"])(
    "rejects an existing run token owned by %s",
    async (email) => {
      state.tables.user_profiles[0].email = email;
      await expect(update()).rejects.toThrow("Ken only");
      expect(state.writes).toHaveLength(0);
    },
  );
  it("rejects a run owned by inactive Ken", async () => {
    state.tables.user_profiles[0].is_active = false;
    await expect(update()).rejects.toThrow("Ken only");
    expect(state.writes).toHaveLength(0);
  });
  it("saves retail for the client and discounted cart unit cost for Studio, after Added", async () => {
    const result = await update();
    expect(state.tables.products[0]).toMatchObject({
      price: "$25",
      unit_cost: "$18",
      shipping: "$5.00",
    });
    expect(state.writes[0]).toMatchObject({
      table: "procurement_run_items",
      patch: { status: "added" },
    });
    expect(state.writes[1]).toMatchObject({
      table: "products",
      patch: { price: "$25", unit_cost: "$18" },
    });
    expect(result.observed_options.cart_pricing).toMatchObject({
      state: "synced",
      previous_retail: "$20.00",
      previous_cost: "$15.00",
    });
    expect(result.requested_quantity).toBe(2);
    expect(result.observed_price).toBe(18);
  });
  it("keeps verified per-item shipping separate from both unit prices", async () => {
    await update({ observedShipping: 7 });
    expect(state.tables.products[0]).toMatchObject({
      price: "$25",
      unit_cost: "$18",
      shipping: "7.00",
    });
  });
  it("keeps Added and records a review warning if product-price saving fails", async () => {
    state.failProduct = true;
    const result = await update();
    expect(result.status).toBe("added");
    expect(result.observed_options.cart_pricing.state).toBe("needs_review");
    expect(state.tables.products[0].price).toBe("$20.00");
    expect(state.tables.procurement_run_items[0].status).toBe("added");
  });
  it("supports price-only retries without reopening or duplicating the cart item", async () => {
    state.failProduct = true;
    await update();
    state.failProduct = false;
    await update();
    await update();
    expect(state.writes.filter((write) => write.table === "products")).toHaveLength(1);
    expect(state.tables.procurement_run_items[0].status).toBe("added");
  });
  it("does not replace prices when evidence is missing or status is not Added", async () => {
    await update({
      verifiedPricing: undefined,
      observedPrice: 11,
      observedOptions: { cart_pricing: { state: "synced" } },
    });
    expect(state.tables.products[0].price).toBe("$20.00");
    expect(state.tables.procurement_run_items[0].observed_options.cart_pricing.state).toBe(
      "needs_review",
    );
    state.tables.procurement_run_items[0].status = "prepared";
    await expect(update({ status: "option_mismatch" })).rejects.toThrow("Only a verified Added");
  });
  it("cannot update a product outside the authorized run", async () => {
    await expect(update({ runItemId: "another-item" })).rejects.toThrow("does not belong");
    expect(state.writes).toHaveLength(0);
  });
  it.each(["material", "identity", "concurrent edit"])(
    "keeps prices for review after a changed %s",
    async (change) => {
      if (change === "material") state.tables.material_items[0].product_id = "different-product";
      if (change === "identity") state.tables.products[0].sku = "different-sku";
      if (change === "concurrent edit") state.conflict = true;
      const result = await update();
      expect(result.status).toBe("added");
      expect(result.observed_options.cart_pricing.state).toBe("needs_review");
      expect(state.tables.products[0].unit_cost).toBe("$15.00");
    },
  );
  it("converts box cost to square-foot cost without using the whole line total", () => {
    const area = {
      ...item,
      requested_quantity: 25,
      requested_options: {
        quantity_unit: "square_feet",
        carton_coverage_sq_ft: 10,
        waste_percentage: 10,
      },
    };
    const converted = verifiedProductPrices(area, {
      ...pricing,
      retail_unit_price: 5,
      retail_price_unit: "square_feet",
      cart_unit_price: 40,
      cart_price_unit: "boxes",
      cart_quantity: 3,
    });
    expect(converted).toMatchObject({ retail: 5, cost: 4, unit: "square_feet" });
  });
  it.each([
    { cart_quantity: 99 },
    { cart_price_unit: "boxes" },
    { cart_unit_price: -1 },
    { currency: "CAD" },
    { cart_url: "https://unrelated.example/cart" },
    { cart_verified: false },
  ])("rejects unverifiable pricing input: %j", (change) => {
    expect(() => verifiedProductPrices(item, { ...pricing, ...change } as any)).toThrow();
  });
});
