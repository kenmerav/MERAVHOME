import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toProductCategory } from "@/lib/roomTemplates";

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

type Scraped = {
  name?: string;
  vendor?: string;
  image_url?: string;
  finish?: string;
  sku?: string;
  dimensions?: string;
  price?: string;
  description?: string;
  error?: string;
};

async function scrapeOne(url: string, fcKey: string): Promise<Scraped> {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      vendor: { type: "string" },
      sku: { type: "string" },
      finish: { type: "string" },
      dimensions: { type: "string" },
      price: { type: "string" },
      description: { type: "string" },
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
        formats: [{ type: "json", schema, prompt: "Extract product details from this page." }],
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
      finish: firstString(ex.finish, ex.color, ex.variant),
      dimensions: firstString(ex.dimensions, ex.size),
      price: firstString(ex.price),
      description: firstString(ex.description, meta.description, meta.ogDescription),
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
          if (!project_id) return json({ error: "project_id required" }, 400);

          const fcKey = process.env.FIRECRAWL_API_KEY;
          if (!fcKey) return json({ error: "Firecrawl is not connected yet." }, 500);

          const { data: items, error } = await supabaseAdmin
            .from("material_items")
            .select("id, product_url, product_id, scrape_status")
            .eq("project_id", project_id)
            .eq("not_needed", false)
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
              .select("id, name, vendor, image_url, finish, sku, dimensions, price, description")
              .eq("product_url", url)
              .maybeSingle();

            if (existing) {
              rows.push({
                material_item_id: it.id,
                url,
                existing_product_id: existing.id,
                scraped: {
                  name: existing.name ?? "",
                  vendor: existing.vendor ?? "",
                  image_url: existing.image_url ?? "",
                  finish: existing.finish ?? "",
                  sku: existing.sku ?? "",
                  dimensions: existing.dimensions ?? "",
                  price: existing.price ?? "",
                  description: existing.description ?? "",
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
            // Look up material item early so we have its category + room
            const { data: matItem } = await supabaseAdmin
              .from("material_items")
              .select("id, room_id, category")
              .eq("id", row.material_item_id)
              .maybeSingle();

            let productId = row.existing_product_id ?? null;

            if (!productId) {
              const { data: dup } = await supabaseAdmin
                .from("products")
                .select("id")
                .eq("product_url", row.url)
                .maybeSingle();
              productId = dup?.id ?? null;
            }

            const payload = {
              name: row.scraped.name || "Untitled product",
              category: toProductCategory(matItem?.category),
              vendor: row.scraped.vendor || null,
              product_url: row.url,
              image_url: row.scraped.image_url || null,
              finish: row.scraped.finish || null,
              sku: row.scraped.sku || null,
              dimensions: row.scraped.dimensions || null,
              price: row.scraped.price || null,
              description: row.scraped.description || null,
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
              productId = inserted?.id ?? null;
            }

            if (productId) {
              await supabaseAdmin
                .from("material_items")
                .update({
                  product_id: productId,
                  scrape_status: "scraped",
                  scrape_error: null,
                })
                .eq("id", row.material_item_id);

              if (matItem?.room_id) {
                const { data: existingLink } = await supabaseAdmin
                  .from("room_products")
                  .select("id")
                  .eq("room_id", matItem.room_id)
                  .eq("product_id", productId)
                  .maybeSingle();

                if (!existingLink) {
                  await supabaseAdmin
                    .from("room_products")
                    .insert({
                      room_id: matItem.room_id,
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
