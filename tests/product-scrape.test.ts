import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProductScrapeCache,
  productScrapeReviewMessage,
  scrapedProductStatus,
  scrapeProductUrl,
  scrapeProductUrlsBatch,
} from "@/lib/productScrape";

describe("product scraper client", () => {
  afterEach(() => clearProductScrapeCache());

  it("returns and caches scraped product details", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            name: "Thin Metal Frame Mirror",
            vendor: "Rejuvenation",
            finish: "Aged brass",
            price: "$699",
            image_url: "https://images.example.com/mirror.jpg",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const first = await scrapeProductUrl("https://example.com/mirror", request);
    const second = await scrapeProductUrl("https://example.com/mirror", request);

    expect(first).toEqual(second);
    expect(request).toHaveBeenCalledTimes(1);
    expect(scrapedProductStatus(first)).toBe("complete");
  });

  it("surfaces scraper errors for per-item review", async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Vendor blocked the scrape." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await expect(scrapeProductUrl("https://example.com/blocked", request)).rejects.toThrow(
      "Vendor blocked the scrape.",
    );
  });

  it("retries a rate-limited scrape and caches the successful result", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "Scrape failed (429).",
            upstreamStatus: 429,
            retryable: true,
            retryAfterMs: 0,
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "Aged Brass Sconce",
            vendor: "Perigold",
            image_url: "https://images.example.com/sconce.jpg",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as unknown as typeof fetch;

    const first = await scrapeProductUrl("https://example.com/sconce", request, {
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    const second = await scrapeProductUrl("https://example.com/sconce", request);

    expect(first.name).toBe("Aged Brass Sconce");
    expect(second).toEqual(first);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("marks missing images as partial", () => {
    expect(scrapedProductStatus({ name: "Known product", vendor: "Vendor" })).toBe("partial");
  });

  it("flags collection pages and retailer redirects for review", () => {
    expect(
      productScrapeReviewMessage("https://shop.example.com/collections/bathroom", "Vanity layout", {
        name: "Coffee Table",
        image_url: "https://images.example.com/table.jpg",
      }),
    ).toContain("collection page");
    expect(
      productScrapeReviewMessage(
        "https://shop.example.com/products/capiz-chandelier",
        "Decorative ceiling lighting",
        { name: "Ashford Swivel Chair", image_url: "https://images.example.com/chair.jpg" },
      ),
    ).toContain("does not appear to match");
    expect(
      productScrapeReviewMessage(
        "https://shop.example.com/products/capiz-chandelier",
        "Decorative ceiling lighting",
        { name: "Capiz Tiered Chandelier", image_url: "https://images.example.com/light.jpg" },
      ),
    ).toBe("");
  });

  it("starts and polls a queued product batch", async () => {
    const progress = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "batch-123456", total: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "scraping", total: 2, completed: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "completed",
            total: 2,
            completed: 2,
            results: [
              {
                url: "https://example.com/mirror",
                product: {
                  name: "Metal Mirror",
                  image_url: "https://images.example.com/mirror.jpg",
                },
              },
              {
                url: "https://example.com/sconce",
                product: {
                  name: "Brass Sconce",
                  image_url: "https://images.example.com/sconce.jpg",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as unknown as typeof fetch;

    const results = await scrapeProductUrlsBatch(
      ["https://example.com/mirror", "https://example.com/sconce"],
      request,
      { pollIntervalMs: 0, onProgress: progress },
    );

    expect(results.map((result) => result.product?.name)).toEqual(["Metal Mirror", "Brass Sconce"]);
    expect(progress).toHaveBeenLastCalledWith({ completed: 2, total: 2, status: "completed" });
    expect(request).toHaveBeenCalledTimes(3);
  });
});
