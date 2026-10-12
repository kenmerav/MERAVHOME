import { createFileRoute } from "@tanstack/react-router";
import { requireRoomDesignPilotAccess } from "@/lib/roomDesignAuth.server";
import { FIRECRAWL_PRODUCT_SCHEMA, FIRECRAWL_PRODUCT_PROMPT, normalizeFirecrawlProduct } from "@/lib/firecrawlProduct";

const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const SCRAPE_TIMEOUT_MS = 15000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/scrape-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { url, projectId, roomId } = (await request.json()) as {
            url?: string;
            projectId?: string;
            roomId?: string;
          };
          if (projectId || roomId) {
            if (!projectId || !roomId) {
              return json({ error: "projectId and roomId are required together." }, 400);
            }
            const access = await requireRoomDesignPilotAccess(request, { projectId, roomId });
            if ("error" in access) return access.error;
          }
          if (!url || !/^https?:\/\//.test(url)) {
            return json({ error: "Enter a valid product URL first." }, 400);
          }
          const fcKey = process.env.FIRECRAWL_API_KEY;
          if (!fcKey) {
            return json({ error: "Firecrawl is not connected yet." });
          }

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
                  schema: FIRECRAWL_PRODUCT_SCHEMA,
                  prompt: FIRECRAWL_PRODUCT_PROMPT,
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
          return json(normalizeFirecrawlProduct(data, url));
        } catch (e: any) {
          console.error("Unexpected scrape error", e);
          return json({ error: "Scrape failed. You can still enter the details manually." });
        }
      },
    },
  },
});
