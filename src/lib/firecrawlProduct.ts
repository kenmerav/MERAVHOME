import { inferVendorFromUrl } from "@/lib/vendorInference";
import {
  firstProductPrice,
  productPriceFromPage,
  selectedSkuPriceFromHtml,
} from "@/lib/productPricing";

export const FIRECRAWL_PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Product or material name" },
    vendor: { type: "string", description: "Brand or manufacturer" },
    sku: { type: "string", description: "SKU, model number, or product code" },
    color: {
      type: "string",
      description: "Selected color, selected swatch, or colorway for this exact product URL",
    },
    selected_color: {
      type: "string",
      description: "Selected color option when the page shows one",
    },
    finish: {
      type: "string",
      description:
        "Selected surface finish or treatment (for example polished, matte, brushed brass). Keep separate from color.",
    },
    selected_finish: { type: "string", description: "Exact selected finish option" },
    selected_variant: {
      type: "string",
      description: "Selected variant or option when the page shows one",
    },
    dimensions: {
      type: "string",
      description:
        "Full product dimensions for the exact selected size, including units and width, depth, height, length or diameter as published. Exclude packaging and shipping dimensions.",
    },
    price: {
      type: "string",
      description:
        "Exact customer-visible price for the selected product variant. If no exact selected variant price is visible, use the product price range.",
    },
    current_price: { type: "string" },
    sale_price: { type: "string" },
    regular_price: { type: "string" },
    list_price: { type: "string" },
    price_per_item: { type: "string" },
    image_url: {
      type: "string",
      description: "Absolute URL of the primary product image",
    },
  },
};

export const FIRECRAWL_PRODUCT_PROMPT =
  "Extract product details from this page, including finish, color, and dimensions whenever published. Read specifications, product details, dimensions, and selected options, not just the title and price. Keep surface finish/treatment separate from color/colorway. Capture the exact selected color, finish, and size for this URL; never pick an arbitrary option from a list of variants. Include all published product measurements with labels and units, excluding packaging/shipping dimensions. Do not infer measurements from an image or substitute another size. Capture the exact customer-visible price for that selected variant. If no exact variant price is visible, capture the product price range. Leave unavailable or ambiguous specifications empty; do not invent a color, finish, dimension, or price.";

export type NormalizedFirecrawlProduct = {
  name: string;
  vendor: string;
  sku: string;
  color: string;
  finish: string;
  dimensions: string;
  price: string;
  image_url: string;
};

export function firstString(...values: unknown[]) {
  return (
    values
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim() ?? ""
  );
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function missingProductSpecifications(value: {
  finish?: unknown;
  color?: unknown;
  dimensions?: unknown;
}) {
  return (["finish", "color", "dimensions"] as const).filter((field) => !firstString(value[field]));
}

export function normalizeFirecrawlProduct(
  value: unknown,
  sourceUrl: string,
): NormalizedFirecrawlProduct {
  const data = record(value);
  const extracted = record(data.json ?? data.extract);
  const metadata = record(data.metadata);
  const pagePrice = productPriceFromPage(
    typeof data.markdown === "string" ? data.markdown : undefined,
    typeof data.html === "string" ? data.html : undefined,
    sourceUrl,
  );

  return {
    name: firstString(extracted.name, metadata.title, metadata.ogTitle),
    vendor: firstString(
      inferVendorFromUrl(sourceUrl),
      extracted.vendor,
      metadata.ogSiteName,
      metadata["og:site_name"],
    ),
    sku: firstString(extracted.sku, extracted.model, extracted.model_number),
    color: firstString(extracted.selected_color, extracted.color, extracted.colorway),
    finish: firstString(extracted.selected_finish, extracted.finish, extracted.material_finish),
    dimensions: firstString(extracted.dimensions, extracted.dimension, extracted.size),
    price: firstProductPrice(
      selectedSkuPriceFromHtml(typeof data.html === "string" ? data.html : "", sourceUrl),
      extracted.current_price,
      extracted.sale_price,
      extracted.price,
      extracted.regular_price,
      extracted.list_price,
      extracted.price_per_item,
      pagePrice,
    ),
    image_url: firstString(
      extracted.image_url,
      extracted.image,
      metadata.ogImage,
      metadata["og:image"],
    ),
  };
}

export function firecrawlSourceUrl(value: unknown) {
  const item = record(value);
  const metadata = record(item.metadata);
  return firstString(metadata.sourceURL, metadata.url, item.url);
}

export function firecrawlItemError(value: unknown) {
  const item = record(value);
  const metadata = record(item.metadata);
  return firstString(item.error, metadata.error);
}
