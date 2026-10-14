import { afterEach, beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: session } }));
import { fetchSpecCompletion } from "@/lib/specCompletionClient";
import { refreshMaterialProductInfo } from "@/lib/materialProductRefresh";
import { checkSpecDetails } from "@/lib/specCompletion";

const project = "2b31849c-b94a-4b78-9bf0-e263bbfce6a0";
const itemId = "89863790-1b55-4a90-a9fe-0ec3a11f0b0d";
const otherId = "64f674d2-01d1-45bc-8fe5-8c6a24e66c9c";
const row = (id = itemId, scraped: Record<string, unknown> = { price: "$87.90" }) => ({
  material_item_id: id, url: "https://www.fergusonhome.com/delta-dt061411/s1901985?uid=4499531", scraped,
});
const report = { checked_at: "2026-10-13", findings: [], plan_status: "no_document" };
beforeEach(() => { session.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "TEST_ONLY", user: { id: "staff" } } }, error: null }); session.refreshSession.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

it("saves product prices and refreshes the screen before starting completion, eliminating the old missing-price finding", async () => {
  const order: string[] = [];
  const item: any = { id: itemId, room_id: "bath", item_label: "Shower Drain", category: "Plumbing", is_required: false,
    quantity: 1, color: "Polished Nickel", product_url: row().url, product_id: itemId,
    product: { price: null, finish: "Polished Nickel", price_unit: "unit" } };
  expect(checkSpecDetails([item], [{ id: "bath", name: "Bathroom" }]).some(f => f.field === "price")).toBe(true);
  let finishSave!: () => void;
  const saving = new Promise<void>(resolve => { finishSave = resolve; });
  const request = vi.fn(async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer TEST_ONLY");
    if (url === "/api/check-spec-completion" && body.action === "prepare") {
      order.push("prepare"); return Response.json({ material_item_ids: [itemId], board_updated_at: "saved-board-revision", board_refresh: { imported: 1, updated: 2, added: 1, issues: [] } });
    }
    if (url === "/api/scrape-materials" && options.method === "POST") {
      order.push("scrape"); expect(body.material_item_ids).toEqual([itemId]);
      return Response.json({ status: "completed", rows: [row()], remaining_count: 0 });
    }
    if (options.method === "PUT") {
      order.push("save-start"); await saving; item.product.price = "$87.90"; order.push("save-finished");
      return Response.json({ ok: true, price_missing_count: 0 });
    }
    order.push("review"); expect(body).toEqual({ project_id: project, expected_board_updated_at: "saved-board-revision" });
    const findings = checkSpecDetails([item], [{ id: "bath", name: "Bathroom" }]);
    expect(findings.some(f => f.field === "price")).toBe(false);
    return Response.json({ ...report, findings });
  });
  vi.stubGlobal("fetch", request);
  const check = fetchSpecCompletion(project, { onBoardRefreshed: async summary => {
    expect(summary.imported).toBe(1); order.push("board-synced");
  }, onProductsRefreshed: async summary => {
    expect(summary).toEqual({ saved: 1, failed: 0, priceMissing: 0 }); order.push("refresh-screen");
  } });
  await vi.waitFor(() => expect(order).toEqual(["prepare", "board-synced", "scrape", "save-start"]));
  finishSave(); await check;
  expect(order).toEqual(["prepare", "board-synced", "scrape", "save-start", "save-finished", "refresh-screen", "review"]);
});

it("does not scrape or start a paid review when project preparation denies access", async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ error: "This project is not assigned to you." }, { status: 403 }));
  vi.stubGlobal("fetch", request);
  await expect(fetchSpecCompletion(project)).rejects.toThrow("not assigned"); expect(request).toHaveBeenCalledTimes(1);
});

it("does not restart an already-running plan review", async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ material_item_ids: [], pending_report: report }));
  vi.stubGlobal("fetch", request);
  expect(await fetchSpecCompletion(project)).toEqual(report); expect(request).toHaveBeenCalledTimes(1);
});

it("stops before completion when scraped products cannot be saved", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({ material_item_ids: [itemId] }))
    .mockResolvedValueOnce(Response.json({ status: "completed", rows: [row()] }))
    .mockResolvedValueOnce(Response.json({ error: "Save unavailable" }, { status: 500 }));
  vi.stubGlobal("fetch", request);
  await expect(fetchSpecCompletion(project)).rejects.toThrow("Save unavailable");
  expect(request).toHaveBeenCalledTimes(3);
});

it("saves useful rows, preserves failed products, and continues through all batches without repeating items", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({ status: "completed", rows: [row(), row()], remaining_count: 1 }))
    .mockResolvedValueOnce(Response.json({ ok: true, price_missing_count: 0 }))
    .mockResolvedValueOnce(Response.json({ status: "completed", rows: [row(otherId, { error: "Retailer blocked" })], remaining_count: 0 }));
  vi.stubGlobal("fetch", request);
  expect(await refreshMaterialProductInfo(project, [itemId, otherId], { authorization: "Bearer TEST_ONLY" }))
    .toEqual({ saved: 1, failed: 1, priceMissing: 0 });
  expect(JSON.parse(request.mock.calls[1][1].body).rows).toHaveLength(1);
  expect(JSON.parse(request.mock.calls[2][1].body).exclude_material_item_ids).toEqual([itemId]);
});

it("waits for asynchronous scraping and saves both prefetched and polled products", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValueOnce(Response.json({ status: "started", batch_id: "batch", candidates: [row(otherId)], prefetched_rows: [row()], remaining_count: 0 }))
    .mockResolvedValueOnce(Response.json({ status: "processing", completed_count: 0, total_count: 1 }))
    .mockResolvedValueOnce(Response.json({ status: "completed", rows: [row(otherId, { name: "Drain" })] }))
    .mockResolvedValueOnce(Response.json({ ok: true, price_missing_count: 1 }));
  vi.stubGlobal("fetch", request);
  const progress = vi.fn();
  const refresh = refreshMaterialProductInfo(project, [itemId, otherId], { authorization: "Bearer TEST_ONLY", onProgress: progress });
  await vi.runAllTimersAsync();
  expect(await refresh).toEqual({ saved: 2, failed: 0, priceMissing: 1 });
  expect(JSON.parse(request.mock.calls[3][1].body).rows.map((r: any) => r.material_item_id)).toEqual([itemId, otherId]);
  expect(progress).toHaveBeenCalledWith(expect.stringContaining("0 of 1"));
});

it("falls back to individual product reads if the batch never finishes", async () => {
  vi.useFakeTimers();
  const actions: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body)); actions.push(body.action || "save");
    if (body.action === "start") return Response.json({ status: "started", batch_id: "batch", candidates: [row()] });
    if (body.action === "poll") return Response.json({ status: "processing" });
    if (body.action === "fallback") return Response.json({ status: "completed", rows: [row()] });
    return Response.json({ ok: true });
  }));
  const refresh = refreshMaterialProductInfo(project, [itemId], { authorization: "Bearer TEST_ONLY" });
  await vi.runAllTimersAsync(); expect((await refresh).saved).toBe(1);
  expect(actions.filter(a => a === "poll")).toHaveLength(99); expect(actions.slice(-2)).toEqual(["fallback", "save"]);
});

it("rejects invalid scopes and incomplete responses instead of treating them as a finished scrape", async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ status: "processing" })); vi.stubGlobal("fetch", request);
  await expect(refreshMaterialProductInfo(project, ["invalid"], { authorization: "Bearer TEST_ONLY" })).rejects.toThrow("current project selections");
  expect(request).not.toHaveBeenCalled();
  await expect(refreshMaterialProductInfo(project, [itemId], { authorization: "Bearer TEST_ONLY" })).rejects.toThrow("did not finish");
});

it("skips product scraping for projects with no active selections", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({ material_item_ids: [] })).mockResolvedValueOnce(Response.json(report));
  vi.stubGlobal("fetch", request); await fetchSpecCompletion(project);
  expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls.every(call => call[0] === "/api/check-spec-completion")).toBe(true);
});

it("uses the latest session for product saves and the final plan check after a long refresh", async () => {
  let token = "INITIAL";
  session.getSession.mockImplementation(async () => ({ data: { session: { access_token: token, user: { id: "staff" } } }, error: null }));
  const sent: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    sent.push(new Headers(options.headers).get("Authorization")!);
    const body=JSON.parse(String(options.body));
    if(body.action==="prepare") return Response.json({material_item_ids:[itemId]});
    if(url==="/api/scrape-materials" && options.method==="POST") {
      token="RENEWED"; return Response.json({status:"completed",rows:[row()],remaining_count:0});
    }
    if(options.method==="PUT")return Response.json({ok:true});
    return Response.json(report);
  }));
  await fetchSpecCompletion(project);
  expect(sent).toEqual(["Bearer INITIAL","Bearer INITIAL","Bearer RENEWED","Bearer RENEWED"]);
});

it("completes 409 selections across 35 batches after more than an hour and one expired-session rejection", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
  const started = Date.now();
  const ids = Array.from({ length: 409 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  session.getSession.mockImplementation(async () => ({ data: { session: {
    access_token: Date.now() - started < 3_600_000 ? "INITIAL" : "RENEWED", user: { id: "staff" },
  } }, error: null }));
  session.refreshSession.mockResolvedValue({ data: { session: { access_token: "RENEWED", user: { id: "staff" } } }, error: null });
  const saved: string[] = [];
  let batchIds: string[] = [], batchCount = 0, rejected = false, reviewed = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    const token = new Headers(options.headers).get("Authorization");
    if (body.action === "prepare") return Response.json({ material_item_ids: ids });
    if (body.action === "start") {
      expect(body.exclude_material_item_ids).toEqual(saved);
      batchIds = ids.filter(id => !saved.includes(id)).slice(0, 12); batchCount++;
      return Response.json({ status: "started", batch_id: `batch-${batchCount}`, candidates: batchIds.map(id => row(id)), remaining_count: 409 - saved.length - batchIds.length });
    }
    if (body.action === "poll") {
      if (batchCount === 20 && !rejected) {
        rejected = true; return Response.json({ error: "Your session expired." }, { status: 401 });
      }
      // Slow retailers make the entire refresh span a session renewal.
      vi.setSystemTime(new Date(Date.now() + 120_000));
      return Response.json({ status: "completed", rows: batchIds.map(id => row(id)) });
    }
    if (options.method === "PUT") {
      expect(token).toBe(Date.now() - started < 3_600_000 ? "Bearer INITIAL" : "Bearer RENEWED");
      saved.push(...body.rows.map((value: any) => value.material_item_id));
      return Response.json({ ok: true });
    }
    expect(url).toBe("/api/check-spec-completion");
    expect(saved).toEqual(ids); expect(token).toBe("Bearer RENEWED"); reviewed = true;
    return Response.json({ ...report, item_count: 409 });
  }));
  const checking = fetchSpecCompletion(project);
  await vi.runAllTimersAsync();
  expect((await checking).item_count).toBe(409);
  expect(batchCount).toBe(35); expect(new Set(saved).size).toBe(409);
  expect(Date.now() - started).toBeGreaterThan(3_600_000);
  expect(session.refreshSession).toHaveBeenCalledTimes(1); expect(reviewed).toBe(true);
});
