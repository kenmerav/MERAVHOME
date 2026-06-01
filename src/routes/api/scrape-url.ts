import { createFileRoute } from "@tanstack/react-router";

const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
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
              image_url: { type: "string", description: "Absolute URL of the primary product image" },
            },
          };

          const res = await fetch(FIRECRAWL_API, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${fcKey}`,
            },
            body: JSON.stringify({
              url,
              formats: [
                {
                  type: "json",
                  schema,
                  prompt: "Extract product details from this page. If the URL or page has a selected color, selected swatch, finish, or variant already chosen, capture that exact selected value. Do not invent a color when only a list of options is visible.",
                },
              ],
              onlyMainContent: true,
            }),
          });

          if (!res.ok) {
            const txt = await res.text();
            console.error("Firecrawl scrape failed", res.status, txt.slice(0, 500));
            return json({ error: `Scrape failed (${res.status}). You can still enter the details manually.` });
          }
          const body = (await res.json()) as any;
          const data = body?.data ?? body;
          const extracted = data?.json ?? data?.extract ?? {};
          const metadata = data?.metadata ?? {};

          const result = {
            name: firstString(extracted.name, metadata.title, metadata.ogTitle),
            vendor: firstString(extracted.vendor, metadata.ogSiteName, metadata["og:site_name"]),
            sku: firstString(extracted.sku, extracted.model, extracted.model_number),
            finish: firstString(extracted.finish, extracted.color, extracted.selected_color, extracted.selected_variant, extracted.variant),
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
