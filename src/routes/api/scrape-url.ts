import { createFileRoute } from "@tanstack/react-router";
import { inferVendorFromUrl } from "@/lib/vendorInference";

const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const SCRAPE_TIMEOUT_MS = 15000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
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

    const match = text.match(/\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?(?:\s*(?:-|–|to)\s*\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?)?|\$?\s*\d+(?:\.\d{2})?/);
    if (!match) continue;

    const cleaned = match[0]
      .replace(/\s+/g, "")
      .replace(/–|to/i, "-");
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

export const Route = createFileRoute("/api/scrape-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { url } = (await request.json()) as { url?: string };
          if (!url || !/^https?:\/\//.test(url)) {
            return json({ error: "Enter a valid product URL first." }, 400);
          }
          const fcKey = process.env.FIRECRAWL_API_KEY;
          if (!fcKey) {
            return json({ error: "Firecrawl is not connected yet." });
          }

          const schema = {
            type: "object",
            properties: {
              name: { type: "string", description: "Product or material name" },
              vendor: { type: "string", description: "Brand or manufacturer" },
              sku: { type: "string", description: "SKU, model number, or product code" },
              color: { type: "string", description: "Selected color, selected swatch, or colorway for this exact product URL" },
              selected_color: { type: "string", description: "Selected color option when the page shows one" },
              finish: { type: "string", description: "Finish, color, or material variant" },
              selected_variant: { type: "string", description: "Selected variant or option when the page shows one" },
              price: { type: "string", description: "Exact customer-visible price for the selected product variant. If no exact selected variant price is visible, use the product price range." },
              current_price: { type: "string" },
              sale_price: { type: "string" },
              regular_price: { type: "string" },
              list_price: { type: "string" },
              price_per_item: { type: "string" },
              image_url: { type: "string", description: "Absolute URL of the primary product image" },
            },
          };

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
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
                  schema,
                  prompt: "Extract product details from this page. If the URL or page has a selected color, selected swatch, finish, or variant already chosen, capture that exact selected value. Capture the exact customer-visible price for that selected variant. If no exact variant price is visible, capture the product price range. Do not invent a color or price.",
                },
              ],
              onlyMainContent: false,
              timeout: SCRAPE_TIMEOUT_MS,
            }),
          });
          clearTimeout(timeout);

          if (!res.ok) {
            const txt = await res.text();
            console.error("Firecrawl scrape failed", res.status, txt.slice(0, 500));
            return json({ error: `Scrape failed (${res.status}). You can still enter the details manually.` });
          }
          const body = (await res.json()) as any;
          const data = body?.data ?? body;
          const extracted = data?.json ?? data?.extract ?? {};
          const metadata = data?.metadata ?? {};
          const pagePrice = priceFromPageText(data?.markdown, data?.html);

          const result = {
            name: firstString(extracted.name, metadata.title, metadata.ogTitle),
            vendor: firstString(extracted.vendor, metadata.ogSiteName, metadata["og:site_name"], inferVendorFromUrl(url)),
            sku: firstString(extracted.sku, extracted.model, extracted.model_number),
            finish: firstString(extracted.finish, extracted.color, extracted.selected_color, extracted.selected_variant, extracted.variant),
            price: firstPrice(
              extracted.price,
              extracted.current_price,
              extracted.sale_price,
              extracted.regular_price,
              extracted.list_price,
              extracted.price_per_item,
              pagePrice,
            ),
            image_url: firstString(extracted.image_url, extracted.image, metadata.ogImage, metadata["og:image"]),
          };

          return json(result);
        } catch (e: any) {
          console.error("Unexpected scrape error", e);
          return json({ error: "Scrape failed. You can still enter the details manually." });
        }
      },
    },
  },
});
