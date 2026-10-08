import { describe, expect, it } from "vitest";
import {
  exactProductPrice,
  firstProductPrice,
  productPriceFromPage,
} from "../src/lib/productPricing";
import { normalizeFirecrawlProduct } from "../src/lib/firecrawlProduct";

describe("retailer price extraction", () => {
  it.each([1250, "1250.00", "$1,250.00", "$1250.00", "$7.99 / sq ft", "7.99 per square foot"])(
    "reads the full amount from %s",
    (value) => {
      expect(firstProductPrice(value)).toBe(String(value).includes("7.99") ? "$7.99" : "$1,250.00");
    },
  );
  it.each(["24 x 36", "Save $100", "4 payments of $99", "Call for price", "null", 0, -10])(
    "rejects non-prices %s",
    (value) => {
      expect(firstProductPrice(value)).toBe("");
    },
  );
  it("preserves ranges but excludes them from exact pricing", () => {
    expect(firstProductPrice("$149–$249")).toBe("$149.00–$249.00");
    expect(exactProductPrice("$149–$249")).toBe("");
  });
  it("uses current or sale pricing before generic regular pricing", () => {
    expect(
      normalizeFirecrawlProduct(
        { json: { price: "$635", sale_price: "$508" } },
        "https://example.com/light",
      ).price,
    ).toBe("$508.00");
    expect(productPriceFromPage("Regular price $635\nSale price $508")).toBe("$508.00");
  });
  it("reads the selected West Elm SKU before generic extraction", () => {
    const html =
      '<script>{"4255574":{"id":"4255574","price":{"sellingPrice":1250,"regularPrice":1500}}}</script>';
    expect(
      normalizeFirecrawlProduct(
        { html, json: { price: "$99" } },
        "https://www.westelm.com/products/cactus/?sku=4255574",
      ).price,
    ).toBe("$1,250.00");
  });
  it("does not borrow another SKU's price when the selected SKU has no price", () => {
    const html =
      '<script>{"4255574":{"id":"4255574","title":"Selected cactus"},"4255575":{"id":"4255575","price":{"sellingPrice":99}}}</script>';
    expect(
      normalizeFirecrawlProduct({ html }, "https://www.westelm.com/products/cactus/?sku=4255574")
        .price,
    ).toBe("");
  });
  it("reads product offers without pulling recommended-product prices", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      offers: { "@type": "Offer", price: "1675", priceCurrency: "USD" },
      related: { "@type": "Product", offers: { "@type": "Offer", price: "8" } },
    })}</script>`;
    expect(normalizeFirecrawlProduct({ html }, "https://example.com/vanity").price).toBe(
      "$1,675.00",
    );
  });
  it("selects the URL-matched offer instead of another size", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      offers: [
        {
          "@type": "Offer",
          sku: "small",
          url: "https://example.com/mirror?variant=100",
          price: 169.95,
        },
        {
          "@type": "Offer",
          sku: "large",
          url: "https://example.com/mirror?variant=200",
          price: 389,
        },
      ],
    })}</script>`;
    expect(productPriceFromPage("", html, "https://example.com/mirror?variant=200")).toBe(
      "$389.00",
    );
    expect(productPriceFromPage("", html, "https://example.com/mirror?variant=300")).toBe("");
  });
  it("reads price-specific metadata in either attribute order", () => {
    expect(
      productPriceFromPage("", '<meta content="214.99" property="product:price:amount">'),
    ).toBe("$214.99");
  });
  it("reads a formatted standalone price and price specifications", () => {
    expect(productPriceFromPage("**$37.99**")).toBe("$37.99");
    expect(productPriceFromPage("$4.89 / sq ft")).toBe("$4.89");
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": ["Product"],
      offers: { "@type": "Offer", priceSpecification: { price: "456", priceCurrency: "USD" } },
    })}</script>`;
    expect(productPriceFromPage("", html)).toBe("$456.00");
  });
  it("does not confuse financing, shipping, or recommendations with product pricing", () => {
    expect(
      productPriceFromPage(
        "Free shipping on orders over $50\n4 payments of $25\nRecommended item $99",
      ),
    ).toBe("");
  });
});
