import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toProductCategory } from "@/lib/roomTemplates";
import { normalizeMoneyInput } from "@/lib/money";
import { cleanUuid } from "@/lib/ids";
import { inferVendorFromUrl } from "@/lib/vendorInference";

const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_BATCH_API = "https://api.firecrawl.dev/v2/batch/scrape";
const MAX_SCRAPE_ROWS_PER_BATCH = 12;
const SCRAPE_TIMEOUT_MS = 15000;

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

function isScrapeableUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
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
  error?: string;
};

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
  },
};

function scrapedFromFirecrawlData(data: any, sourceUrl: string): Scraped {
  const ex = data?.json ?? data?.extract ?? {};
  const meta = data?.metadata ?? {};
  const pagePrice = priceFromPageText(data?.markdown, data?.html);
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
  };
}

async function scrapeOne(url: string, fcKey: string): Promise<Scraped> {
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
              "Extract product details from this page. If the URL or product page has a selected color, selected swatch, colorway, finish, or variant already chosen, capture that exact selected value. Capture the exact customer-visible price for that selected variant. If no exact variant price is visible, capture the product price range. Do not invent a color or price.",
          },
        ],
        onlyMainContent: false,
      }),
    });
    if (timeout) clearTimeout(timeout);
    timeout = null;
    if (!res.ok) {
      return { error: `Scrape failed (${res.status})` };
    }
    const body = (await res.json()) as any;
    const data = body?.data ?? body;
    return scrapedFromFirecrawlData(data, url);
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
            action?: "start" | "poll";
            project_id?: string;
            exclude_material_item_ids?: string[];
            batch_id?: string;
            candidates?: Array<{
              material_item_id?: string;
              url?: string;
              existing_product_id?: string | null;
            }>;
          };
          const projectId = cleanUuid(body.project_id);
          if (!projectId) return json({ error: "Valid project_id required" }, 400);
          const fcKey = process.env.FIRECRAWL_API_KEY;
          if (!fcKey) return json({ error: "Firecrawl is not connected yet." }, 500);

          if (body.action === "poll") {
            if (!body.batch_id || !Array.isArray(body.candidates))
              return json({ error: "Batch details required." }, 400);
            const response = await fetch(
              `${FIRECRAWL_BATCH_API}/${encodeURIComponent(body.batch_id)}`,
              {
                headers: { Authorization: `Bearer ${fcKey}` },
              },
            );
            if (!response.ok)
              return json({ error: `Batch status failed (${response.status}).` }, 502);
            const batchBody = (await response.json()) as any;
            const batch = batchBody?.data ?? batchBody;
            const status = String(batch?.status ?? "processing").toLowerCase();
            if (!/(completed|done|failed|error)/.test(status))
              return json({ status: "processing" });
            const pages = Array.isArray(batch?.data) ? batch.data : [];
            const byUrl = new Map<string, any>();
            pages.forEach((page: any) => {
              const sourceUrl = firstString(
                page?.metadata?.sourceURL,
                page?.metadata?.url,
                page?.url,
              );
              if (sourceUrl) byUrl.set(sourceUrl, page);
            });
            const rows = body.candidates.map((candidate) => {
              const materialItemId = cleanUuid(candidate.material_item_id);
              const url = candidate.url?.trim() ?? "";
              const page = byUrl.get(url);
              return {
                material_item_id: materialItemId,
                url,
                existing_product_id: cleanUuid(candidate.existing_product_id),
                scraped:
                  materialItemId && page
                    ? scrapedFromFirecrawlData(page, url)
                    : { error: "Scrape did not return a result for this page." },
              };
            });
            return json({ status: /(failed|error)/.test(status) ? "failed" : "completed", rows });
          }

          const excludedIds = new Set(
            (Array.isArray(body.exclude_material_item_ids) ? body.exclude_material_item_ids : [])
              .map((id) => cleanUuid(id))
              .filter((id): id is string => Boolean(id)),
          );
          const { data: items, error } = await supabaseAdmin
            .from("material_items")
            .select("id, product_url, product_id, scrape_status, product:products(id, price)")
            .eq("project_id", projectId)
            .not("product_url", "is", null);
          if (error) return json({ error: error.message }, 500);
          const linkedItems = items ?? [];
          const validLinkItems = linkedItems.filter((item) => isScrapeableUrl(item.product_url));
          const invalid_link_count = linkedItems.length - validLinkItems.length;
          const candidates = validLinkItems.filter(
            (item: any) => !excludedIds.has(item.id) && !hasValue(item.product?.price),
          );
          const already_scraped_count = validLinkItems.length - candidates.length;
          const batchItems = candidates.slice(0, MAX_SCRAPE_ROWS_PER_BATCH);
          const remaining_count = Math.max(0, candidates.length - batchItems.length);
          const batchCandidates = batchItems.map((item: any) => ({
            material_item_id: item.id,
            url: item.product_url.trim(),
            existing_product_id: item.product?.id ?? item.product_id ?? null,
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
          const urls = Array.from(new Set(batchCandidates.map((candidate) => candidate.url)));
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
                    "Extract product details and the exact current visible price. Do not invent a price.",
                },
              ],
              onlyMainContent: false,
              timeout: 30000,
            }),
          });
          if (!response.ok)
            return json({ error: `Could not start scrape batch (${response.status}).` }, 502);
          const batchBody = (await response.json()) as any;
          const batch = batchBody?.data ?? batchBody;
          const batchId = firstString(batch?.id, batchBody?.id);
          if (!batchId) return json({ error: "Firecrawl did not return a batch id." }, 502);
          return json({
            status: "started",
            batch_id: batchId,
            candidates: batchCandidates,
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
              if (Object.keys(patch).length) {
                await supabaseAdmin.from("products").update(patch).eq("id", productId);
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

              await supabaseAdmin
                .from("material_items")
                .update(materialUpdate)
                .eq("id", materialItemId);

              const roomId = cleanUuid(matItem?.room_id);
              if (roomId) {
                const { data: existingLink } = await supabaseAdmin
                  .from("room_products")
                  .select("id")
                  .eq("room_id", roomId)
                  .eq("product_id", productId)
                  .maybeSingle();

                if (!existingLink) {
                  await supabaseAdmin.from("room_products").insert({
                    room_id: roomId,
                    product_id: productId,
                    is_key_selection: false,
                  });
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
