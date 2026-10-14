import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  missingProductSpecifications,
  firecrawlItemError,
  normalizeFirecrawlProduct,
} from "../src/lib/firecrawlProduct";

const mock = vi.hoisted(() => ({ query: vi.fn(), denied: null as Response | null, currentUrl: "" }));
vi.mock("@/lib/specCompletion.server", () => ({ authorizeCompletionProject: async (request: Request) => mock.denied ?? {
  projectId: "11111111-1111-4111-8111-111111111111", body: await request.json(), userId: "staff",
} }));
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
        Promise.resolve(mock.query(state)).then(result => {
          // Existing specification fixtures use one current material/variant.
          if (state.table === "material_items" && state.op === "select" && result?.data && !Array.isArray(result.data)) result = { ...result, data: {
            project_id: "11111111-1111-4111-8111-111111111111", product_id: "33333333-3333-4333-8333-333333333333", product_url: mock.currentUrl,
            updated_at: "2026-10-14T20:00:00Z", ...result.data,
          } };
          if (state.op === "update" && !result?.error && !result?.data) result = { ...result, data: { id: "22222222-2222-4222-8222-222222222222" } };
          return resolve(result);
        }, reject);
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
  mock.currentUrl = (body as any)?.rows?.[0]?.url || url;
  return new Request("https://studio.example/api/scrape-materials", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.denied = null;
  vi.stubEnv("FIRECRAWL_API_KEY", "test-only");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("source-grounded product specifications", () => {
  it("denies unauthenticated scraping and saves before accessing material rows", async () => {
    mock.denied = Response.json({ error: "Sign in" }, { status: 401 });
    expect((await handlers.POST({ request: request("POST", { project_id: project }) })).status).toBe(401);
    expect((await handlers.PUT({ request: request("PUT", { project_id: project, rows: [] }) })).status).toBe(401);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("does not attach an older scrape when the material link changed in the meantime", async () => {
    mock.query.mockResolvedValue({ data: { id: item, product_url: "https://retailer.test/new-link" } });
    expect((await handlers.PUT({ request: request("PUT", { project_id: project, rows: [{ material_item_id: item, existing_product_id: product, url, scraped: { image_url: "https://cdn.test/image.jpg", price: "$99" } }] }) })).status).toBe(409);
    expect(mock.query.mock.calls.every(([q]) => q.op === "select")).toBe(true);
  });
  it("saves a new image and uses the finish as color when the retailer has no separate color field", async () => {
    mock.query.mockImplementation(q => q.op === "update" ? { error: null } : q.table === "material_items" ? { data: { id: item, room_id: null, color: null, image_url: null } } : { data: { id: product } });
    expect((await handlers.PUT({ request: request("PUT", { project_id: project, rows: [{ material_item_id: item, existing_product_id: product, url, scraped: { image_url: "https://cdn.test/image.jpg", price: "$99", finish: "Polished Nickel", dimensions: "20 in" } }] }) })).status).toBe(200);
    const write = mock.query.mock.calls.map(([q]) => q).find(q => q.op === "update" && q.table === "material_items");
    expect(write.write).toMatchObject({ color: "Polished Nickel", image_url: "https://cdn.test/image.jpg" });
    expect(write.filters).toContainEqual(["eq", "project_id", project]);
    expect(write.filters).toContainEqual(["eq", "product_url", url]);
    expect(write.filters).toContainEqual(["eq", "updated_at", "2026-10-14T20:00:00Z"]);
  });
  it("fills catalog placeholders while retaining confirmed dimensions, finish, price and images", async () => {
    mock.query.mockImplementation(q => q.op === "update" ? { error: null } : q.table === "material_items" ? { data: { id: item, room_id: null, color: "TBD", image_url: "https://cdn.test/manual.jpg" } } : { data: { id: product, name: "Sconce", price: "$100", dimensions: "TBD", finish: "Brushed Brass", image_url: "https://cdn.test/catalog.jpg" } });
    expect((await handlers.PUT({ request: request("PUT", { project_id: project, rows: [{ material_item_id: item, existing_product_id: product, url, scraped: { price: "$200", image_url: "https://cdn.test/scraped.jpg", dimensions: "12 in", finish: "Black", color: "Brass" } }] }) })).status).toBe(200);
    const writes = mock.query.mock.calls.map(([q]) => q).filter(q => q.op === "update");
    const productPatch = writes.find(q => q.table === "products").write;
    expect(productPatch.dimensions).toBe("12 in");
    for (const field of ["price", "finish", "image_url"]) expect(productPatch).not.toHaveProperty(field);
    const materialPatch = writes.find(q => q.table === "material_items").write;
    expect(materialPatch.color).toBe("Brass"); expect(materialPatch).not.toHaveProperty("image_url");
  });
  it("forces a fresh read for only the newly saved link even when its previous specs were complete", async () => {
    mock.query.mockResolvedValue({ data: [item, product].map(id => ({ id, category: "Lighting", product_url: url, color: "White", product: { id: product, price: "$100", finish: "White", dimensions: "12 in", image_url: "https://cdn.test/old.jpg" } })) });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "batch", data: {} })));
    const response = await handlers.POST({ request: request("POST", { project_id: project, action: "start", force: true, material_item_ids: [item] }) });
    expect(response.status).toBe(200);
    expect((await response.json()).candidates.map((row: any) => row.material_item_id)).toEqual([item]);
  });
  it("identifies clear selling units when extraction omits the unit field", () => {
    expect(normalizeFirecrawlProduct({ json: { name: "Kitchen Faucet", price: "$269.40" } }, "https://retailer.test/faucet"))
      .toMatchObject({ price: "$269.40", price_unit: "unit" });
    expect(normalizeFirecrawlProduct({ json: { name: "Marble Mosaic", price: "$18.74 / sheet" } }, "https://retailer.test/mosaic"))
      .toMatchObject({ price: "$18.74", price_unit: "unit" });
    expect(normalizeFirecrawlProduct({ json: { name: "Floor Tile", price: "$148.16" } }, "https://retailer.test/tile"))
      .toMatchObject({ price: "$148.16", price_unit: null });
  });
  it("rejects retailer error pages even when the scrape request succeeds", () => {
    expect(firecrawlItemError({ metadata: { title: "Rejuvenation | Error" } })).toContain("error or access-check");
    expect(firecrawlItemError({ metadata: { title: "Mirror", statusCode: 403 } })).toContain("HTTP 403");
    expect(firecrawlItemError({ metadata: { title: "Traditional Beveled Metal Frame Mirror", statusCode: 200 } })).toBe("");
  });
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
  it("keeps verified direct pricing when the rendered retailer page is an error page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => String(input).includes(".js")
      ? new Response(JSON.stringify({ title: "Mirror", variants: [{ id: 123, price: 38900 }] }), { headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify({ data: { metadata: { title: "Retailer | Error", statusCode: 403 } } }))));
    const response = await handlers.POST({ request: request("POST", { action: "fallback", project_id: project, candidates: [{ material_item_id: item, url, existing_product_id: product }] }) });
    const body = await response.json();
    expect(body.rows[0].scraped).toMatchObject({ name: "Mirror", price: "$389.00" });
    expect(body.rows[0].scraped.error).toBeUndefined();
  });
  it("keeps a direct selected-variant price when the follow-up scraper fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).includes(".js")
          ? new Response(
              JSON.stringify({ title: "Mirror", variants: [{ id: 123, price: 38900 }] }),
              { headers: { "Content-Type": "application/json" } },
            )
          : new Response("rate limited", { status: 429 }),
      ),
    );
    const response = await handlers.POST({
      request: request("POST", {
        action: "fallback",
        project_id: project,
        candidates: [{ material_item_id: item, url, existing_product_id: product }],
      }),
    });
    const body = await response.json();
    expect(body.rows[0].scraped.price).toBe("$389.00");
    expect(body.rows[0].scraped.error).toBeUndefined();
  });
  it("flags a variant range without saving it as an exact price and preserves notes", async () => {
    mock.query.mockImplementation((q) =>
      q.op === "update"
        ? { error: null }
        : q.table === "material_items"
          ? { data: { id: item, room_id: null, notes: "Designer note" } }
          : { data: { id: product, price: null } },
    );
    const response = await handlers.PUT({
      request: request("PUT", {
        rows: [
          {
            material_item_id: item,
            existing_product_id: product,
            url,
            scraped: { name: "Planter", price: "$149–$249" },
          },
        ],
      }),
    });
    expect(await response.json()).toMatchObject({ priced_count: 0, price_missing_count: 1 });
    const writes = mock.query.mock.calls.map(([q]) => q).filter((q) => q.op === "update");
    expect(writes.find((q) => q.table === "products").write).not.toHaveProperty("price");
    expect(writes.find((q) => q.table === "material_items").write).toMatchObject({
      scrape_status: "price_missing",
      scrape_error: expect.stringContaining("Retailer price range $149.00–$249.00"),
    });
    expect(writes.find((q) => q.table === "material_items").write).not.toHaveProperty("notes");
  });
  it("counts an existing manual price as priced even when enrichment has no price", async () => {
    mock.query.mockImplementation((q) =>
      q.op === "update"
        ? { error: null }
        : q.table === "material_items"
          ? { data: { id: item, room_id: null } }
          : { data: { id: product, price: "$1,675.00" } },
    );
    const response = await handlers.PUT({
      request: request("PUT", {
        rows: [
          {
            material_item_id: item,
            existing_product_id: product,
            url,
            scraped: { finish: "Matte" },
          },
        ],
      }),
    });
    expect(await response.json()).toMatchObject({ priced_count: 1, price_missing_count: 0 });
    const writes = mock.query.mock.calls.map(([q]) => q).filter((q) => q.op === "update");
    expect(writes.find((q) => q.table === "material_items").write).toMatchObject({
      scrape_status: "scraped",
      scrape_error: null,
    });
  });
  it.each([null, "$50-$60"])("does not flag an optional countertop price %s after saving useful product specs", async price => {
    mock.query.mockImplementation(q => q.op === "update" ? { error: null } : q.table === "material_items"
      ? { data: { id: item, room_id: null, item_label: "Countertop", category: "Countertops", notes: "Designer note" } }
      : { data: { id: product, name: "Quartz countertop", price: null } });
    const response = await handlers.PUT({ request: request("PUT", { rows: [{ material_item_id: item, existing_product_id: product,
      url: "https://vendor.test/quartz-countertops/white/", scraped: { name: "Quartz countertop", price, dimensions: "3cm", color: "White" } }] }) });
    expect(await response.json()).toMatchObject({ price_missing_count: 0 });
    const writes = mock.query.mock.calls.map(([q]) => q).filter(q => q.op === "update");
    expect(writes.find(q => q.table === "material_items").write).toMatchObject({ scrape_status: "scraped", scrape_error: null, color: "White" });
    expect(writes.find(q => q.table === "products").write.dimensions).toBe("3cm");
  });
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
    const extraction = JSON.parse(fetcher.mock.calls[1][1].body).formats.find((format: any) => format?.type === "json");
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
          product: { id: product, price: "100", finish: "Matte", dimensions: "12 in W", image_url: "https://cdn.test/image.jpg" },
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
  it("retries successful pages that omitted a price with fresh, slower rendering", async () => {
    const fetcher = vi.fn(async (input: string|URL, init?: RequestInit) => {
      if (String(input).includes('/batch/scrape/')) return new Response(JSON.stringify({status:'completed',completed:1,total:1,data:[{metadata:{sourceURL:'https://retailer.test/faucet'},json:{name:'Faucet',finish:'Brass'}}]}));
      const payload = JSON.parse(String(init?.body));
      expect(payload.maxAge).toBe(0);
      expect(payload.waitFor).toBe(6000);
      expect(payload.formats).toContain('rawHtml');
      return new Response(JSON.stringify({data:{json:{name:'Faucet',current_price:'$940.80',price_unit:'unit'}}}));
    });
    vi.stubGlobal('fetch',fetcher);
    const response=await handlers.POST({request:request('POST',{action:'poll',project_id:project,batch_id:'retry-test',candidates:[{material_item_id:item,url:'https://retailer.test/faucet',existing_product_id:product}]})});
    expect((await response.json()).rows[0].scraped).toMatchObject({price:'$940.80',price_unit:'unit',finish:'Brass'});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("shares the missing-price retry for duplicate product URLs", async () => {
    const source='https://retailer.test/faucet';
    const fetcher=vi.fn(async(input:string|URL)=>new Response(JSON.stringify(String(input).includes('/batch/scrape/')?{status:'completed',data:[{metadata:{sourceURL:source},json:{name:'Faucet'}}]}:{data:{json:{price:'$50'}}})));
    vi.stubGlobal('fetch',fetcher);
    const response=await handlers.POST({request:request('POST',{action:'poll',project_id:project,batch_id:'duplicates',candidates:[{material_item_id:item,url:source},{material_item_id:product,url:source}]})});
    expect((await response.json()).rows.map((row:any)=>row.scraped.price)).toEqual(['$50.00','$50.00']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("uses an exact rendered variant price instead of a direct product range", async () => {
    vi.stubGlobal('fetch',vi.fn(async(input:string|URL)=>String(input).includes('.js')?new Response(JSON.stringify({variants:[{id:1,price:10000},{id:2,price:20000}]}),{headers:{'Content-Type':'application/json'}}):new Response(JSON.stringify({data:{json:{price:'$150'}}}))));
    const response=await handlers.POST({request:request('POST',{action:'fallback',project_id:project,candidates:[{material_item_id:item,url:'https://retailer.test/products/mirror'}]})});
    expect((await response.json()).rows[0].scraped.price).toBe('$150.00');
  });
  it("retains useful first-pass details if the price retry fails", async () => {
    vi.stubGlobal('fetch',vi.fn(async(input:string|URL)=>String(input).includes('/batch/scrape/')?new Response(JSON.stringify({status:'completed',data:[{metadata:{sourceURL:'https://retailer.test/light'},json:{name:'Light',dimensions:'12 in'}}]})):new Response('Unavailable',{status:503})));
    const response=await handlers.POST({request:request('POST',{action:'poll',project_id:project,batch_id:'failed-retry',candidates:[{material_item_id:item,url:'https://retailer.test/light'}]})});
    expect((await response.json()).rows[0].scraped).toMatchObject({name:'Light',dimensions:'12 in'});
  });
  it("isolates a rejected batch and returns individually recovered prices instead of stopping the run", async () => {
    mock.query.mockResolvedValue({data:[{id:item,category:'Lighting',product_url:'https://retailer.test/light',product:{id:product,price:null}}],error:null});
    const fetcher=vi.fn(async(input:string|URL)=>String(input).endsWith('/batch/scrape')?new Response('Batch rejected',{status:400}):new Response(JSON.stringify({data:{json:{price:'$99',price_unit:'unit'}}})));
    vi.stubGlobal('fetch',fetcher);
    const response=await handlers.POST({request:request('POST',{action:'start',project_id:project})});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({status:'completed',rows:[{material_item_id:item,scraped:{price:'$99.00'}}]});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("saves the square-foot rate and basis together, without inventing an internal cost", async () => {
    mock.query.mockImplementation(q=>q.op==='update'?{error:null}:q.table==='material_items'?{data:{id:item,category:'Tile & Stone',room_id:null}}:{data:{id:product,price:null,unit_cost:null}});
    await handlers.PUT({request:request('PUT',{rows:[{material_item_id:item,existing_product_id:product,url,scraped:{price:'$8.50',price_unit:'sq_ft',unit_cost:'$148.16'}}]})});
    const write=mock.query.mock.calls.map(([q])=>q).find(q=>q.op==='update'&&q.table==='products').write;
    expect(write).toMatchObject({price:'$8.50',retail_price:'$8.50',price_unit:'sq_ft'});
    expect(write).not.toHaveProperty('unit_cost');
  });
  it("does not relabel an existing manual box price with a scraped square-foot basis", async () => {
    mock.query.mockImplementation(q=>q.op==='update'?{error:null}:q.table==='material_items'?{data:{id:item,category:'Tile & Stone',room_id:null}}:{data:{id:product,price:'$148.16',price_unit:'unit'}});
    await handlers.PUT({request:request('PUT',{rows:[{material_item_id:item,existing_product_id:product,url,scraped:{price:'$8.50',price_unit:'sq_ft'}}]})});
    for(const [q] of mock.query.mock.calls.filter(([q])=>q.op==='update'&&q.table==='products')) {
      expect(q.write).not.toHaveProperty('price'); expect(q.write).not.toHaveProperty('price_unit'); expect(q.write).not.toHaveProperty('retail_price');
    }
  });
});
