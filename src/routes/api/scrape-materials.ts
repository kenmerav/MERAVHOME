import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toProductCategory } from "@/lib/roomTemplates";
import { normalizeMoneyInput } from "@/lib/money";
import { cleanUuid } from "@/lib/ids";
import { inferVendorFromUrl } from "@/lib/vendorInference";
import { resolveCartonCoverage } from "@/lib/cartonCoverage";

const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_BATCH_API = "https://api.firecrawl.dev/v2/batch/scrape";
const MAX_SCRAPE_ROWS_PER_BATCH = 12;
const SCRAPE_TIMEOUT_MS = 40000;
const DIRECT_PRODUCT_TIMEOUT_MS = 8000;
const FIRECRAWL_MAX_AGE_MS = 10 * 60 * 1000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function firstString(...vals: unknown[]) {
  return vals.find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim() ?? "";
}

function hasValue(value: unknown) {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const number =
      typeof value === "number"
        ? value
        : Number(
            String(value ?? "")
              .replace(/,/g, "")
              .trim(),
          );
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function isScrapeableUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function canonicalScrapeUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value.trim());
    url.hash = "";
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (/^(utm_|fbclid$|gclid$|dclid$|msclkid$|epik$|cm_|pr_|mc_|ref$|source$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    });
    url.hostname = url.hostname.toLowerCase();
    const productMatch = url.pathname.match(/\/products\/([^/]+)/i);
    if (productMatch) url.pathname = `/products/${productMatch[1]}`;
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim();
  }
}

function firstPrice(...vals: unknown[]) {
  for (const val of vals) {
    const text =
      typeof val === "number"
        ? val.toString()
        : typeof val === "string"
          ? val.replace(/\s+/g, " ").trim()
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

function formatPriceNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(number) || number < 0) return "";
  return `$${number.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function structuredPriceFromHtml(html?: string) {
  if (!html) return "";

  const metaPatterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:product:price:amount|og:price:amount|price)["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:product:price:amount|og:price:amount|price)["'][^>]*>/i,
  ];
  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    const price = firstPrice(match?.[1]);
    if (price) return price;
  }

  const jsonLdScripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const candidates: Array<{ low: number; high: number }> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const type = Array.isArray(record["@type"])
      ? record["@type"].join(" ")
      : String(record["@type"] ?? "");
    if (/Offer/i.test(type)) {
      const low = Number(record.lowPrice ?? record.price);
      const high = Number(record.highPrice ?? record.price);
      if (Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= 0) {
        candidates.push({ low, high });
      }
    }
    Object.values(record).forEach(visit);
  };
  for (const match of jsonLdScripts) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      // Some sites emit malformed JSON-LD; visible-price parsing remains available below.
    }
  }
  if (!candidates.length) return "";
  const low = Math.min(...candidates.map((candidate) => candidate.low));
  const high = Math.max(...candidates.map((candidate) => candidate.high));
  const lowPrice = formatPriceNumber(low);
  const highPrice = formatPriceNumber(high);
  return low === high ? lowPrice : `${lowPrice}-${highPrice}`;
}

function selectedSkuPriceFromHtml(html: string, sourceUrl: string) {
  let selectedSku = "";
  try {
    selectedSku = new URL(sourceUrl).searchParams.get("sku")?.trim() ?? "";
  } catch {
    return "";
  }
  if (!selectedSku || !/^\d{4,20}$/.test(selectedSku)) return "";

  const escapedSku = selectedSku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const skuObject = new RegExp(`"${escapedSku}"\\s*:\\s*\\{\\s*"id"\\s*:\\s*"${escapedSku}"`).exec(
    html,
  );
  if (!skuObject) return "";
  const selectedProductData = html.slice(skuObject.index, skuObject.index + 12000);
  const priceBlock = selectedProductData.match(/"price"\s*:\s*\{([^}]{0,1200})\}/i)?.[1] ?? "";
  const priceField = (field: string) => {
    const match = new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i").exec(priceBlock);
    return match ? Number(match[1]) : Number.NaN;
  };
  const sellingPrice = priceField("sellingPrice");
  const regularPrice = priceField("regularPrice");
  const retailPrice = priceField("retailPrice");
  const currentPrice = [sellingPrice, regularPrice, retailPrice].find(
    (price) => Number.isFinite(price) && price >= 0,
  );
  return currentPrice == null ? "" : formatPriceNumber(currentPrice);
}

function priceFromPageText(
  markdown: string | undefined,
  html: string | undefined,
  sourceUrl: string,
) {
  const htmlText = html ?? "";
  const markdownText = markdown ?? "";

  const automationPrice = htmlText.match(/data-automation=["']price["'][^>]*>\s*([^<]+)/i);
  const labeledPrice = `${markdownText}\n${htmlText}`.match(
    /(?:your total|current price|sale price|regular price|price)\s*:?\s*(\$?\s*\d[\d,]*(?:\.\d{2})?(?:\s*(?:-|–|to)\s*\$?\s*\d[\d,]*(?:\.\d{2})?)?)/i,
  );
  const standaloneMarkdownPrice = markdownText.match(
    /(?:^|\n)\s*(?:[-*]\s*)?(\$\s*\d[\d,]*(?:\.\d{2})?(?:\s*(?:-|–|to)\s*\$?\s*\d[\d,]*(?:\.\d{2})?)?)\s*(?:\n|$)/,
  );

  return firstPrice(
    selectedSkuPriceFromHtml(htmlText, sourceUrl),
    structuredPriceFromHtml(htmlText),
    automationPrice?.[1],
    labeledPrice?.[1],
    standaloneMarkdownPrice?.[1],
  );
}

function compactPayload<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === "string") return value.trim().length > 0;
      return true;
    }),
  ) as Partial<T>;
}

function fillBlankProductFields(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
) {
  const patch: Record<string, unknown> = {};
  Object.entries(incoming).forEach(([key, value]) => {
    if (!hasValue(value)) return;
    if (hasValue(existing?.[key])) return;
    patch[key] = value;
  });
  return patch;
}

type Scraped = {
  name?: string;
  vendor?: string;
  image_url?: string;
  color?: string;
  finish?: string;
  sku?: string;
  dimensions?: string;
  price?: string;
  unit_cost?: string;
  shipping?: string;
  carton_coverage_sq_ft?: number;
  carton_coverage_source_url?: string;
  carton_coverage_source_text?: string;
  carton_coverage_confidence?: "exact" | "review" | "missing";
  error?: string;
};

type ShopifyVariant = {
  id?: string | number;
  title?: string;
  price?: number;
  compare_at_price?: number | null;
  available?: boolean;
  sku?: string;
  options?: string[];
};

type ShopifyProduct = {
  title?: string;
  vendor?: string;
  featured_image?: string;
  images?: string[];
  variants?: ShopifyVariant[];
};

type FirecrawlPage = {
  json?: Record<string, unknown>;
  extract?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  markdown?: string;
  html?: string;
  url?: string;
};

type FirecrawlEnvelope = Record<string, unknown> & {
  data?: unknown;
  status?: unknown;
  completed?: unknown;
  total?: unknown;
  next?: unknown;
  id?: unknown;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function shopifyProductJsonUrl(value: string) {
  try {
    const url = new URL(value);
    const productMatch = url.pathname.match(/\/products\/([^/]+)/i);
    if (!productMatch) return null;
    url.pathname = `/products/${productMatch[1]}.js`;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function shopifyPrice(variants: ShopifyVariant[], selectedVariantId: string | null) {
  const selected = selectedVariantId
    ? variants.find((variant) => String(variant.id) === selectedVariantId)
    : null;
  const purchasable = variants.filter(
    (variant) =>
      variant.available !== false &&
      !/sample|swatch/i.test(firstString(variant.title, variant.options?.join(" "))),
  );
  const eligible = selected ? [selected] : purchasable.length ? purchasable : variants;
  const prices = eligible
    .map((variant) => variant.price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price))
    .map((price) => price / 100);
  if (!prices.length) return "";
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high
    ? formatPriceNumber(low)
    : `${formatPriceNumber(low)}-${formatPriceNumber(high)}`;
}

async function scrapeShopifyProduct(url: string): Promise<Scraped | null> {
  const productJsonUrl = shopifyProductJsonUrl(url);
  if (!productJsonUrl) return null;
  const originalUrl = new URL(url);
  const selectedVariantId = originalUrl.searchParams.get("variant");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIRECT_PRODUCT_TIMEOUT_MS);
  try {
    const response = await fetch(productJsonUrl, {
      headers: { Accept: "application/json", "User-Agent": "MERAVHOME Studio product scraper" },
      signal: controller.signal,
    });
    if (!response.ok || !/json|javascript/i.test(response.headers.get("content-type") ?? "")) {
      return null;
    }
    const product = (await response.json()) as ShopifyProduct;
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const selected = selectedVariantId
      ? variants.find((variant) => String(variant.id) === selectedVariantId)
      : null;
    const representative =
      selected ??
      variants.find(
        (variant) =>
          variant.available !== false &&
          !/sample|swatch/i.test(firstString(variant.title, variant.options?.join(" "))),
      ) ??
      variants[0];
    const image = firstString(
      product.featured_image,
      Array.isArray(product.images) ? product.images[0] : "",
    );
    return {
      name: firstString(product.title),
      vendor: firstString(inferVendorFromUrl(url), product.vendor),
      sku: firstString(representative?.sku),
      finish: firstString(representative?.title === "Default Title" ? "" : representative?.title),
      price: shopifyPrice(variants, selectedVariantId),
      image_url: image.startsWith("//") ? `https:${image}` : image,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function scrapeEmbeddedSkuProduct(url: string): Promise<Scraped | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  const supportedHost = /(^|\.)(rejuvenation|potterybarn|westelm|williams-sonoma)\.com$/i.test(
    parsedUrl.hostname,
  );
  const selectedSku = parsedUrl.searchParams.get("sku")?.trim() ?? "";
  if (!supportedHost || !/^\d{4,20}$/.test(selectedSku)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIRECT_PRODUCT_TIMEOUT_MS);
  try {
    const response = await fetch(parsedUrl, {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const html = await response.text();
    const price = selectedSkuPriceFromHtml(html, url);
    if (!price) return null;
    return { price, sku: selectedSku, vendor: inferVendorFromUrl(url) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function scrapeDirectProduct(url: string) {
  const shopifyProduct = await scrapeShopifyProduct(url);
  if (shopifyProduct?.price) return shopifyProduct;
  return mergeScraped(await scrapeEmbeddedSkuProduct(url), shopifyProduct);
}

function mergeScraped(primary: Scraped | null | undefined, fallback: Scraped | null | undefined) {
  return compactPayload({
    name: firstString(primary?.name, fallback?.name),
    vendor: firstString(primary?.vendor, fallback?.vendor),
    image_url: firstString(primary?.image_url, fallback?.image_url),
    color: firstString(primary?.color, fallback?.color),
    finish: firstString(primary?.finish, fallback?.finish),
    sku: firstString(primary?.sku, fallback?.sku),
    dimensions: firstString(primary?.dimensions, fallback?.dimensions),
    price: firstString(primary?.price, fallback?.price),
    unit_cost: firstString(primary?.unit_cost, fallback?.unit_cost),
    shipping: firstString(primary?.shipping, fallback?.shipping),
    carton_coverage_sq_ft:
      firstPositiveNumber(primary?.carton_coverage_sq_ft, fallback?.carton_coverage_sq_ft) ??
      undefined,
    carton_coverage_source_url: firstString(
      primary?.carton_coverage_source_url,
      fallback?.carton_coverage_source_url,
    ),
    carton_coverage_source_text: firstString(
      primary?.carton_coverage_source_text,
      fallback?.carton_coverage_source_text,
    ),
    carton_coverage_confidence:
      primary?.carton_coverage_confidence ?? fallback?.carton_coverage_confidence,
    error: firstString(primary?.error, fallback?.error),
  }) as Scraped;
}

function batchEnvelope(value: unknown): FirecrawlEnvelope {
  const body = asRecord(value);
  return body.data && !Array.isArray(body.data) && typeof body.data === "object"
    ? asRecord(body.data)
    : body;
}

async function fetchBatchResult(batchId: string, fcKey: string) {
  let nextUrl = `${FIRECRAWL_BATCH_API}/${encodeURIComponent(batchId)}`;
  let status = "processing";
  let completed = 0;
  let total = 0;
  const pages: FirecrawlPage[] = [];

  for (let pageNumber = 0; pageNumber < 10 && nextUrl; pageNumber += 1) {
    const parsedUrl = new URL(nextUrl);
    if (parsedUrl.origin !== "https://api.firecrawl.dev") {
      throw new Error("Firecrawl returned an invalid batch page URL.");
    }
    const response = await fetch(parsedUrl, {
      headers: { Authorization: `Bearer ${fcKey}` },
    });
    if (!response.ok) throw new Error(`Batch status failed (${response.status}).`);
    const body = (await response.json()) as FirecrawlEnvelope;
    const envelope = batchEnvelope(body);
    status = firstString(envelope?.status, body?.status, status).toLowerCase();
    completed = Number(envelope?.completed ?? body?.completed ?? completed) || completed;
    total = Number(envelope?.total ?? body?.total ?? total) || total;
    const responsePages = Array.isArray(envelope?.data)
      ? envelope.data
      : Array.isArray(body?.data)
        ? body.data
        : [];
    pages.push(...(responsePages as FirecrawlPage[]));

    const next = firstString(envelope?.next, body?.next);
    if (status !== "completed" || !next) break;
    nextUrl = next;
  }

  return { status, completed, total, pages };
}

const scrapeSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    vendor: { type: "string" },
    sku: { type: "string" },
    color: { type: "string" },
    selected_color: { type: "string" },
    finish: { type: "string" },
    selected_variant: { type: "string" },
    variant: { type: "string" },
    colorway: { type: "string" },
    dimensions: { type: "string" },
    price: {
      type: "string",
      description: "Exact visible price for the selected product variant. Never invent a price.",
    },
    current_price: { type: "string" },
    sale_price: { type: "string" },
    regular_price: { type: "string" },
    list_price: { type: "string" },
    price_per_item: { type: "string" },
    unit_cost: { type: "string" },
    shipping: { type: "string" },
    image_url: { type: "string" },
    carton_coverage_sq_ft: {
      type: "number",
      description:
        "Total square feet contained in one unopened box, carton, or case for the exact selected product size.",
    },
    carton_coverage_text: {
      type: "string",
      description: "Exact source line supporting carton coverage.",
    },
    coverage_matches_requested_variant: {
      type: "boolean",
      description:
        "True only if carton coverage clearly belongs to the exact selected size or SKU.",
    },
  },
};

function scrapedFromFirecrawlData(data: FirecrawlPage, sourceUrl: string): Scraped {
  const ex = data.json ?? data.extract ?? {};
  const meta = data.metadata ?? {};
  const pagePrice = priceFromPageText(data.markdown, data.html, sourceUrl);
  const parsedCoverage = resolveCartonCoverage({
    pageText: [data.markdown, data.html],
  });
  const coverage =
    ex.coverage_matches_requested_variant === true
      ? resolveCartonCoverage({
          extractedSquareFeet: ex.carton_coverage_sq_ft,
          extractedEvidence: ex.carton_coverage_text,
        })
      : {
          squareFeet: null,
          confidence: parsedCoverage.candidates.length ? ("review" as const) : ("missing" as const),
          evidence: firstString(ex.carton_coverage_text) || parsedCoverage.evidence,
          candidates: parsedCoverage.candidates,
        };
  return {
    name: firstString(ex.name, meta.title, meta.ogTitle),
    vendor: firstString(
      inferVendorFromUrl(sourceUrl),
      ex.vendor,
      meta.ogSiteName,
      meta["og:site_name"],
    ),
    sku: firstString(ex.sku, ex.model, ex.model_number),
    color: firstString(ex.color, ex.selected_color, ex.selected_variant, ex.colorway),
    finish: firstString(
      ex.finish,
      ex.color,
      ex.selected_color,
      ex.selected_variant,
      ex.variant,
      ex.colorway,
    ),
    dimensions: firstString(ex.dimensions, ex.size),
    price: firstPrice(
      ex.price,
      ex.current_price,
      ex.sale_price,
      ex.regular_price,
      ex.list_price,
      ex.price_per_item,
      pagePrice,
    ),
    unit_cost: firstPrice(ex.unit_cost),
    shipping: firstPrice(ex.shipping),
    image_url: firstString(ex.image_url, ex.image, meta.ogImage, meta["og:image"]),
    carton_coverage_sq_ft:
      coverage.confidence === "exact" ? (coverage.squareFeet ?? undefined) : undefined,
    carton_coverage_source_url: coverage.confidence === "exact" ? sourceUrl : undefined,
    carton_coverage_source_text: coverage.evidence ?? undefined,
    carton_coverage_confidence: coverage.confidence,
  };
}

async function scrapeOne(url: string, fcKey: string): Promise<Scraped> {
  const directProduct = await scrapeDirectProduct(url);
  if (directProduct?.price) return directProduct;
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      vendor: { type: "string" },
      sku: { type: "string" },
      color: {
        type: "string",
        description:
          "Selected color, selected swatch, colorway, or color option shown for this exact product URL",
      },
      selected_color: { type: "string" },
      finish: { type: "string" },
      selected_variant: { type: "string" },
      variant: { type: "string" },
      colorway: { type: "string" },
      dimensions: { type: "string" },
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
      unit_cost: { type: "string" },
      shipping: { type: "string" },
      image_url: { type: "string" },
      carton_coverage_sq_ft: {
        type: "number",
        description:
          "Total square feet contained in one unopened box, carton, or case for the exact selected product size.",
      },
      carton_coverage_text: { type: "string" },
      coverage_matches_requested_variant: { type: "boolean" },
    },
  };
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
    const res = await fetch(FIRECRAWL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fcKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        url,
        formats: [
          "markdown",
          "html",
          {
            type: "json",
            schema: scrapeSchema,
            prompt:
              "Extract product details from this page. If the URL or product page has a selected color, selected swatch, colorway, finish, SKU, or variant already chosen, capture that exact selected value. Capture only the primary product price matching the URL and selected SKU. For tile, capture the total square feet in one box/carton/case only when it clearly matches the exact selected size or SKU; never use pieces per box, price per square foot, pallet coverage, or another size. Ignore installation services, financing thresholds, shipping offers, and related or recommended product prices. If no exact variant price is visible, capture the primary product price range. Do not invent a color, price, or carton coverage.",
          },
        ],
        onlyMainContent: false,
        waitFor: 2000,
        maxAge: FIRECRAWL_MAX_AGE_MS,
        location: { country: "US", languages: ["en-US"] },
        proxy: "auto",
      }),
    });
    if (timeout) clearTimeout(timeout);
    timeout = null;
    if (!res.ok) {
      return { error: `Scrape failed (${res.status})` };
    }
    const body = (await res.json()) as FirecrawlEnvelope;
    const data = batchEnvelope(body.data ?? body) as FirecrawlPage;
    return mergeScraped(scrapedFromFirecrawlData(data, url), directProduct);
  } catch (e: any) {
    if (e?.name === "AbortError")
      return { error: "Scrape timed out. Try again or enter details manually." };
    return { error: e?.message || "Scrape failed" };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const Route = createFileRoute("/api/scrape-materials")({
  server: {
    handlers: {
      // Phase 1 — Firecrawl batch jobs return immediately; the client polls until ready.
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            action?: "start" | "poll" | "fallback";
            project_id?: string;
            exclude_material_item_ids?: string[];
            batch_id?: string;
            candidates?: Array<{
              material_item_id?: string;
              url?: string;
              existing_product_id?: string | null;
              needs_carton_coverage?: boolean;
            }>;
          };
          const projectId = cleanUuid(body.project_id);
          if (!projectId) return json({ error: "Valid project_id required" }, 400);
          const fcKey = process.env.FIRECRAWL_API_KEY;
          if (!fcKey) return json({ error: "Firecrawl is not connected yet." }, 500);

          if (body.action === "fallback") {
            if (!Array.isArray(body.candidates) || !body.candidates.length) {
              return json({ error: "Batch candidates required." }, 400);
            }
            const candidates = body.candidates.filter(
              (candidate) =>
                cleanUuid(candidate.material_item_id) && isScrapeableUrl(candidate.url),
            );
            const uniqueUrls = Array.from(
              new Set(candidates.map((candidate) => candidate.url?.trim() ?? "")),
            );
            const scrapedByUrl = new Map(
              await Promise.all(
                uniqueUrls.map(async (url) => [url, await scrapeOne(url, fcKey)] as const),
              ),
            );
            return json({
              status: "completed",
              rows: candidates.map((candidate) => {
                const url = candidate.url?.trim() ?? "";
                return {
                  material_item_id: cleanUuid(candidate.material_item_id),
                  url,
                  existing_product_id: cleanUuid(candidate.existing_product_id),
                  scraped: scrapedByUrl.get(url) ?? { error: "Scrape did not return a result." },
                };
              }),
            });
          }

          if (body.action === "poll") {
            if (!body.batch_id || !Array.isArray(body.candidates))
              return json({ error: "Batch details required." }, 400);
            const batch = await fetchBatchResult(body.batch_id, fcKey);
            if (
              batch.status === "scraping" ||
              batch.status === "processing" ||
              batch.status === "queued"
            ) {
              return json({
                status: "processing",
                completed_count: batch.completed,
                total_count: batch.total,
              });
            }
            const pages = batch.pages;
            const byUrl = new Map<string, FirecrawlPage>();
            pages.forEach((page) => {
              const sourceUrl = firstString(
                page?.metadata?.sourceURL,
                page?.metadata?.url,
                page?.url,
              );
              if (sourceUrl) {
                byUrl.set(sourceUrl, page);
                byUrl.set(canonicalScrapeUrl(sourceUrl), page);
              }
            });
            const rows = await Promise.all(
              body.candidates.map(async (candidate) => {
                const materialItemId = cleanUuid(candidate.material_item_id);
                const url = candidate.url?.trim() ?? "";
                const page = byUrl.get(url) ?? byUrl.get(canonicalScrapeUrl(url));
                const directProduct = await scrapeDirectProduct(url);
                return {
                  material_item_id: materialItemId,
                  url,
                  existing_product_id: cleanUuid(candidate.existing_product_id),
                  scraped:
                    materialItemId && page
                      ? mergeScraped(directProduct, scrapedFromFirecrawlData(page, url))
                      : directProduct?.price
                        ? directProduct
                        : { error: "Scrape did not return a result for this page." },
                };
              }),
            );
            return json({
              status: batch.status === "failed" ? "failed" : "completed",
              rows,
              completed_count: batch.completed,
              total_count: batch.total,
            });
          }

          const excludedIds = new Set(
            (Array.isArray(body.exclude_material_item_ids) ? body.exclude_material_item_ids : [])
              .map((id) => cleanUuid(id))
              .filter((id): id is string => Boolean(id)),
          );
          const { data: items, error } = await supabaseAdmin
            .from("material_items")
            .select(
              "id, category, product_url, product_id, scrape_status, product:products(id, price, carton_coverage_sq_ft)",
            )
            .eq("project_id", projectId)
            .not("product_url", "is", null);
          if (error) return json({ error: error.message }, 500);
          const linkedItems = items ?? [];
          const validLinkItems = linkedItems.filter((item) => isScrapeableUrl(item.product_url));
          const invalid_link_count = linkedItems.length - validLinkItems.length;
          const candidates = validLinkItems.filter((item: any) => {
            const tileItem = /tile|stone/i.test(String(item.category ?? ""));
            return (
              !excludedIds.has(item.id) &&
              (!hasValue(item.product?.price) ||
                (tileItem && !hasValue(item.product?.carton_coverage_sq_ft)))
            );
          });
          const already_scraped_count = validLinkItems.length - candidates.length;
          const batchItems = candidates.slice(0, MAX_SCRAPE_ROWS_PER_BATCH);
          const remaining_count = Math.max(0, candidates.length - batchItems.length);
          const batchCandidates = batchItems.map((item: any) => ({
            material_item_id: item.id,
            url: item.product_url.trim(),
            existing_product_id: item.product?.id ?? item.product_id ?? null,
            needs_carton_coverage:
              /tile|stone/i.test(String(item.category ?? "")) &&
              !hasValue(item.product?.carton_coverage_sq_ft),
          }));
          if (!batchCandidates.length) {
            return json({
              status: "completed",
              rows: [],
              invalid_link_count,
              already_scraped_count,
              remaining_count,
            });
          }
          const directRows = await Promise.all(
            batchCandidates.map(async (candidate) => ({
              material_item_id: cleanUuid(candidate.material_item_id),
              url: candidate.url,
              existing_product_id: cleanUuid(candidate.existing_product_id),
              needs_carton_coverage: candidate.needs_carton_coverage,
              scraped: await scrapeDirectProduct(candidate.url),
            })),
          );
          const prefetchedRows = directRows
            .filter((row) => row.scraped?.price && !row.needs_carton_coverage)
            .map((row) => ({ ...row, scraped: row.scraped as Scraped }));
          const prefetchedIds = new Set(prefetchedRows.map((row) => row.material_item_id));
          const firecrawlCandidates = batchCandidates.filter(
            (candidate) => !prefetchedIds.has(cleanUuid(candidate.material_item_id)),
          );
          if (!firecrawlCandidates.length) {
            return json({
              status: "completed",
              rows: prefetchedRows,
              invalid_link_count,
              already_scraped_count,
              remaining_count,
            });
          }
          const urls = Array.from(new Set(firecrawlCandidates.map((candidate) => candidate.url)));
          const response = await fetch(FIRECRAWL_BATCH_API, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${fcKey}` },
            body: JSON.stringify({
              urls,
              maxConcurrency: 4,
              formats: [
                "markdown",
                "html",
                {
                  type: "json",
                  schema: scrapeSchema,
                  prompt:
                    "Extract product details and the exact current visible price for the primary product matching the URL and selected SKU. For tile, capture total square feet per unopened box/carton/case only when it clearly matches the exact selected size or SKU. Ignore pieces per box, price per square foot, pallet coverage, installation services, financing thresholds, shipping offers, and related or recommended product prices. Do not invent a price or carton coverage.",
                },
              ],
              onlyMainContent: false,
              timeout: 30000,
              waitFor: 2000,
              maxAge: FIRECRAWL_MAX_AGE_MS,
              location: { country: "US", languages: ["en-US"] },
              proxy: "auto",
            }),
          });
          if (!response.ok)
            return json({ error: `Could not start scrape batch (${response.status}).` }, 502);
          const batchBody = (await response.json()) as FirecrawlEnvelope;
          const batch = batchEnvelope(batchBody);
          const batchId = firstString(batch?.id, batchBody?.id);
          if (!batchId) return json({ error: "Firecrawl did not return a batch id." }, 502);
          return json({
            status: "started",
            batch_id: batchId,
            candidates: firecrawlCandidates,
            prefetched_rows: prefetchedRows,
            invalid_link_count,
            already_scraped_count,
            remaining_count,
          });
        } catch (e: any) {
          return json({ error: e?.message || "Unexpected error" }, 500);
        }
      },

      // Phase 2 — save scraped rows to catalog + link material_items.
      PUT: async ({ request }) => {
        try {
          const { rows } = (await request.json()) as {
            rows: Array<{
              material_item_id: string;
              url: string;
              existing_product_id?: string | null;
              scraped: Scraped;
            }>;
          };
          if (!Array.isArray(rows)) return json({ error: "rows required" }, 400);

          for (const row of rows) {
            const materialItemId = cleanUuid(row.material_item_id);
            if (!materialItemId) continue;

            // Look up material item early so we have its category + room
            const { data: matItem } = await supabaseAdmin
              .from("material_items")
              .select("id, room_id, category, color")
              .eq("id", materialItemId)
              .maybeSingle();

            let productId = cleanUuid(row.existing_product_id);

            if (!productId) {
              const { data: dup } = await supabaseAdmin
                .from("products")
                .select("id")
                .eq("product_url", row.url)
                .maybeSingle();
              productId = cleanUuid(dup?.id);
            }

            const payload = compactPayload({
              name: row.scraped.name || "Untitled product",
              category: toProductCategory(matItem?.category),
              vendor: firstString(row.scraped.vendor, inferVendorFromUrl(row.url)) || null,
              product_url: row.url,
              image_url: row.scraped.image_url || null,
              finish: row.scraped.finish || row.scraped.color || null,
              sku: row.scraped.sku || null,
              dimensions: row.scraped.dimensions || null,
              price: normalizeMoneyInput(row.scraped.price),
              unit_cost: normalizeMoneyInput(row.scraped.unit_cost),
              shipping: normalizeMoneyInput(row.scraped.shipping),
              carton_coverage_sq_ft: row.scraped.carton_coverage_sq_ft ?? null,
              carton_coverage_source_url: row.scraped.carton_coverage_source_url || null,
              carton_coverage_source_text: row.scraped.carton_coverage_source_text || null,
              carton_coverage_confidence: row.scraped.carton_coverage_confidence || null,
              carton_coverage_scraped_at: row.scraped.carton_coverage_confidence
                ? new Date().toISOString()
                : null,
            });

            if (productId) {
              const { data: existingProduct } = await supabaseAdmin
                .from("products")
                .select("*")
                .eq("id", productId)
                .maybeSingle();
              const patch = fillBlankProductFields(existingProduct as any, payload);
              const sourceVendor = firstString(inferVendorFromUrl(row.url), row.scraped.vendor);
              if (sourceVendor && existingProduct?.vendor !== sourceVendor) {
                patch.vendor = sourceVendor;
              }
              if (
                row.scraped.carton_coverage_sq_ft &&
                !hasValue(existingProduct?.carton_coverage_sq_ft)
              ) {
                patch.carton_coverage_sq_ft = row.scraped.carton_coverage_sq_ft;
                patch.carton_coverage_source_url =
                  row.scraped.carton_coverage_source_url || row.url;
                patch.carton_coverage_source_text = row.scraped.carton_coverage_source_text || null;
                patch.carton_coverage_confidence = "exact";
                patch.carton_coverage_scraped_at = new Date().toISOString();
              }
              if (Object.keys(patch).length) {
                const { error: updateError } = await supabaseAdmin
                  .from("products")
                  .update(patch)
                  .eq("id", productId);
                if (updateError) return json({ error: updateError.message }, 500);
              }
            } else {
              const { data: inserted, error: insErr } = await supabaseAdmin
                .from("products")
                .insert(payload)
                .select("id")
                .single();
              if (insErr) return json({ error: insErr.message }, 500);
              productId = cleanUuid(inserted?.id);
            }

            if (productId) {
              const scrapedPrice = normalizeMoneyInput(row.scraped.price);
              const materialUpdate: Record<string, unknown> = {
                product_id: productId,
                scrape_status: scrapedPrice ? "scraped" : "price_missing",
                scrape_error: scrapedPrice
                  ? null
                  : "No reliable price found. Use the Studio extension to fill or verify this price.",
              };
              const scrapedColor = firstString(row.scraped.color, row.scraped.finish);
              if (scrapedColor && !matItem?.color) {
                materialUpdate.color = scrapedColor;
              }

              const { error: materialUpdateError } = await supabaseAdmin
                .from("material_items")
                .update(materialUpdate)
                .eq("id", materialItemId);
              if (materialUpdateError) return json({ error: materialUpdateError.message }, 500);

              const roomId = cleanUuid(matItem?.room_id);
              if (roomId) {
                const { data: existingLink } = await supabaseAdmin
                  .from("room_products")
                  .select("id")
                  .eq("room_id", roomId)
                  .eq("product_id", productId)
                  .maybeSingle();

                if (!existingLink) {
                  const { error: linkError } = await supabaseAdmin.from("room_products").insert({
                    room_id: roomId,
                    product_id: productId,
                    is_key_selection: false,
                  });
                  if (linkError) return json({ error: linkError.message }, 500);
                }
              }
            }
          }

          return json({ ok: true });
        } catch (e: any) {
          return json({ error: e?.message || "Commit failed" }, 500);
        }
      },
    },
  },
});
