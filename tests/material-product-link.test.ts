import { afterEach, beforeEach, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: session } }));
import { saveAndScrapeMaterialLink } from "@/lib/materialProductLink";
const projectId = "11111111-1111-4111-8111-111111111111", itemId = "22222222-2222-4222-8222-222222222222";
const productUrl = "https://shop.example.com/faucet?uid=123";
const input = { projectId, roomId: "room", label: "Faucet", productUrl };
beforeEach(() => { vi.clearAllMocks(); session.getSession.mockResolvedValue({ data: { session: { access_token: "TEST_ONLY", user: { id: "staff" } } } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("saves a link, automatically scrapes only that item, then saves all four product fields", async () => {
  const details = { image_url: "https://cdn.example/image.jpg", price: "$125", dimensions: "12 in", color: "Brass" };
  const calls: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: any) => {
    const body = JSON.parse(options.body); calls.push({ url, method: options.method, body });
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer TEST_ONLY");
    if (body.action === "link") return Response.json({ item_id: itemId });
    if (body.action === "start") return Response.json({ status: "completed", rows: [{ material_item_id: itemId, url: productUrl, scraped: details }], remaining_count: 0 });
    return Response.json({ ok: true, price_missing_count: 0 });
  }));
  expect(await saveAndScrapeMaterialLink(input)).toEqual({ itemId, warning: null });
  expect(calls.map(call => call.body.action || call.method)).toEqual(["link", "start", "PUT"]);
  expect(calls[1].body).toMatchObject({ project_id: projectId, material_item_ids: [itemId], force: true });
  expect(calls[2].body).toMatchObject({ project_id: projectId, rows: [{ scraped: details }] });
});
it("keeps the saved link and explains a retailer failure without retrying the material insert", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ item_id: itemId })).mockResolvedValueOnce(Response.json({ status: "completed", rows: [{ material_item_id: itemId, scraped: { error: "Blocked" } }] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await saveAndScrapeMaterialLink(input)).toMatchObject({ itemId, warning: expect.stringContaining("Link saved") });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("stops before scraping if the link could not be saved", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Selection changed" }, { status: 409 })); vi.stubGlobal("fetch", fetcher);
  await expect(saveAndScrapeMaterialLink(input)).rejects.toThrow("Selection changed"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("validates links before accessing the session or starting a scrape", async () => {
  await expect(saveAndScrapeMaterialLink({ ...input, productUrl: "javascript:alert(1)" })).rejects.toThrow("valid product link");
  expect(session.getSession).not.toHaveBeenCalled();
});
it("completes a missing-item review only after its product details are saved", async () => {
  const actions: string[] = [];
  const issue: any = { key: "a".repeat(64), status_updated_at: null, finding: { field: "missing_item" } };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: any) => {
    const body = JSON.parse(options.body); actions.push(body.action || options.method);
    if (body.action === "link") return Response.json({ item_id: itemId });
    if (body.action === "start") return Response.json({ status: "completed", rows: [{ material_item_id: itemId, url: productUrl, scraped: { price: "$125" } }] });
    if (body.action === "status") return Response.json({ issues: [] });
    return Response.json({ ok: true });
  }));
  await saveAndScrapeMaterialLink({ ...input, issue });
  expect(actions).toEqual(["link", "start", "PUT", "status"]);
});
