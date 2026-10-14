import { beforeEach, expect, it, vi } from "vitest";
const projectId = "11111111-1111-4111-8111-111111111111", roomId = "22222222-2222-4222-8222-222222222222", itemId = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({ denied: null as Response | null, items: [] as any[], room: null as any, issues: null as any, writes: [] as any[], reads: [] as any[], conflict: false }));
vi.mock("@/lib/specCompletion.server", () => ({ authorizeCompletionProject: async (request: Request) => state.denied ?? { projectId: "11111111-1111-4111-8111-111111111111", userId: "staff", body: await request.json() } }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => {
  const filters: any = {}; let patch: any = null;
  const run = () => {
    state.reads.push({ table, filters });
    if (patch) { state.writes.push({ table, filters, ...patch }); return { data: state.conflict ? null : { id: itemId }, error: null }; }
    if (table === "rooms") return { data: filters.id ? state.room : state.room ? [state.room] : [] };
    if (table === "material_items") return { data: state.items };
    if (table === "design_boards") return { data: { board_state: null } };
    return { data: state.issues };
  };
  const q: any = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
    update: (value: any) => { patch = { kind: "update", value }; return q; }, insert: (value: any) => { patch = { kind: "insert", value }; return q; },
    single: async () => run(), maybeSingle: async () => run(), then: (resolve: any) => Promise.resolve(run()).then(resolve) };
  return q;
} } }));
import { saveMaterialProductLinkRequest } from "@/lib/materialProductLink.server";
const request = (patch: any = {}) => new Request("https://studio.test/api/material-catalog-suggestions", { method: "POST", body: JSON.stringify({ action: "link", project_id: projectId, room_id: roomId, label: "Sink", product_url: "https://retailer.test/new-sink", existing_item_id: null, expected_updated_at: null, ...patch }) });
beforeEach(() => {
  state.denied = null; state.items = []; state.writes = []; state.reads = []; state.conflict = false; state.issues = null;
  state.room = { id: roomId, name: "Bathroom 2" };
});
it("inserts a missing material with a saved link ready for automatic scraping", async () => {
  const response = await saveMaterialProductLinkRequest(request()); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ item_id: itemId });
  expect(state.writes[0].value).toMatchObject({ project_id: projectId, room_id: roomId, product_url: "https://retailer.test/new-sink", scrape_status: "pending", quantity_tbd: true, product_id: null, is_required: false });
});
it("reuses an untouched placeholder instead of inserting a duplicate", async () => {
  state.items = [{ id: itemId, project_id: projectId, room_id: roomId, item_label: "Sink", is_required: true, updated_at: "version" }];
  expect((await saveMaterialProductLinkRequest(request())).status).toBe(200);
  expect(state.writes[0]).toMatchObject({ kind: "update", filters: { id: itemId, project_id: projectId, room_id: roomId, updated_at: "version" } });
});
it("detaches an old catalog variant on a changed link and preserves quantities and manual fields", async () => {
  state.items = [{ id: itemId, project_id: projectId, room_id: roomId, item_label: "Sink", is_required: false, product_id: "old-product", product_url: "https://retailer.test/old-sink", quantity: 2, color: "Manual color", image_url: "manual-photo", updated_at: "version" }];
  expect((await saveMaterialProductLinkRequest(request({ existing_item_id: itemId, expected_updated_at: "version" }))).status).toBe(200);
  expect(state.writes[0].value).toMatchObject({ product_id: null, scrape_status: "pending" });
  for (const key of ["quantity", "color", "image_url", "source_board_id", "ordered"]) expect(state.writes[0].value).not.toHaveProperty(key);
});
it.each(["ordered", "received", "installed"])("protects %s selections from a changed product link", async flag => {
  state.items = [{ id: itemId, room_id: roomId, updated_at: "version", product_url: "https://retailer.test/old", [flag]: true }];
  expect((await saveMaterialProductLinkRequest(request({ existing_item_id: itemId, expected_updated_at: "version" }))).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("returns authorization failures before reading or writing materials", async () => {
  state.denied = Response.json({ error: "Only staff" }, { status: 403 });
  expect((await saveMaterialProductLinkRequest(request())).status).toBe(403); expect(state.reads).toEqual([]); expect(state.writes).toEqual([]);
});
it("does not enrich an old catalog product whose URL differs from the material link", async () => {
  state.items = [{ id: itemId, room_id: roomId, updated_at: "version", product_url: "https://retailer.test/new-sink", product_id: "old-product", product: { product_url: "https://retailer.test/old-sink" } }];
  expect((await saveMaterialProductLinkRequest(request({ existing_item_id: itemId, expected_updated_at: "version" }))).status).toBe(200);
  expect(state.writes[0].value.product_id).toBeNull();
});
it("does not allow a foreign room or a stale material version", async () => {
  state.room = null; expect((await saveMaterialProductLinkRequest(request())).status).toBe(404);
  state.room = { id: roomId, name: "Bathroom 2" }; state.items = [{ id: itemId, room_id: roomId, updated_at: "new" }];
  expect((await saveMaterialProductLinkRequest(request({ existing_item_id: itemId, expected_updated_at: "old" }))).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("rejects a missing selection already present in the room", async () => {
  state.items = [{ id: itemId, room_id: roomId, item_label: "Sink", category: "Plumbing", product_id: "chosen", is_required: false }];
  expect((await saveMaterialProductLinkRequest(request())).status).toBe(409); expect(state.writes).toEqual([]);
});
it("protects a saved issue that has been completed or changed", async () => {
  const key = "a".repeat(64);
  state.issues = { report: { checked_at: "now" }, issues: { [key]: { status: "completed", status_updated_at: null, last_seen_at: "now", finding: { room_id: roomId, item_id: null, field: "missing_item" } } } };
  expect((await saveMaterialProductLinkRequest(request({ completion_issue_key: key, expected_issue_updated_at: null }))).status).toBe(409); expect(state.writes).toEqual([]);
});
it("does not claim a link was saved if another update won the write", async () => {
  state.items = [{ id: itemId, room_id: roomId, item_label: "Sink", is_required: true, updated_at: "version" }]; state.conflict = true;
  expect((await saveMaterialProductLinkRequest(request())).status).toBe(409);
});
