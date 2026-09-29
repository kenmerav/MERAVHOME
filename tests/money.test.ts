import { describe, expect, it } from "vitest";
import { clientPriceFromMarkup } from "@/lib/money";

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
