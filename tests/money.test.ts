import { describe, expect, it } from "vitest";
import { clientPriceFromMarkup, procurementTotals } from "@/lib/money";

describe("clientPriceFromMarkup", () => {
  it("calculates client price from retail price", () => {
    expect(
      clientPriceFromMarkup({
        retailPrice: "$100.00",
        ourPrice: "$70.00",
        markupPercent: "20",
        markupBasis: "retail_price",
      }),
    ).toBe(120);
  });

  it("calculates client price from our price", () => {
    expect(
      clientPriceFromMarkup({
        retailPrice: "$100.00",
        ourPrice: "$70.00",
        markupPercent: 35,
        markupBasis: "our_price",
      }),
    ).toBe(94.5);
  });

  it("rounds calculated prices to cents", () => {
    expect(
      clientPriceFromMarkup({
        retailPrice: "",
        ourPrice: "$19.99",
        markupPercent: "17.5",
        markupBasis: "our_price",
      }),
    ).toBe(23.49);
  });

  it("does not calculate until both the selected base and markup exist", () => {
    expect(
      clientPriceFromMarkup({
        retailPrice: "$100",
        ourPrice: null,
        markupPercent: "",
        markupBasis: "retail_price",
      }),
    ).toBeNull();
    expect(
      clientPriceFromMarkup({
        retailPrice: "$100",
        ourPrice: "",
        markupPercent: "20",
        markupBasis: "our_price",
      }),
    ).toBeNull();
  });
});

describe("procurement totals from the Spec Book", () => {
  const item = (
    price: string | null,
    quantity: number | null,
    extra: Record<string, unknown> = {},
  ) => ({
    material: { quantity, quantity_unit: "count", ...extra },
    room_product: {
      product: { name: "Lamp", category: "Lighting", price, unit_cost: "$60", shipping: "$5" },
    },
  });

  it("uses the saved client price and changes when the Spec Book price changes", () => {
    expect(procurementTotals([item("$100", 2)]).subtotal).toBe(200);
    expect(procurementTotals([item("$125", 2)]).subtotal).toBe(250);
  });

  it("uses the Spec Book order quantity including waste", () => {
    const totals = procurementTotals([item("$100", 10, { waste_percent: 10 })]);
    expect(totals.subtotal).toBe(1100);
    expect(totals.cost).toBe(660);
  });

  it("does not treat an unknown price or quantity as zero", () => {
    expect(procurementTotals([item(null, 2)]).subtotal).toBeNaN();
    expect(procurementTotals([item("$100", null, { quantity_tbd: true })]).total).toBeNaN();
    expect(procurementTotals([item("$0", 2)]).subtotal).toBe(0);
    expect(procurementTotals([{ material: { quantity: 1 }, room_product: { product: null } }]).subtotal).toBeNaN();
  });

  it("does not report profit as though a missing cost were free", () => {
    const selection = item("$100", 2);
    selection.room_product.product.unit_cost = null as unknown as string;
    const totals = procurementTotals([selection]);
    expect(totals.subtotal).toBe(200);
    expect(totals.cost).toBeNaN();
    expect(totals.profit).toBeNaN();
    expect(totals.missingCosts).toBe(1);
  });

  it("does not multiply square-foot pricing by a box count", () => {
    const tile = item("$8", 5, { quantity_unit: "box", category: "Tile & Stone" });
    tile.room_product.product = {
      ...tile.room_product.product,
      name: "Tile",
      price_unit: "sq_ft",
    } as typeof tile.room_product.product;
    const totals = procurementTotals([tile]);
    expect(totals.subtotal).toBeNaN();
    expect(totals.incompatibleUnits).toBe(1);
  });

  it("uses the design decision price and verified purchase quantity", () => {
    const totals = procurementTotals([
      item("$100", 2, {
        design_accuracy_fact: {
          price: 75,
          priceUnit: "each",
          purchaseUnit: "each",
          purchaseQuantity: 3,
          purchaseReady: true,
        },
      }),
    ]);
    expect(totals.subtotal).toBe(225);
  });

  it("adds known amounts in Procurement while TBD quantities and prices contribute zero", () => {
    const totals = procurementTotals([
      item("$100", 2),
      item("$80", null, { quantity_tbd: true }),
      item(null, 3),
    ], 10, { unknownAsZero: true });
    expect(totals.subtotal).toBe(200);
    expect(totals.cost).toBe(300);
    expect(totals.shipping).toBe(25);
    expect(totals.tax).toBe(20);
    expect(totals.total).toBe(245);
    expect(totals.unknownQuantities).toBe(1);
    expect(totals.missingPrices).toBe(1);
  });

  it("counts a missing cost and mismatched units as zero without changing saved values", () => {
    const known = item("$100", 2);
    known.room_product.product.unit_cost = null as unknown as string;
    const tile = item("$8", 5, { quantity_unit: "box", category: "Tile & Stone" });
    tile.room_product.product = { ...tile.room_product.product, name: "Tile", price_unit: "sq_ft" } as typeof tile.room_product.product;
    const original = structuredClone([known, tile]);
    const totals = procurementTotals([known, tile], 0, { unknownAsZero: true });
    expect(totals.subtotal).toBe(200);
    expect(totals.cost).toBe(0);
    expect(totals.profit).toBe(200);
    expect(totals.missingCosts).toBe(1);
    expect(totals.incompatibleUnits).toBe(1);
    expect([known, tile]).toEqual(original);
  });
});
