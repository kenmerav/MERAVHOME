import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  missingProductSpecifications,
  normalizeFirecrawlProduct,
} from "../src/lib/firecrawlProduct";

const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const state: {
        table: string;
        op: string;
        filters: unknown[][];
        fields?: unknown;
        write?: unknown;
      } = { table, op: "select", filters: [] };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "not", "maybeSingle", "single", "update", "insert"])
        chain[method] = (...args: unknown[]) => {
          if (["eq", "not"].includes(method)) state.filters.push([method, ...args]);
          if (method === "select") state.fields = args[0];
          if (["update", "insert"].includes(method)) {
            state.op = method;
            state.write = args[0];
          }
          return chain;
        };
      chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(mock.query(state)).then(resolve, reject);
      return chain;
    },
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
import { Route } from "../src/routes/api/scrape-materials";
type Handler = (context: { request: Request }) => Promise<Response>;
const handlers = (
  Route.options as unknown as { server: { handlers: { POST: Handler; PUT: Handler } } }
).server.handlers;
const project = "11111111-1111-4111-8111-111111111111";
const item = "22222222-2222-4222-8222-222222222222";
const product = "33333333-3333-4333-8333-333333333333";
const url = "https://shop.example.com/products/sconce?variant=123";
function request(method: string, body: unknown) {
  return new Request("https://studio.example/api/scrape-materials", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FIRECRAWL_API_KEY", "test-only");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("source-grounded product specifications", () => {
  it("keeps finish and color separate and preserves labeled dimensions and units", () => {
    const result = normalizeFirecrawlProduct(
      {
        json: {
          finish: "Matte",
          color: "White",
          dimensions: "Width: 12 in; Height: 18 in; Depth: 5 in",
        },
      },
      url,
    );
    expect(result).toMatchObject({
      finish: "Matte",
      color: "White",
      dimensions: "Width: 12 in; Height: 18 in; Depth: 5 in",
    });
  });
  it("prefers selected options and does not use a size-only variant as a color or finish", () => {
    expect(
      normalizeFirecrawlProduct(
        {
          json: {
            color: "Black",
            selected_color: "White",
            finish: "Gloss",
            selected_finish: "Matte",
          },
        },
        url,
      ),
    ).toMatchObject({ color: "White", finish: "Matte" });
    expect(normalizeFirecrawlProduct({ json: { selected_variant: "Large" } }, url)).toMatchObject({
      color: "",
      finish: "",
      dimensions: "",
    });
    expect(missingProductSpecifications({ finish: " ", color: "Blue" })).toEqual([
      "finish",
      "dimensions",
    ]);
  });
});

describe("material metadata enrichment", () => {
  it("scrapes priced items with missing specs and does not stop at a direct Shopify price", async () => {
    mock.query.mockResolvedValue({
      data: [
        {
          id: item,
          category: "Lighting",
          product_url: url,
          product_id: product,
          color: null,
          product: { id: product, price: "100", finish: null, dimensions: null },
        },
      ],
      error: null,
    });
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) =>
      input.includes(".js")
        ? new Response(
            JSON.stringify({
              title: "Sconce",
              options: ["Color", "Finish"],
              variants: [{ id: 123, price: 10000, options: ["White", "Matte"] }],
            }),
            { headers: { "Content-Type": "application/json" } },
          )
        : new Response(JSON.stringify({ id: "batch-specs" }), {
            headers: { "Content-Type": "application/json" },
          }),
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await handlers.POST({
      request: request("POST", { project_id: project, action: "start" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("started");
    expect(body.candidates[0].material_item_id).toBe(item);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/batch/scrape",
      expect.objectContaining({ method: "POST" }),
    );
    const extraction = JSON.parse(fetcher.mock.calls[1][1].body).formats[2];
    expect(extraction.prompt).toContain("dimensions");
    expect(extraction.schema.properties.dimensions.description).toContain("units");
  });
  it("skips items with complete specs and respects excluded items within a scrape run", async () => {
    mock.query.mockResolvedValue({
      data: [
        {
          id: item,
          category: "Lighting",
          product_url: url,
          color: "White",
          product: { id: product, price: "100", finish: "Matte", dimensions: "12 in W" },
        },
        {
          id: product,
          category: "Lighting",
          product_url: url,
          color: null,
          product: { price: "100" },
        },
      ],
      error: null,
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await handlers.POST({
      request: request("POST", { project_id: project, exclude_material_item_ids: [product] }),
    });
    expect((await response.json()).rows).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fills missing finish, color and dimensions through their saved fields without replacing manual values", async () => {
    mock.query.mockImplementation((q) => {
      if (q.op === "update") return { error: null };
      if (q.table === "material_items")
        return { data: { id: item, category: "Lighting", color: null, room_id: null } };
      if (q.table === "products")
        return {
          data: { id: product, name: "Edited name", finish: null, dimensions: null, price: "125" },
        };
      return { data: null };
    });
    const response = await handlers.PUT({
      request: request("PUT", {
        rows: [
          {
            material_item_id: item,
            existing_product_id: product,
            url,
            scraped: {
              name: "Retailer name",
              finish: "Matte",
              color: "White",
              dimensions: "12 in W × 18 in H",
              price: "$100",
            },
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const writes = mock.query.mock.calls.map(([q]) => q).filter((q) => q.op === "update");
    expect(writes.find((q) => q.table === "products").write).toMatchObject({
      finish: "Matte",
      dimensions: "12 in W × 18 in H",
    });
    expect(writes.find((q) => q.table === "products").write).not.toHaveProperty("name");
    expect(writes.find((q) => q.table === "products").write).not.toHaveProperty("price");
    expect(writes.find((q) => q.table === "material_items").write.color).toBe("White");
  });
  it("preserves existing manual finish, dimensions and color", async () => {
    mock.query.mockImplementation((q) => {
      if (q.op === "update") return { error: null };
      if (q.table === "material_items")
        return { data: { id: item, category: "Lighting", color: "Cream", room_id: null } };
      if (q.table === "products")
        return {
          data: {
            id: product,
            finish: "Brushed",
            dimensions: "20 in H",
            price: "125",
            name: "Sconce",
            category: "Lighting",
            product_url: url,
          },
        };
      return { data: null };
    });
    await handlers.PUT({
      request: request("PUT", {
        rows: [
          {
            material_item_id: item,
            existing_product_id: product,
            url,
            scraped: { finish: "Matte", color: "White", dimensions: "18 in H", price: "$100" },
          },
        ],
      }),
    });
    const writes = mock.query.mock.calls.map(([q]) => q).filter((q) => q.op === "update");
    expect(writes.find((q) => q.table === "material_items").write).not.toHaveProperty("color");
    for (const write of writes.filter((q) => q.table === "products")) {
      expect(write.write).not.toHaveProperty("finish");
      expect(write.write).not.toHaveProperty("dimensions");
    }
  });
});
