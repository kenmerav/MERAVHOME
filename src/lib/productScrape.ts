export type ScrapedProductData = {
  name?: string;
  vendor?: string;
  sku?: string;
  finish?: string;
  dimensions?: string;
  price?: string;
  image_url?: string;
};

type ScrapeErrorPayload = {
  error?: string;
  upstreamStatus?: number;
  retryable?: boolean;
  retryAfterMs?: number;
};

export type ProductScrapeOptions = {
  maxAttempts?: number;
  retryDelayMs?: number;
  authorization?: string;
  projectId?: string;
  roomId?: string;
};

export type ProductBatchResult = {
  url: string;
  product?: ScrapedProductData;
  error?: string;
};

export type ProductBatchProgress = {
  completed: number;
  total: number;
  status: string;
};

export type ProductBatchOptions = {
  pollIntervalMs?: number;
  maxWaitMs?: number;
  onProgress?: (progress: ProductBatchProgress) => void;
  authorization?: string;
  projectId?: string;
  roomId?: string;
};

export class ProductScrapeError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "ProductScrapeError";
    this.status = status;
    this.retryable = retryable;
  }
}

const scrapeCache = new Map<string, ScrapedProductData>();

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterFromResponse(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function cacheScrapedProduct(url: string, product: ScrapedProductData) {
  scrapeCache.set(url.trim(), product);
}

export async function scrapeProductUrlsBatch(
  urls: string[],
  request: typeof fetch = fetch,
  options: ProductBatchOptions = {},
): Promise<ProductBatchResult[]> {
  const normalizedUrls = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean)));
  const cachedResults: ProductBatchResult[] = [];
  const uncachedUrls = normalizedUrls.filter((url) => {
    const cached = scrapeCache.get(url);
    if (cached) cachedResults.push({ url, product: cached });
    return !cached;
  });
  if (!uncachedUrls.length) {
    options.onProgress?.({
      completed: cachedResults.length,
      total: normalizedUrls.length,
      status: "completed",
    });
    return cachedResults;
  }

  const createResponse = await request("/api/scrape-products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    body: JSON.stringify({
      urls: uncachedUrls,
      projectId: options.projectId,
      roomId: options.roomId,
    }),
  });
  const created = (await createResponse.json()) as { id?: string; error?: string };
  if (!createResponse.ok || !created.id) {
    throw new ProductScrapeError(
      created.error || `Could not start product gathering (${createResponse.status}).`,
      createResponse.status,
      createResponse.status === 429 || createResponse.status >= 500,
    );
  }

  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 1500);
  const maxWaitMs = Math.max(1000, options.maxWaitMs ?? 10 * 60 * 1000);
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const statusUrl = new URL("/api/scrape-products", "http://studio.local");
    statusUrl.searchParams.set("id", created.id);
    if (options.projectId) statusUrl.searchParams.set("projectId", options.projectId);
    if (options.roomId) statusUrl.searchParams.set("roomId", options.roomId);
    const statusResponse = await request(`${statusUrl.pathname}${statusUrl.search}`, {
      headers: options.authorization ? { Authorization: options.authorization } : undefined,
    });
    const status = (await statusResponse.json()) as {
      status?: string;
      total?: number;
      completed?: number;
      results?: ProductBatchResult[];
      error?: string;
    };
    if (!statusResponse.ok) {
      if (statusResponse.status === 429 || statusResponse.status >= 500) {
        await wait(retryAfterFromResponse(statusResponse) ?? pollIntervalMs * 2);
        continue;
      }
      throw new ProductScrapeError(
        status.error || `Could not check product gathering (${statusResponse.status}).`,
        statusResponse.status,
      );
    }

    const completed = Math.min(uncachedUrls.length, Math.max(0, Number(status.completed) || 0));
    options.onProgress?.({
      completed: cachedResults.length + completed,
      total: normalizedUrls.length,
      status: status.status ?? "scraping",
    });

    if (status.status === "completed") {
      const returnedResults = status.results ?? [];
      const resultByUrl = new Map(returnedResults.map((result) => [result.url, result]));
      const ordered = uncachedUrls.map((url, index) => {
        const result = resultByUrl.get(url) ?? returnedResults[index];
        if (!result) return { url, error: "Firecrawl did not return this product." };
        const normalized = { ...result, url };
        if (normalized.product) cacheScrapedProduct(url, normalized.product);
        return normalized;
      });
      return [...cachedResults, ...ordered];
    }

    if (["failed", "cancelled"].includes(status.status ?? "")) {
      throw new ProductScrapeError(status.error || "The product gathering batch stopped early.");
    }
    await wait(pollIntervalMs);
  }

  throw new ProductScrapeError(
    "Product gathering is still queued. Please retry the remaining items.",
  );
}

function defaultRetryDelay(status: number | undefined, attempt: number, baseDelay: number) {
  const multiplier = status === 429 ? 4 : 1;
  return baseDelay * multiplier * 2 ** Math.max(0, attempt - 1);
}

export async function scrapeProductUrl(
  url: string,
  request: typeof fetch = fetch,
  options: ProductScrapeOptions = {},
): Promise<ScrapedProductData> {
  const normalizedUrl = url.trim();
  const cached = scrapeCache.get(normalizedUrl);
  if (cached) return cached;

  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 4000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await request("/api/scrape-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.authorization ? { Authorization: options.authorization } : {}),
      },
      body: JSON.stringify({
        url: normalizedUrl,
        projectId: options.projectId,
        roomId: options.roomId,
      }),
    });
    const result = (await response.json()) as ScrapedProductData & ScrapeErrorPayload;
    if (response.ok && !result.error) {
      scrapeCache.set(normalizedUrl, result);
      return result;
    }

    const status = result.upstreamStatus ?? response.status;
    const retryable =
      (result.retryable ?? status === 408) || status === 429 || (status >= 500 && status <= 599);
    if (!retryable || attempt === maxAttempts) {
      throw new ProductScrapeError(result.error || `Scrape failed (${status}).`, status, retryable);
    }

    await wait(result.retryAfterMs ?? defaultRetryDelay(status, attempt, retryDelayMs));
  }

  throw new ProductScrapeError("Product page could not be scraped.");
}

export function scrapedProductStatus(result: ScrapedProductData): "complete" | "partial" {
  return result.name && result.image_url ? "complete" : "partial";
}

export function productScrapeReviewMessage(
  url: string,
  category: string,
  result: ScrapedProductData,
) {
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return "Use a valid product page URL.";
  }
  if (/\/collections?\//.test(pathname)) {
    return "This is a collection page. Use the exact product page so Studio selects the intended item.";
  }

  const categoryName = category.toLowerCase();
  const productName = (result.name ?? "").toLowerCase();
  const expectedType =
    categoryName.includes("sconce") || categoryName.includes("lighting")
      ? /light|sconce|chandelier|pendant|lantern|lamp|fixture/
      : categoryName.includes("mirror")
        ? /mirror/
        : categoryName.includes("toilet")
          ? /toilet/
          : categoryName.includes("faucet")
            ? /faucet/
            : categoryName.includes("drain")
              ? /drain/
              : categoryName.includes("shower system")
                ? /shower/
                : categoryName.includes("freestanding tub") || categoryName.includes("tub filler")
                  ? /tub|bath/
                  : categoryName.includes("sink")
                    ? /sink/
                    : categoryName.includes("switch") || categoryName.includes("outlet")
                      ? /switch|toggle|dimmer|outlet|plate/
                      : categoryName.includes("door hardware")
                        ? /door|knob|lever|lock|handle/
                        : undefined;

  if (expectedType && productName && !expectedType.test(productName)) {
    return `The linked page returned “${result.name},” which does not appear to match ${category}. Check whether the retailer redirected the URL.`;
  }
  return "";
}

export function clearProductScrapeCache() {
  scrapeCache.clear();
}
