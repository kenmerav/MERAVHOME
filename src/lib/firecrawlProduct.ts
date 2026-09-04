import { inferVendorFromUrl } from "@/lib/vendorInference";

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
    finish: { type: "string", description: "Finish, color, or material variant" },
    selected_variant: {
      type: "string",
      description: "Selected variant or option when the page shows one",
    },
    dimensions: {
      type: "string",
      description: "Product dimensions or size, exactly as shown on the page",
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
  "Extract product details from this page. If the URL or page has a selected color, selected swatch, finish, or variant already chosen, capture that exact selected value. Capture the exact customer-visible price for that selected variant. If no exact variant price is visible, capture the product price range. Do not invent a color or price.";

export type NormalizedFirecrawlProduct = {
  name: string;
  vendor: string;
  sku: string;
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

function firstPrice(...values: unknown[]) {
  for (const value of values) {
    const text =
      typeof value === "number"
        ? value.toString()
        : typeof value === "string"
          ? value.replace(/\s+/g, " ").trim()
          : "";
    if (!text || /^(null|undefined|n\/a)$/i.test(text)) continue;

    const match = text.match(
      /\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?(?:\s*(?:-|–|to)\s*\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?)?|\$?\s*\d+(?:\.\d{2})?/,
    );
    if (!match) continue;

    const cleaned = match[0].replace(/\s+/g, "").replace(/–|to/i, "-");
    if (!/\d/.test(cleaned)) continue;
    return cleaned.startsWith("$") ? cleaned : `$${cleaned}`;
  }
  return "";
}

function priceFromPageText(markdown?: string, html?: string) {
  const htmlText = html ?? "";
  const markdownText = markdown ?? "";
  const automationPrice = htmlText.match(/data-automation=["']price["'][^>]*>\s*([^<]+)/i);
  const labeledPrice = `${markdownText}\n${htmlText}`.match(
    /(?:your total|current price|sale price|regular price|price)\s*:?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?(?:\s*(?:-|–|to)\s*\$?\s*\d[\d,]*(?:\.\d{2})?)?)/i,
  );
  const standaloneMarkdownPrice = markdownText.match(
    /(?:^|\n)\s*(?:[-*]\s*)?(\$\s*\d[\d,]*(?:\.\d{2})?(?:\s*(?:-|–|to)\s*\$?\s*\d[\d,]*(?:\.\d{2})?)?)\s*(?:\n|$)/,
  );
  return firstPrice(automationPrice?.[1], labeledPrice?.[1], standaloneMarkdownPrice?.[1]);
}

export function normalizeFirecrawlProduct(
  value: unknown,
  sourceUrl: string,
): NormalizedFirecrawlProduct {
  const data = record(value);
  const extracted = record(data.json ?? data.extract);
  const metadata = record(data.metadata);
  const pagePrice = priceFromPageText(
    typeof data.markdown === "string" ? data.markdown : undefined,
    typeof data.html === "string" ? data.html : undefined,
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
    finish: firstString(
      extracted.finish,
      extracted.color,
      extracted.selected_color,
      extracted.selected_variant,
      extracted.variant,
    ),
    dimensions: firstString(extracted.dimensions, extracted.dimension, extracted.size),
    price: firstPrice(
      extracted.price,
      extracted.current_price,
      extracted.sale_price,
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
