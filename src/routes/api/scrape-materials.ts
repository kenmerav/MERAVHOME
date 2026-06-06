import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toProductCategory } from "@/lib/roomTemplates";
import { normalizeMoneyInput } from "@/lib/money";
import { cleanUuid } from "@/lib/ids";

const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function firstString(...vals: unknown[]) {
  return vals.find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim() ?? "";
}

function firstPrice(...vals: unknown[]) {
  for (const val of vals) {
    if (typeof val !== "string") continue;
    const text = val.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const match = text.match(/\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\$?\s*\d+(?:\.\d{2})?/);
    if (!match) continue;

    const cleaned = match[0].replace(/\s+/g, "");
    if (!/\d/.test(cleaned)) continue;
    return cleaned.startsWith("$") ? cleaned : `$${cleaned}`;
  }
  return "";
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

async function scrapeOne(url: string, fcKey: string): Promise<Scraped> {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      vendor: { type: "string" },
      sku: { type: "string" },
      color: {
        type: "string",
        description: "Selected color, selected swatch, colorway, or color option shown for this exact product URL",
      },
      selected_color: { type: "string" },
      finish: { type: "string" },
      selected_variant: { type: "string" },
      variant: { type: "string" },
      colorway: { type: "string" },
      dimensions: { type: "string" },
      price: {
        type: "string",
        description: "Current product price shown to the customer, formatted with a dollar sign when available",
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
  try {
    const res = await fetch(FIRECRAWL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${fcKey}`,
      },
      body: JSON.stringify({
        url,
        formats: [{
          type: "json",
          schema,
          prompt: "Extract product details from this page. If the URL or product page has a selected color, selected swatch, colorway, finish, or variant already chosen, capture that exact selected value. Do not invent a color when only a list of options is visible.",
        }],
        onlyMainContent: true,
      }),
    });
    if (!res.ok) {
      return { error: `Scrape failed (${res.status})` };
    }
    const body = (await res.json()) as any;
    const data = body?.data ?? body;
    const ex = data?.json ?? data?.extract ?? {};
    const meta = data?.metadata ?? {};
    return {
      name: firstString(ex.name, meta.title, meta.ogTitle),
      vendor: firstString(ex.vendor, meta.ogSiteName, meta["og:site_name"]),
      sku: firstString(ex.sku, ex.model, ex.model_number),
      color: firstString(ex.color, ex.selected_color, ex.selected_variant, ex.colorway),
      finish: firstString(ex.finish, ex.color, ex.selected_color, ex.selected_variant, ex.variant, ex.colorway),
      dimensions: firstString(ex.dimensions, ex.size),
      price: firstPrice(ex.price, ex.current_price, ex.sale_price, ex.regular_price, ex.list_price, ex.price_per_item),
      unit_cost: firstString(ex.unit_cost),
      shipping: firstString(ex.shipping),
      image_url: firstString(ex.image_url, ex.image, meta.ogImage, meta["og:image"]),
    };
  } catch (e: any) {
    return { error: e?.message || "Scrape failed" };
  }
}

export const Route = createFileRoute("/api/scrape-materials")({
  server: {
    handlers: {
      // Phase 1 — fetch + scrape, return for review
      POST: async ({ request }) => {
        try {
          const { project_id } = (await request.json()) as { project_id?: string };
          const projectId = cleanUuid(project_id);
          if (!projectId) return json({ error: "Valid project_id required" }, 400);

          const fcKey = process.env.FIRECRAWL_API_KEY;
          if (!fcKey) return json({ error: "Firecrawl is not connected yet." }, 500);

          const { data: items, error } = await supabaseAdmin
            .from("material_items")
            .select("id, product_url, product_id, scrape_status")
            .eq("project_id", projectId)
            .not("product_url", "is", null);
          if (error) return json({ error: error.message }, 500);

          const candidates = (items ?? []).filter(
            (it) => it.product_url && it.product_url.trim().length > 0,
          );

          const rows: any[] = [];
          for (const it of candidates) {
            const url = it.product_url!.trim();
            // Catalog dedupe by exact URL
            const { data: existing } = await supabaseAdmin
              .from("products")
              .select("id, name, vendor, image_url, finish, sku, dimensions, price, unit_cost, shipping")
              .eq("product_url", url)
              .maybeSingle();

            if (existing) {
              const refreshed = existing.price ? null : await scrapeOne(url, fcKey);
              rows.push({
                material_item_id: it.id,
                url,
                existing_product_id: existing.id,
                scraped: {
                  name: firstString(existing.name, refreshed?.name),
                  vendor: firstString(existing.vendor, refreshed?.vendor),
                  image_url: firstString(existing.image_url, refreshed?.image_url),
                  color: firstString(existing.finish, refreshed?.color),
                  finish: firstString(existing.finish, refreshed?.finish, refreshed?.color),
                  sku: firstString(existing.sku, refreshed?.sku),
                  dimensions: firstString(existing.dimensions, refreshed?.dimensions),
                  price: firstPrice(existing.price, refreshed?.price),
                  unit_cost: firstPrice(existing.unit_cost, refreshed?.unit_cost),
                  shipping: firstPrice(existing.shipping, refreshed?.shipping),
                },
              });
              continue;
            }

            const scraped = await scrapeOne(url, fcKey);
            rows.push({
              material_item_id: it.id,
              url,
              existing_product_id: null,
              scraped,
            });
          }

          return json({ rows });
        } catch (e: any) {
          return json({ error: e?.message || "Unexpected error" }, 500);
        }
      },

      // Phase 2 — commit reviewed rows to catalog + link material_items
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

            const payload = {
              name: row.scraped.name || "Untitled product",
              category: toProductCategory(matItem?.category),
              vendor: row.scraped.vendor || null,
              product_url: row.url,
              image_url: row.scraped.image_url || null,
              finish: row.scraped.finish || row.scraped.color || null,
              sku: row.scraped.sku || null,
              dimensions: row.scraped.dimensions || null,
              price: normalizeMoneyInput(row.scraped.price),
              unit_cost: normalizeMoneyInput(row.scraped.unit_cost),
              shipping: normalizeMoneyInput(row.scraped.shipping),
            };

            if (productId) {
              await supabaseAdmin.from("products").update(payload).eq("id", productId);
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
              const materialUpdate: Record<string, unknown> = {
                product_id: productId,
                scrape_status: "scraped",
                scrape_error: null,
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
                  await supabaseAdmin
                    .from("room_products")
                    .insert({
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
