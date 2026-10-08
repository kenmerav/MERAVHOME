import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toProductCategory } from "@/lib/roomTemplates";
import { normalizeMoneyInput } from "@/lib/money";
import {
  exactProductPrice,
  firstProductPrice as firstPrice,
  formatProductPrice as formatPriceNumber,
  selectedSkuPriceFromHtml,
} from "@/lib/productPricing";
import { cleanUuid } from "@/lib/ids";
import { inferVendorFromUrl } from "@/lib/vendorInference";
import { resolveCartonCoverage } from "@/lib/cartonCoverage";
import {
  FIRECRAWL_PRODUCT_PROMPT,
  FIRECRAWL_PRODUCT_SCHEMA,
  missingProductSpecifications,
  normalizeFirecrawlProduct,
} from "@/lib/firecrawlProduct";

import {
  CATALOG_NAME_PENDING_NOTE,
  shouldReplaceCatalogProductName,
} from "@/lib/catalogProductName";

const MATERIAL_SCRAPE_PROMPT = `${FIRECRAWL_PRODUCT_PROMPT} For tile, capture total square feet per unopened box/carton/case only when it clearly matches the exact selected size or SKU. Ignore pieces per box, price per square foot, pallet coverage, installation services, financing thresholds, shipping offers, and related or recommended product prices. Never invent carton coverage.`;

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
  options?: Array<string | { name?: string }>;
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
    // Without a selected variant, a multi-option product has no confirmed finish/color/size.
    const specVariant = selected ?? (variants.length === 1 ? variants[0] : undefined);
    const option = (pattern: RegExp) => {
      const index =
        product.options?.findIndex((value) =>
          pattern.test(typeof value === "string" ? value : (value.name ?? "")),
        ) ?? -1;
      return index >= 0 ? firstString(specVariant?.options?.[index]) : "";
    };
    return {
      name: firstString(product.title),
      vendor: firstString(inferVendorFromUrl(url), product.vendor),
      sku: firstString(representative?.sku),
      color: option(/colou?r|colorway/i),
      finish: option(/finish|surface|treatment/i),
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
    ...FIRECRAWL_PRODUCT_SCHEMA.properties,
    name: { type: "string" },
    vendor: { type: "string" },
    sku: { type: "string" },
    selected_variant: { type: "string" },
    variant: { type: "string" },
    colorway: { type: "string" },
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
  const product = normalizeFirecrawlProduct(data, sourceUrl);
  const ex = data.json ?? data.extract ?? {};
  const meta = data.metadata ?? {};
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
    color: product.color,
    finish: product.finish,
    dimensions: product.dimensions,
    price: product.price,
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
  // The direct retailer response may have pricing but omit the specifications.
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
            prompt: MATERIAL_SCRAPE_PROMPT,
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
      return directProduct?.price ? directProduct : { error: `Scrape failed (${res.status})` };
    }
    const body = (await res.json()) as FirecrawlEnvelope;
    const data = batchEnvelope(body.data ?? body) as FirecrawlPage;
    return mergeScraped(directProduct, scrapedFromFirecrawlData(data, url));
  } catch (e: any) {
    if (directProduct?.price) return directProduct;
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
              "id, category, color, product_url, product_id, scrape_status, product:products(id, price, finish, dimensions, carton_coverage_sq_ft)",
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
              (!exactProductPrice(item.product?.price) ||
                missingProductSpecifications({
                  finish: item.product?.finish,
                  color: item.color,
                  dimensions: item.product?.dimensions,
                }).length > 0 ||
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
            .filter(
              (row) =>
                row.scraped?.price &&
                !row.needs_carton_coverage &&
                !missingProductSpecifications(row.scraped).length,
            )
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
                  prompt: MATERIAL_SCRAPE_PROMPT,
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

          let pricedCount = 0;
          let priceMissingCount = 0;

          for (const row of rows) {
            if (row.scraped.error) continue;
            const materialItemId = cleanUuid(row.material_item_id);
            if (!materialItemId) continue;

            // Look up material item early so we have its category + room
            const { data: matItem } = await supabaseAdmin
              .from("material_items")
              .select("id, room_id, category, color, item_label, client_product_name, notes")
              .eq("id", materialItemId)
              .maybeSingle();

            let productId = cleanUuid(row.existing_product_id);
            let savedPrice = exactProductPrice(row.scraped.price);

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
              finish: row.scraped.finish || null,
              sku: row.scraped.sku || null,
              dimensions: row.scraped.dimensions || null,
              price: savedPrice || null,
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
              if (savedPrice && !exactProductPrice(existingProduct?.price))
                patch.price = savedPrice;
              savedPrice = exactProductPrice(existingProduct?.price) || savedPrice;
              if (
                shouldReplaceCatalogProductName({
                  existingName: existingProduct?.name,
                  scrapedName: row.scraped.name,
                  itemLabel: matItem?.item_label,
                  clientProductName: matItem?.client_product_name,
                  notes: existingProduct?.notes,
                })
              ) {
                patch.name = row.scraped.name?.trim();
                if (existingProduct?.notes === CATALOG_NAME_PENDING_NOTE) patch.notes = null;
              }
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
              const range = firstPrice(row.scraped.price);
              const priceReview =
                range && !exactProductPrice(range)
                  ? `Retailer price range ${range}. Select the exact size/finish before assigning a price.`
                  : "No reliable price found. Use the Studio extension to fill or verify this price.";
              const materialUpdate: Record<string, unknown> = {
                product_id: productId,
                scrape_status: savedPrice ? "scraped" : "price_missing",
                scrape_error: savedPrice ? null : priceReview,
              };
              if (savedPrice) pricedCount += 1;
              else {
                priceMissingCount += 1;
                if (
                  range &&
                  !exactProductPrice(range) &&
                  !String(matItem?.notes ?? "").includes(priceReview)
                ) {
                  materialUpdate.notes = [matItem?.notes, priceReview].filter(Boolean).join("\n");
                }
              }
              const scrapedColor = firstString(row.scraped.color);
              if (scrapedColor && !hasValue(matItem?.color)) {
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

          return json({
            ok: true,
            priced_count: pricedCount,
            price_missing_count: priceMissingCount,
          });
        } catch (e: any) {
          return json({ error: e?.message || "Commit failed" }, 500);
        }
      },
    },
  },
});
