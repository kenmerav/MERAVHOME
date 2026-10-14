import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
import { missingCatalogProductInfo, refreshCatalogSelectionIfNeeded } from "@/lib/catalogProductRefresh";
const projectId = "11111111-1111-4111-8111-111111111111", itemId = "22222222-2222-4222-8222-222222222222", productId = "33333333-3333-4333-8333-333333333333";
const product: any = { id: productId, name: "Bathroom Faucet", category: "Plumbing", product_url: "https://retailer.test/faucet?uid=123", image_url: "https://cdn.test/faucet.jpg", price: "$125", dimensions: "Height: 12 in", finish: "Brushed Brass" };
beforeEach(() => { vi.clearAllMocks(); auth.getSession.mockResolvedValue({ data: { session: { access_token: "TEST_ONLY" } } }); });
afterEach(() => vi.unstubAllGlobals());
it("skips scraping entirely when the catalog product already has all four details", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await refreshCatalogSelectionIfNeeded({ projectId, itemId, product })).toBeNull();
  expect(auth.getSession).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it.each(["image_url", "price", "dimensions", "finish"])("automatically reads the selected item when its catalog %s is missing", async field => {
  const calls: any[] = [];
  const fetched = { image_url: "https://cdn.test/faucet.jpg", price: "$125", dimensions: "Height: 12 in", color: "Brass", finish: "Brushed Brass" };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: any) => {
    const body = JSON.parse(options.body); calls.push({ method: options.method, body });
    expect(options.headers.Authorization).toBe("Bearer TEST_ONLY");
    return Response.json(options.method === "POST" ? { status: "completed", remaining_count: 0, rows: [{ material_item_id: itemId, existing_product_id: productId, url: product.product_url, scraped: fetched }] } : { ok: true, price_missing_count: 0 });
  }));
  expect(await refreshCatalogSelectionIfNeeded({ projectId, itemId, product: { ...product, [field]: null } })).toBeNull();
  expect(calls[0].body).toMatchObject({ material_item_ids: [itemId], force: true });
  expect(calls[1].body).toMatchObject({ project_id: projectId, rows: [{ existing_product_id: productId, scraped: fetched }] });
  expect(calls).toHaveLength(2);
});
it("recognizes placeholders and a sheen without a color as missing information", () => {
  expect(missingCatalogProductInfo({ ...product, image_url: "TBD", price: "Call for price", dimensions: "Not specified", finish: "Matte" })).toEqual(["image", "price", "dimensions", "color"]);
});
it("uses a confirmed material color and selected product size", () => {
  expect(missingCatalogProductInfo({ ...product, finish: "Matte", dimensions: null, selected_size: "Large" }, { color: "White" })).toEqual([]);
});
it.each(["Countertops", "Paint", "Cabinetry"])("does not scrape %s solely for an optional blank price", async category => {
  const selected = { ...product, name: category, category, price: null };
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await refreshCatalogSelectionIfNeeded({ projectId, itemId, product: selected, material: { category, item_label: category } })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it("still gets missing cabinet-hardware prices", () => {
  expect(missingCatalogProductInfo({ ...product, name: "Cabinet Pull", category: "Hardware", price: null }, { category: "Cabinetry" })).toEqual(["price"]);
});
it("keeps the catalog choice when it has no link or the retailer rejects the scrape", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "completed", rows: [{ material_item_id: itemId, scraped: { error: "Blocked" } }] })); vi.stubGlobal("fetch", fetcher);
  expect(await refreshCatalogSelectionIfNeeded({ projectId, itemId, product: { ...product, price: null, product_url: null } })).toContain("selection saved");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await refreshCatalogSelectionIfNeeded({ projectId, itemId, product: { ...product, price: null } })).toContain("selection saved");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
