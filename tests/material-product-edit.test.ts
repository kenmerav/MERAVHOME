import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  responses: [] as any[],
  writes: [] as any[],
  create: vi.fn(),
  update: vi.fn(),
  roomProducts: vi.fn(),
  addRoom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const query: any = {
        select: () => query,
        eq: () => query,
        is: () => query,
        update: (patch: any) => {
          state.writes.push({ table, patch });
          return query;
        },
        single: async () => state.responses.shift(),
        maybeSingle: async () => state.responses.shift(),
      };
      return query;
    },
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    createProduct: state.create,
    updateProduct: state.update,
    listRoomProducts: state.roomProducts,
    addRoomProduct: state.addRoom,
  },
}));
import { saveMaterialProductDetails } from "@/lib/materialProductEdit";
import { productPricingPatch, type ProductPricingDraft } from "@/lib/productPricingEdit";

const material = {
  id: "material",
  project_id: "project",
  room_id: "bath",
  product_id: null,
  item_label: "Sink",
  category: "Plumbing",
  product_url: null,
  color: "White",
  image_url: "https://storage.test/my-photo.png",
};
const values: ProductPricingDraft = {
  price: "250",
  retail_price: "",
  unit_cost: "",
  markup_percent: "",
  markup_basis: "retail_price",
  shipping: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  state.responses = [];
  state.writes = [];
  state.create.mockResolvedValue({ id: "new-product" });
  state.update.mockResolvedValue({ id: "saved-product" });
  state.roomProducts.mockResolvedValue([]);
  state.addRoom.mockResolvedValue({ id: "room-product" });
});

describe("Product details from Materials and Procurement", () => {
  it("allows direct pricing on an item without a catalog product or URL", async () => {
    state.responses = [
      { data: material, error: null },
      { data: { product_id: "new-product" }, error: null },
    ];
    expect(await saveMaterialProductDetails("material", productPricingPatch(values))).toBe(
      "new-product",
    );
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sink",
        category: "Plumbing",
        price: "$250.00",
        product_url: null,
        image_url: material.image_url,
        finish: "White",
      }),
    );
    expect(state.writes).toEqual([
      { table: "material_items", patch: { product_id: "new-product" } },
    ]);
    expect(state.addRoom).toHaveBeenCalledWith({
      room_id: "bath",
      product_id: "new-product",
      is_key_selection: false,
    });
  });
  it("reads the latest product link and updates only the requested fields", async () => {
    state.responses = [{ data: { ...material, product_id: "current-product" }, error: null }];
    state.roomProducts.mockResolvedValue([{ product_id: "current-product" }]);
    await saveMaterialProductDetails("material", { dimensions: '32" x 19"', vendor: "Kohler" });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.update).toHaveBeenCalledWith("current-product", {
      dimensions: '32" x 19"',
      vendor: "Kohler",
    });
    expect(state.writes).toEqual([]);
    expect(state.addRoom).not.toHaveBeenCalled();
  });
  it("preserves a concurrent material link instead of overwriting it", async () => {
    state.responses = [
      { data: material, error: null },
      { data: null, error: null },
      { data: { product_id: "other-users-product" }, error: null },
    ];
    state.roomProducts.mockResolvedValue([{ product_id: "other-users-product" }]);
    expect(await saveMaterialProductDetails("material", { price: "$250.00" })).toBe(
      "other-users-product",
    );
    expect(state.update).toHaveBeenCalledWith("other-users-product", { price: "$250.00" });
  });
  it("reports an unsuccessful product write", async () => {
    state.responses = [{ data: { ...material, product_id: "current-product" }, error: null }];
    state.update.mockResolvedValue(null);
    await expect(saveMaterialProductDetails("material", { price: "$250.00" })).rejects.toThrow(
      "Could not save",
    );
  });
});

describe("Manual price and markup", () => {
  it("only saves the pricing fields the user changed", () => {
    expect(productPricingPatch({ ...values, shipping: "10" }, values)).toEqual({
      shipping: "$10.00",
    });
    expect(productPricingPatch({ ...values, price: "275" }, values)).toEqual({ price: "$275.00" });
    expect(productPricingPatch(values, values)).toEqual({});
  });
  it("supports direct price, zero, and clearing a price", () => {
    expect(productPricingPatch(values).price).toBe("$250.00");
    expect(productPricingPatch({ ...values, price: "0" }).price).toBe("$0.00");
    expect(productPricingPatch({ ...values, price: "" }).price).toBeNull();
  });
  it("calculates from the selected markup basis when a markup is supplied", () => {
    expect(
      productPricingPatch({ ...values, retail_price: "$1,000", markup_percent: "20" }).price,
    ).toBe("$1200.00");
    expect(
      productPricingPatch({
        ...values,
        unit_cost: "150",
        markup_basis: "our_price",
        markup_percent: "20",
      }).price,
    ).toBe("$180.00");
    expect(
      productPricingPatch({
        ...values,
        unit_cost: "150",
        markup_basis: "our_price",
        markup_percent: "0",
      }).price,
    ).toBe("$150.00");
  });
  it("rejects invalid amounts and markup without its base", () => {
    expect(() => productPricingPatch({ ...values, price: "abc" })).toThrow();
    expect(() => productPricingPatch({ ...values, price: "-5" })).toThrow();
    expect(() => productPricingPatch({ ...values, markup_percent: "20" })).toThrow();
  });
});
