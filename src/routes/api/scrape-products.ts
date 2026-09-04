import { createFileRoute } from "@tanstack/react-router";
import {
  FIRECRAWL_PRODUCT_PROMPT,
  FIRECRAWL_PRODUCT_SCHEMA,
  firecrawlItemError,
  firecrawlSourceUrl,
  normalizeFirecrawlProduct,
  record,
} from "@/lib/firecrawlProduct";
import { requireRoomDesignPilotAccess } from "@/lib/roomDesignAuth.server";

const FIRECRAWL_BATCH_API = "https://api.firecrawl.dev/v2/batch/scrape";
const PAGE_TIMEOUT_MS = 120000;

function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function firecrawlKey() {
  return process.env.FIRECRAWL_API_KEY;
}

async function firecrawlRequest(url: string, init?: RequestInit) {
  const key = firecrawlKey();
  if (!key) return null;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

function forwardFirecrawlError(response: Response, body: string) {
  const retryAfter = response.headers.get("retry-after");
  console.error("Firecrawl batch failed", response.status, body.slice(0, 500));
  return json(
    {
      error: `Product gathering service returned ${response.status}.`,
      upstreamStatus: response.status,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    },
    response.status,
    retryAfter ? { "Retry-After": retryAfter } : undefined,
  );
}

export const Route = createFileRoute("/api/scrape-products")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const payload = (await request.json()) as {
          urls?: unknown;
          projectId?: string;
          roomId?: string;
        };
        if (!payload.projectId || !payload.roomId) {
          return json({ error: "projectId and roomId are required." }, 400);
        }
        const access = await requireRoomDesignPilotAccess(request, {
          projectId: payload.projectId,
          roomId: payload.roomId,
        });
        if ("error" in access) return access.error;
        const key = firecrawlKey();
        if (!key) return json({ error: "Firecrawl is not connected yet." }, 503);

        const urls = Array.isArray(payload.urls)
          ? payload.urls.filter(
              (url): url is string => typeof url === "string" && /^https?:\/\//.test(url),
            )
          : [];
        if (!urls.length) return json({ error: "Add at least one valid product URL." }, 400);
        if (urls.length > 100) return json({ error: "Gather up to 100 products at a time." }, 400);

        const response = await firecrawlRequest(FIRECRAWL_BATCH_API, {
          method: "POST",
          body: JSON.stringify({
            urls,
            maxConcurrency: 1,
            ignoreInvalidURLs: false,
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
            timeout: PAGE_TIMEOUT_MS,
            proxy: "auto",
            maxAge: 604800000,
            storeInCache: true,
          }),
        });
        if (!response) return json({ error: "Firecrawl is not connected yet." }, 503);
        const text = await response.text();
        if (!response.ok) return forwardFirecrawlError(response, text);
        const body = record(JSON.parse(text));
        return json({ id: body.id, status: "queued", total: urls.length });
      },

      GET: async ({ request }) => {
        const search = new URL(request.url).searchParams;
        const projectId = search.get("projectId");
        const roomId = search.get("roomId");
        if (!projectId || !roomId) {
          return json({ error: "projectId and roomId are required." }, 400);
        }
        const access = await requireRoomDesignPilotAccess(request, {
          projectId,
          roomId,
        });
        if ("error" in access) return access.error;
        if (!firecrawlKey()) return json({ error: "Firecrawl is not connected yet." }, 503);
        const id = search.get("id") ?? "";
        if (!/^[a-zA-Z0-9-]{8,100}$/.test(id)) return json({ error: "Invalid batch id." }, 400);

        const response = await firecrawlRequest(`${FIRECRAWL_BATCH_API}/${id}`);
        if (!response) return json({ error: "Firecrawl is not connected yet." }, 503);
        const text = await response.text();
        if (!response.ok) return forwardFirecrawlError(response, text);
        const body = record(JSON.parse(text));
        const data = Array.isArray(body.data) ? body.data : [];
        const results = data.map((item) => {
          const url = firecrawlSourceUrl(item);
          const error = firecrawlItemError(item);
          return {
            url,
            ...(error ? { error } : { product: normalizeFirecrawlProduct(item, url) }),
          };
        });

        return json({
          status: body.status,
          total: body.total,
          completed: body.completed,
          creditsUsed: body.creditsUsed,
          results,
        });
      },
    },
  },
});
