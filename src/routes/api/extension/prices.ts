import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanUuid } from "@/lib/ids";
import { normalizeMoneyInput } from "@/lib/money";
import { toProductCategory } from "@/lib/roomTemplates";
import { inferVendorFromUrl } from "@/lib/vendorInference";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function isAuthorized(request: Request) {
  const configuredToken = process.env.MERAV_EXTENSION_TOKEN;
  if (!configuredToken) throw new Error("MERAV_EXTENSION_TOKEN is not configured in Studio.");
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return Boolean(token && token === configuredToken);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalProductUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid$|gclid$|mc_|_hs)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function isPrice(value: string) {
  return /^\$?\s*\d[\d,]*(?:\.\d{2})?$/.test(value.trim());
}

function cleanPrice(value: unknown) {
  const text = cleanText(value);
  return isPrice(text) ? normalizeMoneyInput(text) : null;
}

type CapturedProduct = {
  name?: string;
  vendor?: string;
  sku?: string;
  colorFinish?: string;
  dimensions?: string;
  price?: string;
  imageUrl?: string;
};

async function loadMaterial(projectId: string, materialItemId: string) {
  return (
    await supabaseAdmin
      .from("material_items")
      .select("*, product:products(*)")
      .eq("id", materialItemId)
      .eq("project_id", projectId)
      .maybeSingle()
  ).data as any;
}

async function findOrCreateProduct(material: any, captured: CapturedProduct, price: string | null) {
  let product = material.product ?? null;
  if (!product && material.product_id) {
    product = (
      await supabaseAdmin.from("products").select("*").eq("id", material.product_id).maybeSingle()
    ).data;
  }
  if (!product && material.product_url) {
    const { data: candidates } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("product_url", material.product_url)
      .limit(25);
    product = (candidates ?? [])[0] ?? null;
  }

  const sourceUrl = cleanText(material.product_url);
  const finish = cleanText(captured.colorFinish) || material.color || null;
  if (!product) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .insert({
        name: cleanText(captured.name) || material.item_label || "Imported product",
        category: toProductCategory(material.category),
        vendor: cleanText(captured.vendor) || inferVendorFromUrl(sourceUrl) || null,
        product_url: sourceUrl || null,
        image_url: cleanText(captured.imageUrl) || material.image_url || null,
        finish,
        sku: cleanText(captured.sku) || null,
        dimensions: cleanText(captured.dimensions) || null,
        price,
      } as any)
      .select()
      .single();
    if (error || !data) throw error ?? new Error("Could not create product.");
    product = data;
  } else {
    const patch: Record<string, unknown> = {};
    if (!product.name && cleanText(captured.name)) patch.name = cleanText(captured.name);
    if (!product.vendor && (cleanText(captured.vendor) || inferVendorFromUrl(sourceUrl))) {
      patch.vendor = cleanText(captured.vendor) || inferVendorFromUrl(sourceUrl);
    }
    if (!product.finish && finish) patch.finish = finish;
    if (!product.sku && cleanText(captured.sku)) patch.sku = cleanText(captured.sku);
    if (!product.dimensions && cleanText(captured.dimensions))
      patch.dimensions = cleanText(captured.dimensions);
    if (!product.image_url && (cleanText(captured.imageUrl) || material.image_url)) {
      patch.image_url = cleanText(captured.imageUrl) || material.image_url;
    }
    if (!product.product_url && sourceUrl) patch.product_url = sourceUrl;
    if (Object.keys(patch).length) {
      const { data, error } = await supabaseAdmin
        .from("products")
        .update(patch)
        .eq("id", product.id)
        .select()
        .single();
      if (error) throw error;
      product = data;
    }
  }

  if (material.product_id !== product.id) {
    await supabaseAdmin
      .from("material_items")
      .update({ product_id: product.id })
      .eq("id", material.id);
  }
  const { data: roomLink } = await supabaseAdmin
    .from("room_products")
    .select("id")
    .eq("room_id", material.room_id)
    .eq("product_id", product.id)
    .maybeSingle();
  if (!roomLink) {
    await supabaseAdmin
      .from("room_products")
      .insert({ room_id: material.room_id, product_id: product.id, is_key_selection: false });
  }
  return product as any;
}

export const Route = createFileRoute("/api/extension/prices")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      GET: async ({ request }) => {
        try {
          if (!isAuthorized(request))
            return json({ error: "Extension pricing is not authorized." }, 401);
          const url = new URL(request.url);
          const projectId = cleanUuid(url.searchParams.get("projectId"));
          const mode = url.searchParams.get("mode") === "verify" ? "verify" : "missing";
          if (!projectId) return json({ error: "Valid projectId required." }, 400);
          const { data, error } = await supabaseAdmin
            .from("material_items")
            .select(
              "id,project_id,item_label,product_url,product_id,category,color,image_url,product:products(id,name,price)",
            )
            .eq("project_id", projectId)
            .not("product_url", "is", null);
          if (error) throw error;

          const unique = new Map<string, any>();
          for (const item of data ?? []) {
            const sourceUrl = cleanText((item as any).product_url);
            if (!/^https?:\/\//i.test(sourceUrl)) continue;
            const product = (item as any).product;
            if (mode === "missing" && cleanText(product?.price)) continue;
            if (mode === "verify" && !cleanText(product?.price)) continue;
            const key = product?.id
              ? `product:${product.id}`
              : `url:${canonicalProductUrl(sourceUrl)}`;
            if (!unique.has(key)) {
              unique.set(key, {
                materialItemId: item.id,
                sourcePageUrl: sourceUrl,
                label: item.item_label,
                currentPrice: product?.price ?? null,
              });
            }
          }
          return json({ mode, items: Array.from(unique.values()) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not load price queue.";
          console.error("[Extension Prices] Queue failed", error);
          return json({ error: message }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          if (!isAuthorized(request))
            return json({ error: "Extension pricing is not authorized." }, 401);
          const body = (await request.json()) as {
            action?: "capture" | "approve";
            mode?: "missing" | "verify" | "current";
            projectId?: string;
            materialItemId?: string;
            sourcePageUrl?: string;
            product?: CapturedProduct;
            changes?: Array<{ materialItemId?: string; price?: string; sourcePageUrl?: string }>;
          };
          const projectId = cleanUuid(body.projectId);
          if (!projectId) return json({ error: "Valid projectId required." }, 400);

          if (body.action === "approve") {
            let updated = 0;
            for (const change of body.changes ?? []) {
              const materialItemId = cleanUuid(change.materialItemId);
              const price = cleanPrice(change.price);
              if (!materialItemId || !price) continue;
              const material = await loadMaterial(projectId, materialItemId);
              if (!material) continue;
              if (
                !change.sourcePageUrl ||
                canonicalProductUrl(change.sourcePageUrl) !==
                  canonicalProductUrl(material.product_url ?? "")
              ) {
                continue;
              }
              const product = await findOrCreateProduct(material, {}, price);
              await supabaseAdmin.from("products").update({ price }).eq("id", product.id);
              updated += 1;
            }
            return json({ ok: true, updated });
          }

          const materialItemId = cleanUuid(body.materialItemId);
          if (!materialItemId) return json({ error: "Valid materialItemId required." }, 400);
          const material = await loadMaterial(projectId, materialItemId);
          if (!material) return json({ error: "Material item was not found." }, 404);
          const sourcePageUrl = cleanText(body.sourcePageUrl);
          if (
            !sourcePageUrl ||
            canonicalProductUrl(sourcePageUrl) !== canonicalProductUrl(material.product_url ?? "")
          ) {
            return json(
              { error: "This product page does not match the selected material link." },
              400,
            );
          }
          const captured = body.product ?? {};
          const price = cleanPrice(captured.price);
          if (!price) {
            await supabaseAdmin
              .from("material_items")
              .update({
                scrape_status: "price_missing",
                scrape_error: "No reliable price was found on the live product page.",
              })
              .eq("id", materialItemId);
            return json({ ok: true, status: "unresolved" });
          }

          const product = await findOrCreateProduct(material, captured, price);
          const currentPrice = cleanText(product.price);
          const mode =
            body.mode === "verify" ? "verify" : body.mode === "current" ? "current" : "missing";
          if (mode === "verify" && currentPrice && currentPrice !== price) {
            return json({
              ok: true,
              status: "changed",
              productId: product.id,
              currentPrice,
              livePrice: price,
            });
          }
          if (!currentPrice || mode === "current") {
            await supabaseAdmin.from("products").update({ price }).eq("id", product.id);
          }
          await supabaseAdmin
            .from("material_items")
            .update({ scrape_status: "scraped", scrape_error: null })
            .eq("id", materialItemId);
          return json({
            ok: true,
            status: currentPrice === price ? "match" : "saved",
            productId: product.id,
            price,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not update price.";
          console.error("[Extension Prices] Update failed", error);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
