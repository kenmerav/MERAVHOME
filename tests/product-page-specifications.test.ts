import { expect, it } from "vitest";
import {
  productPageSpecifications,
  publishedProductDimensions,
} from "@/lib/productPageSpecifications";
import { normalizeFirecrawlProduct } from "@/lib/firecrawlProduct";
import { productColorFinish } from "@/lib/productDetails";

const script = (data: unknown, type = "application/ld+json") =>
  `<script type="${type}">${JSON.stringify(data)}</script>`;
const url = "https://shop.example.com/products/mirror";
const shopify = {
  title: "Wall Mirror",
  vendor: "Mirror Maker",
  options: ["Finish", "Size"],
  dimensions: "24 x 36 in",
  variants: [
    { id: 101, sku: "M-BR-24", options: ["Brushed Brass", "24 x 36 in"] },
    { id: 102, sku: "M-BK-30", options: ["Matte Black", "30 x 40 in"] },
  ],
};

it("fills product specifications from JSON-LD even when the extraction misses them", () => {
  const rawHtml = script({
    "@type": "Product",
    name: "Mirror",
    sku: "M-24",
    brand: { name: "Mirror Maker" },
    color: "Bronze",
    width: { value: 24, unitCode: "INH" },
    height: { value: 36, unitText: "in" },
  });
  expect(normalizeFirecrawlProduct({ rawHtml, json: { finish: "Satin" } }, url)).toMatchObject({
    manufacturer: "Mirror Maker",
    color: "Bronze",
    finish: "Satin",
    dimensions: "Width: 24 in × Height: 36 in",
    sku: "M-24",
  });
});
it("reads the exact Shopify variant and keeps its size instead of the parent's default size", () => {
  const data = productPageSpecifications(script(shopify, "application/json"), `${url}?variant=102`);
  expect(data).toMatchObject({
    finish: "Matte Black",
    dimensions: "30 x 40 in",
    selected_size: "30 x 40 in",
    manufacturer: "Mirror Maker",
    sku: "M-BK-30",
  });
  expect(data.size_options).toEqual(["24 x 36 in", "30 x 40 in"]);
  expect(
    productPageSpecifications(script(shopify, "application/json"), `${url}?sku=M-BR-24`).finish,
  ).toBe("Brushed Brass");
});
it("does not pick a default variant, and rejects a variant ID missing from the product", () => {
  const data = productPageSpecifications(script(shopify, "application/json"), url);
  expect(data.finish).toBe("");
  expect(data.dimensions).toBe("");
  const invalid = normalizeFirecrawlProduct(
    {
      rawHtml: script(shopify, "application/json"),
      json: { color: "Brass", dimensions: "24 x 36 in", selected_size: "24 x 36 in" },
    },
    `${url}?variant=999`,
  );
  expect(invalid.finish).toBe("");
  expect(invalid.color).toBe("");
  expect(invalid.dimensions).toBe("");
});
it("fills a finish shared by every size without selecting an unknown size", () => {
  const product = {
    ...shopify,
    variants: shopify.variants.map((v) => ({ ...v, options: ["Matte Black", v.options[1]] })),
  };
  expect(productPageSpecifications(script(product, "application/json"), url)).toMatchObject({
    finish: "Matte Black",
    selected_size: "",
    dimensions: "",
  });
});

it("does not use family measurements when variants publish different dimensions without a size selector", () => {
  const product = {
    "@type": "ProductGroup",
    width: "24 in",
    hasVariant: [
      { sku: "A", width: "24 in" },
      { sku: "B", width: "30 in" },
    ],
  };
  expect(productPageSpecifications(script(product), url).dimensions).toBe("");
  expect(productPageSpecifications(script(product), `${url}?sku=B`).dimensions).toBe(
    "Width: 30 in",
  );
});
it("uses only the primary product and ignores recommendation objects", () => {
  const rawHtml = script({
    "@graph": [
      { "@type": "Product", url, color: "Bronze", width: "24 in" },
      { "@type": "Product", url: "https://shop.example.com/other", color: "Red", width: "99 in" },
    ],
  });
  expect(productPageSpecifications(rawHtml, url)).toMatchObject({
    color: "Bronze",
    dimensions: "Width: 24 in",
  });
});
it("reads published product measurements from markdown and HTML tables without using shipping or mounting sizes", () => {
  expect(
    publishedProductDimensions(
      "| Overall width | 24 in |\n| Overall height | 36 in |\n| Mounting centers | 4 in |\n## Related Products\nWidth: 99 in",
      "",
    ),
  ).toBe("Overall width: 24 in; Overall height: 36 in");
  expect(
    publishedProductDimensions(
      "",
      "<table><tr><td>Product dimensions</td><td>24 in W × 36 in H</td></tr><tr><td>Shipping dimensions</td><td>30 x 42 in</td></tr></table>",
    ),
  ).toBe("Product dimensions: 24 in W × 36 in H");
});
it("keeps unresolved multi-size measurements blank even when a generic specification table contains a size", () => {
  expect(
    normalizeFirecrawlProduct(
      {
        markdown: "Overall dimensions: 30 x 40 in",
        json: { size_options: ["24 x 36 in", "30 x 40 in"] },
      },
      url,
    ).dimensions,
  ).toBe("");
});
it("keeps color and surface finish together in a Room Design card", () => {
  expect(productColorFinish({ color: "White", finish: "Matte" })).toBe("White / Matte");
  expect(productColorFinish({ color: "Brass", finish: "Brushed Brass" })).toBe("Brushed Brass");
  expect(productColorFinish({ color: "Bronze and black", finish: "Satin" })).toBe(
    "Bronze and black / Satin",
  );
  expect(
    productColorFinish({ finish: "Matte Black", color_options: ["Brushed Brass", "Matte Black"] }),
  ).toBe("Matte Black");
});

it("imports Flash Bars' published size, Glossy finish and eight colors without choosing the Ivory hero image", () => {
  const colors = [
    "Blush",
    "Cobalt",
    "Cool Grey",
    "Graphite",
    "Ivory",
    "Lead",
    "Light Blue",
    "White",
  ];
  const controls =
    colors
      .map(
        (color) =>
          `<span data-parent-id="pa_color" data-text="${color}" aria-label="${color}"><img src="https://cdn.example.com/${color.replaceAll(" ", "-")}.jpg"></span>`,
      )
      .join("") +
    '<span data-parent-id="pa_size" data-text="5 x 10 Scored"></span><span data-parent-id="pa_finishes" data-text="Glossy"></span>';
  const product = normalizeFirecrawlProduct(
    { rawHtml: controls, json: { name: "Flash Bars", vendor: "Arizona Tile", color: "Ivory" } },
    "https://www.arizonatile.com/products/tile/porcelain-and-ceramic/flash-bars",
  );
  expect(product.color_options).toEqual(colors);
  expect(product).toMatchObject({
    dimensions: "5 x 10 Scored",
    selected_size: "5 x 10 Scored",
    finish: "Glossy",
    color: "",
    manufacturer: "Arizona Tile",
  });
  expect(product.color_option_images.Cobalt).toBe("https://cdn.example.com/Cobalt.jpg");
  expect(productColorFinish(product)).toBe("");
});
