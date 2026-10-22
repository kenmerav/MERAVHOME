import { afterEach, beforeEach, expect, it, vi } from "vitest";
const projectId = "527d1356-919b-48b9-877e-1924c766282b";
const roomId = "0033186c-a2e6-417f-a50f-37f5390f5cf5";
const userId = "4204f2d1-e10c-4d98-a01b-350cf7d8cafe";
const state = vi.hoisted(() => ({ authenticated: true, profile: {} as any, assigned: true, project: true,
  documents: [] as any[], rooms: [] as any[], items: [] as any[], board: null as any,
  reads: [] as any[], download: vi.fn(), fetch: vi.fn(), rpc: vi.fn(), refresh: vi.fn(), dataError: false, storageError: null as any, saved: null as any, writes: [] as any[], writeMisses: 0 }));
const boardSync = vi.hoisted(() => vi.fn());
const workerStart = vi.hoisted(() => vi.fn());
vi.mock("@/lib/specCompletionBackground.server", () => ({ startCompletionSaveWorker: workerStart }));
vi.mock("workflow", () => ({ sleep: vi.fn(async () => undefined) }));
vi.mock("@/lib/specBoardSync.server", () => ({ syncSpecBoardForStaff: boardSync }));
vi.mock("@/lib/constructionUploads.server", () => ({ refreshConstructionUploads: state.refresh }));
vi.mock("pdf-lib", () => ({ PDFDocument: { load: async () => ({ getPageCount: () => 14 }) } }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: userId } : null }, error: null }) },
  storage: { from: () => ({ download: state.download }) },
  rpc: state.rpc,
  from: (table: string) => {
    const filters: any = {}; const orders: any[] = []; let slice: number[] | null = null; let patch: any = null; let insert: any = null;
    const get = () => { state.reads.push({ table, filters, orders });
      if (table === "user_profiles") return { data: state.profile, error: null };
      if (table === "user_project_assignments") return { data: state.assigned ? { project_id: projectId } : null, error: null };
      if (table === "projects") return { data: state.project ? { id: projectId } : null, error: null };
      if (table === "design_boards") return { data: { board_state: state.board }, error: null };
      if (table === "spec_completion_reviews") {
        if (insert) {
          if (state.saved) return { data: null, error: null };
          state.saved = structuredClone(insert); state.writes.push({ filters, patch: insert });
          return { data: structuredClone(state.saved), error: state.storageError };
        }
        if (patch) {
          state.writes.push({ filters, patch });
          if (state.writeMisses > 0) { state.writeMisses--; const key = Object.keys(state.saved.issues)[0];
            state.saved.issues[key].status = 'completed'; state.saved.updated_at = 'concurrent-status'; return { data: null, error: null }; }
          if (state.saved?.updated_at !== filters.updated_at) return { data: null, error: null };
          state.saved = { ...state.saved, ...structuredClone(patch) };
        }
        return { data: state.saved && structuredClone(state.saved), error: state.storageError };
      }
      let data = table === "rooms" ? state.rooms : table === "material_items" ? state.items : state.documents;
      if (filters.project_id !== projectId) data = [];
      if (slice) data = data.slice(slice[0], slice[1] + 1);
      return { data, error: state.dataError ? new Error("read failed") : null };
    };
    const query: any = { select: () => query, update: (value: any) => { patch = value; return query; }, upsert: (value: any) => { insert = value; return query; }, eq: (key: string, value: any) => { filters[key] = value; return query; },
      is: (key: string, value: any) => { filters[key] = value; return query; }, order: (key: string, options: any) => { orders.push([key, options]); return query; },
      range: (start: number, end: number) => { slice = [start, end]; return query; }, limit: () => query,
      maybeSingle: async () => get(), then: (resolve: any) => Promise.resolve(get()).then(resolve) };
    return query;
  },
} }));
import { checkSpecCompletion } from "@/lib/specCompletion.server";
import { signFinishObservation } from "@/lib/selectedFinish.server";
import { savedSpecCompletionRequest } from "@/lib/savedSpecCompletionApi.server";
import { completionSourceSignature, pollCompletionSave, failCompletionSave } from "@/lib/savedSpecCompletion.server";
import { saveSpecCompletionInBackground } from "@/workflows/specCompletionSave";
const request = (body: any = { project_id: projectId }, token = true) => new Request("https://studio.test/api/check-spec-completion", {
  method: "POST", headers: { ...(token ? { Authorization: "Bearer TEST_ONLY_TOKEN" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const drawingEvidence = () => ({ complete: true, reviewed_pages: Array.from({ length: 14 }, (_, i) => i + 1), complete_project_scope: true,
  rooms: state.rooms.map(room => ({ room_id: room.id, match: /throughout/i.test(room.name) ? "shared_default" : "matched" })),
  facts: state.rooms.some(room => room.id === roomId) ? [{ id: "sink-count", room_id: roomId, label: "Sink", field: "quantity",
    product: "", sku: "", variant: "S1", page: 2, sheet: "ID1", evidence: "Two identical S1 sinks in the complete proposed vanity layout.",
    confidence: "high", proposed: true, quantity: 2, quantity_unit: "count", complete_room_scope: true, exact_variant: true }] : [], uncertainties: [] });
const completed = (findings: any[] = []) => Response.json({ status: "completed", output_text: JSON.stringify({
  drawing_evidence: drawingEvidence(), findings: findings.map(row => ({ ...row, evidence_ids: ["sink-count"] })) }) });

it("prepares only active current selections without refreshing PDFs, saving findings, or starting AI", async () => {
  state.board = { pages: [{ id: "p", elements: [] }] };
  state.items.push({ ...state.items[0], id: "removed", not_needed: true },
    { ...state.items[0], id: "placeholder", is_required: true, product_id: null, product_url: null },
    { ...state.items[0], id: "stale", source_board_id: projectId, source_board_page_id: "p", source_board_element_id: "deleted" },
    { ...state.items[0], id: "wrong-room", room_id: "former" });
  const response = await checkSpecCompletion(request({ project_id: projectId, action: "prepare" }));
  expect(await response.json()).toMatchObject({ material_item_ids: ["sink"], board_updated_at: null, board_refresh: { issues: [] } });
  expect(state.refresh).not.toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled(); expect(state.saved).toBeNull();
});

it("saves verified link finishes, flags alternatives and rejects evidence after the linked variant changes", async () => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-finish-signing");
  state.documents = [];
  const link = "https://vendor.test/faucet?variant=123";
  state.items = [{ ...state.items[0], color: "Bronze or Black", product_url: link }];
  const proof = signFinishObservation(projectId, "sink", link, { status: "verified", color: "Bronze", finish: "", basis: "url_variant", evidence: "URL-selected variant 123: Bronze" });
  const response = await checkSpecCompletion(request({ project_id: projectId, finish_checks: [proof] }));
  const report = await response.json();
  expect(report.findings.find((finding: any) => finding.finish_check)).toMatchObject({ finish_check: "ambiguous", suggested: "Bronze" });
  expect(state.saved.report.finish_review.observations[0].color).toBe("Bronze");
  expect(state.items[0].color).toBe("Bronze or Black");
  state.items[0].product_url = link.replace("123", "456");
  state.items[0].color = "Black";
  const changed = await (await checkSpecCompletion(request({ project_id: projectId, finish_checks: [proof] }))).json();
  expect(changed.findings.find((finding: any) => finding.finish_check)).toMatchObject({ finish_check: "unverified", suggested: "" });
  expect(state.fetch).not.toHaveBeenCalled();
});

it("checks staff and project access before preparing a product refresh", async () => {
  state.profile = { role: "Employee", is_active: true, can_view_all_projects: false }; state.assigned = false;
  expect((await checkSpecCompletion(request({ project_id: projectId, action: "prepare" }))).status).toBe(403);
  expect(state.reads.some(read => read.table === "material_items")).toBe(false);
  expect(state.refresh).not.toHaveBeenCalled();
});

it("rejects unknown preparation actions", async () => {
  expect((await checkSpecCompletion(request({ project_id: projectId, action: "refresh-every-project" }))).status).toBe(400);
  expect(state.refresh).not.toHaveBeenCalled();
});
beforeEach(() => {
  boardSync.mockResolvedValue({ updated_at: null, summary: { imported: 0, updated: 0, added: 0, issues: [] } });
  vi.clearAllMocks(); state.authenticated = true; state.assigned = true; state.project = true; state.dataError = false;
  workerStart.mockResolvedValue('wrun_test_worker');
  state.storageError = null; state.saved = null; state.writes = []; state.writeMisses = 0;
  state.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === 'save_spec_completion_review') state.saved = { report: structuredClone(args.p_report),
      issues: { ...state.saved?.issues, ...structuredClone(args.p_issues) }, source_signature: args.p_source_signature, updated_at: 'initial-version' };
    return { data: null, error: null };
  });
  state.refresh.mockResolvedValue({ uploaded: 0, failed: 0, deferred: 0, needsReview: 0, needsReconnect: false, error: null });
  state.profile = { role: "Admin", is_active: true, can_view_all_projects: true };
  state.rooms = [{ id: roomId, name: "Bathroom 2" }]; state.board = null; state.reads = [];
  state.documents = [{ id: "latest", title: "Latest Plans", updated_at: "v1", file_size: 20,
    file_url: `https://example.supabase.co/storage/v1/object/public/project-files/${projectId}/construction-docs/latest.pdf` }];
  state.items = [{ id: "sink", project_id: projectId, room_id: roomId, item_label: "Sink", is_required: false,
    quantity: null, color: null, product_id: null, not_needed: false }];
  state.download.mockResolvedValue({ data: new Blob(["fixture-pdf"]), error: null });
  state.fetch.mockImplementation(async () => completed([{
    item_id: "sink", room_id: roomId, field: "quantity", confidence: "high", page: 2, sheet: "ID1", evidence: "Two identical selected sinks in proposed vanity.",
    quantity: 2, quantity_unit: "count", count_scope: "exact_material", exact_material_match: true,
  }]));
  vi.stubGlobal("fetch", (url: string, options: unknown) => url.endsWith("/input_tokens") ?
    Promise.resolve(Response.json({ input_tokens: 50000 })) : state.fetch(url, options));
  vi.stubEnv("OPENAI_API_KEY", "TEST_ONLY_KEY"); vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("reuses an unchanged full review with no generation, PDF download, or lost issue decisions", async () => {
  const first = await (await checkSpecCompletion(request())).json();
  expect(first.plan_status).toBe("checked");
  const key = Object.keys(state.saved.issues)[0]; state.saved.issues[key].status = "not_needed";
  const second = await (await checkSpecCompletion(request())).json();
  expect(second.plan_status).toBe("checked"); expect(second.plan_message).toContain("without another AI charge");
  expect(state.fetch).toHaveBeenCalledTimes(1); expect(state.download).toHaveBeenCalledTimes(1);
  expect(state.saved.issues[key].status).toBe("not_needed");
  expect(second.spec_drawing_evidence).toBeUndefined();
});
it("compares changed selections using saved drawing facts with no PDF or download", async () => {
  await checkSpecCompletion(request());
  state.items[0].quantity = 4;
  const result = await (await checkSpecCompletion(request())).json();
  expect(result.plan_status).toBe("checked"); expect(result.plan_message).toContain("full PDF was not sent again");
  expect(result.findings.find((row: any) => row.field === "quantity").current).toBe("4");
  expect(state.download).toHaveBeenCalledTimes(1); expect(state.fetch).toHaveBeenCalledTimes(2);
  const body = JSON.parse(state.fetch.mock.calls[1][1].body);
  expect(body.input[0].content.every((part: any) => part.type === "input_text")).toBe(true);
  const input = JSON.parse(body.input[0].content[0].text);
  expect(input.selections[0].quantity).toBe(4); expect(input.drawing_evidence.facts[0].quantity).toBe(2);
});
it("keeps drawing extraction independent of newly selected products and of a cold server module", async () => {
  await checkSpecCompletion(request());
  const source = Object.keys(state.saved.report.spec_drawing_evidence)[0];
  state.items.push({ ...state.items[0], id: "new-faucet", item_label: "Sink Faucet", product_id: "new-product", product: { name: "New Faucet", sku: "new-sku" } });
  vi.resetModules();
  const cold = await import("@/lib/specCompletion.server");
  expect((await (await cold.checkSpecCompletion(request())).json()).plan_status).toBe("checked");
  expect(Object.keys(state.saved.report.spec_drawing_evidence)).toEqual([source]);
  expect(state.download).toHaveBeenCalledTimes(1);
  const input = JSON.parse(JSON.parse(state.fetch.mock.calls[1][1].body).input[0].content[0].text);
  expect(input.selections.some((item: any) => item.sku === "new-sku")).toBe(true);
});
it.each(["document", "path", "room"])("extracts a fresh drawing source when its %s changes", async change => {
  await checkSpecCompletion(request());
  if (change === "document") state.documents[0].updated_at = "v2";
  if (change === "path") state.documents[0].file_url = state.documents[0].file_url.replace("latest.pdf", "revision.pdf");
  if (change === "room") state.rooms[0].name = "Guest House Bathroom";
  const result = await (await checkSpecCompletion(request())).json();
  expect(result.plan_status).toBe("checked"); expect(state.download).toHaveBeenCalledTimes(2);
  expect(JSON.parse(state.fetch.mock.calls[1][1].body).input[0].content.some((p: any) => p.type === "input_file")).toBe(true);
});
it("claims simultaneous full reviews before either can pay for a duplicate PDF scan", async () => {
  state.fetch.mockImplementation(async () => Response.json({ status: "queued", id: "resp_shared_scan" }));
  const results = await Promise.all([checkSpecCompletion(request()), checkSpecCompletion(request())]);
  expect(results.some(response => response.status === 200)).toBe(true);
  expect(state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === "POST")).toHaveLength(1);
  expect(state.download).toHaveBeenCalledTimes(1);
});
it("persists background extraction and later comparisons without returning private evidence", async () => {
  state.fetch.mockImplementation(async () => Response.json({ status: "queued", id: "resp_cached_drawing" }));
  const report = await (await checkSpecCompletion(request())).json();
  expect(report.plan_job.evidence_mode).toBe("extract");
  state.fetch.mockImplementation(async (_url: string, options: any) => options?.method === "POST"
    ? Response.json({ status: "queued", id: "resp_text_compare" }) : completed());
  expect(await pollCompletionSave(projectId, report.plan_job.request_id)).toBe("checked");
  state.items[0].quantity = 4;
  const changed = await (await checkSpecCompletion(request())).json();
  expect(changed.plan_job.evidence_mode).toBe("compare");
  expect(await pollCompletionSave(projectId, changed.plan_job.request_id)).toBe("checked");
  const loaded = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json();
  expect(loaded.report.spec_drawing_evidence).toBeUndefined();
  expect(state.download).toHaveBeenCalledTimes(1);
  expect(state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === "POST")).toHaveLength(2);
});
it("rejects incomplete reusable evidence and never automatically launches another scan", async () => {
  state.fetch.mockImplementation(async () => Response.json({ status: "completed", output_text: JSON.stringify({
    drawing_evidence: { ...drawingEvidence(), reviewed_pages: [1] }, findings: [] }) }));
  const result = await (await checkSpecCompletion(request())).json();
  expect(result.plan_status).toBe("unavailable");
  await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }));
  expect(state.fetch).toHaveBeenCalledTimes(1); expect(state.saved.report.findings.every((f: any) => f.source === "details")).toBe(true);
});
it("retains the latest two completed drawing versions and the catalog cache across full reviews", async () => {
  await checkSpecCompletion(request());
  state.saved.report.catalog_fit_checks = { untouched: { status: "checked", requirements: [] } };
  for (const version of ["v2", "v3", "v4"]) {
    state.documents[0].updated_at = version;
    expect((await (await checkSpecCompletion(request())).json()).plan_status).toBe("checked");
  }
  expect(Object.keys(state.saved.report.spec_drawing_evidence)).toHaveLength(2);
  expect(state.saved.report.catalog_fit_checks).toEqual({ untouched: { status: "checked", requirements: [] } });
});
it("collects a legacy pending full review without requiring a new extraction or generation", async () => {
  state.fetch.mockImplementation(async () => Response.json({ status: "queued", id: "resp_legacy" }));
  const first = await (await checkSpecCompletion(request())).json();
  delete state.saved.report.plan_job.evidence_key; delete state.saved.report.plan_job.evidence_mode;
  delete state.saved.report.spec_drawing_evidence;
  state.fetch.mockImplementation(async () => Response.json({ status: "completed", output_text: '{"findings":[]}' }));
  expect(await pollCompletionSave(projectId, first.plan_job.request_id)).toBe("checked");
  expect(state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === "POST")).toHaveLength(1);
});
it("salvages drawing evidence from a stale selection check without paying to rescan that PDF", async () => {
  state.fetch.mockImplementation(async () => Response.json({ status: "queued", id: "resp_stale_selection_scan" }));
  await checkSpecCompletion(request());
  state.items[0].quantity = 4;
  const stale = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json();
  expect(stale.report.plan_status).toBe("unavailable");
  state.fetch.mockImplementation(async (_url: string, options: any) => options?.method === "POST"
    ? Response.json({ status: "queued", id: "resp_fresh_text_comparison" }) : completed());
  const fresh = await (await checkSpecCompletion(request())).json();
  expect(fresh.plan_job.evidence_mode).toBe("compare"); expect(state.download).toHaveBeenCalledTimes(1);
  const generations = state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === "POST");
  expect(generations).toHaveLength(2);
  expect(JSON.parse(generations[1][1].body).input[0].content.every((part: any) => part.type === "input_text")).toBe(true);
});
it("rejects a queued comparison when the PDF path changes even without a revision timestamp change", async () => {
  state.fetch.mockImplementation(async () => Response.json({ status: "queued", id: "resp_replaced_path" }));
  await checkSpecCompletion(request());
  state.documents[0].file_url = state.documents[0].file_url.replace("latest.pdf", "replacement.pdf");
  const count = state.fetch.mock.calls.length;
  const loaded = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json();
  expect(loaded.report.plan_status).toBe("unavailable"); expect(loaded.stale).toBe(true);
  expect(state.fetch).toHaveBeenCalledTimes(count);
});
it("reads current project data and latest PDF, saving the review without editing any selections", async () => {
  const result = await (await checkSpecCompletion(request())).json();
  expect(result.plan_status).toBe("checked"); expect(result.item_count).toBe(1);
  expect(result.findings.find((row: any) => row.source === "plans").suggested).toBe("2 count");
  expect(state.reads.find(row => row.table === "project_documents")).toMatchObject({ filters: {
    project_id: projectId, document_type: "Construction Doc", superseded_by_document_id: null }, orders: [["created_at", { ascending: false }], ["id", { ascending: false }]] });
  const body = JSON.parse(state.fetch.mock.calls[0][1].body);
  expect(body.store).toBe(false); expect(body.instructions).toContain("untrusted evidence");
  expect(body).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "high" }, service_tier: "default", max_output_tokens: 32000 });
  expect(body.instructions).toContain("Do not estimate scale");
  expect(body.input[0].content[1]).toMatchObject({ type: "input_file", detail: "high" });
  expect(state.writes[0].patch).toMatchObject({ project_id: projectId, checked_by: userId });
  expect(state.saved.report.plan_status).toBe('checked');
});

it("queues and saves a 409-selection, 32-room review with a Bartow-sized PDF", async () => {
  state.rooms = Array.from({ length: 32 }, (_, index) => ({ id: `room-${index}`, name: `Room ${index}` }));
  state.items = Array.from({ length: 409 }, (_, index) => ({ ...state.items[0], id: `selection-${index}`, room_id: state.rooms[index % 32].id }));
  state.documents[0].file_size = 24709548;
  state.download.mockResolvedValue({ data: new Blob([new Uint8Array(24709548)]), error: null });
  state.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
    if (options?.method === "POST") return Response.json({ status: "queued", id: "resp_large_project_test" });
    return completed();
  });
  const report = await (await checkSpecCompletion(request())).json();
  expect(report.item_count).toBe(409); expect(report.plan_status).toBe("checking");
  const payload = JSON.parse(state.fetch.mock.calls[0][1].body);
  const context = JSON.parse(payload.input[0].content[0].text);
  expect(context.rooms).toHaveLength(32); expect(context.selections).toHaveLength(409);
  expect(Buffer.from(payload.input[0].content[1].file_data.split(",")[1], "base64").byteLength).toBe(24709548);
  expect(workerStart).toHaveBeenCalledTimes(1);
  await saveSpecCompletionInBackground(projectId, report.plan_job.request_id);
  expect(state.saved.report.plan_status).toBe("checked"); expect(state.saved.report.item_count).toBe(409);
});

it("refreshes shared selections and supplies project-wide coverage with separately selected copies to the plan review", async () => {
  const sharedRoom = "699dc873-61fa-4f6d-8baf-7aa330f0103a";
  state.rooms.push({ id: sharedRoom, name: "Materials Throughout" });
  const product = { id: "caxton", name: "Kohler Bathroom Sink", price: "$200", price_unit: "unit", product_url: "https://retailer.test/caxton" };
  state.items[0] = { ...state.items[0], item_label: "Sink", quantity: 1, product_id: "caxton", product };
  state.items.push({ ...state.items[0], id: "shared-sinks", room_id: sharedRoom, item_label: "bathroom sinks", quantity: 7 });
  expect(await (await checkSpecCompletion(request({ project_id: projectId, action: "prepare" }))).json())
    .toMatchObject({ material_item_ids: ["sink", "shared-sinks"], board_refresh: { issues: [] } });
  await checkSpecCompletion(request());
  const body = JSON.parse(state.fetch.mock.calls[0][1].body);
  const input = JSON.parse(body.input[0].content[0].text);
  expect(input.shared_selections).toEqual([{ item_id: "shared-sinks", room_id: sharedRoom,
    label: "bathroom sinks", scope: "project_default", room_selections: [{
      item_id: "sink", room_id: roomId, quantity: 1, quantity_tbd: false, quantity_unit: "count", same_variant: true,
    }] }]);
  expect(body.instructions).toContain("five shared sinks, not seven shared plus those two");
  expect(body.instructions).toContain("guest house/casita");
});

it("retires an old missing-sink finding covered by Materials Throughout without rerunning AI or discarding team decisions", async () => {
  const sharedRoom = "699dc873-61fa-4f6d-8baf-7aa330f0103a";
  state.rooms.push({ id: sharedRoom, name: "Materials Throughout" });
  const finding = { room_id: roomId, item_id: null, item_label: "Sink", field: "missing_item", source: "plans" };
  state.saved = { report: { checked_at: "earlier", document: null }, source_signature: "old", issues: {
    open: { key: "open", status: "open", finding },
    completed: { key: "completed", status: "completed", finding },
    dismissed: { key: "dismissed", status: "not_needed", finding },
  } };
  state.items.push({ ...state.items[0], id: "shared-sinks", room_id: sharedRoom, item_label: "bathroom sinks", quantity: 7,
    category: "Plumbing", product_id: "caxton", product: { id: "caxton", name: "Kohler Bathroom Sink" } });
  const result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json();
  expect(result.issues.map((issue: any) => issue.status)).toEqual(["completed", "not_needed"]);
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});

it("retires legacy shared quantity proposals without an allocation check while keeping reviewed proposals and team decisions", async () => {
  const sharedRoom = "699dc873-61fa-4f6d-8baf-7aa330f0103a";
  state.rooms.push({ id: sharedRoom, name: "Materials Throughout" });
  state.items.push({ ...state.items[0], id: "shared-sinks", room_id: sharedRoom, item_label: "bathroom sinks", quantity: 7,
    category: "Plumbing", product_id: "caxton", product: { id: "caxton", name: "Kohler Bathroom Sink" } });
  const finding = { room_id: sharedRoom, item_id: "shared-sinks", item_label: "bathroom sinks", field: "quantity", source: "plans" };
  state.saved = { report: { checked_at: "earlier", document: null }, source_signature: "old", issues: {
    legacy: { key: "legacy", status: "open", finding },
    reviewed: { key: "reviewed", status: "open", finding: { ...finding, shared_quantity_reviewed: true } },
    completed: { key: "completed", status: "completed", finding },
  } };
  const result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json();
  expect(result.issues.map((issue: any) => issue.key)).toEqual(["reviewed", "completed"]);
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});
it('returns a queued check promptly, resumes past five minutes, and saves results without another generation', async () => {
  state.fetch.mockImplementation(async (_url: string, options: any) => options?.method === 'POST' ?
    Response.json({ id: 'resp_cortez_test', status: 'queued' }) : Response.json({ status: 'in_progress' }));
  const started = await (await checkSpecCompletion(request())).json();
  expect(started.plan_status).toBe('checking'); expect(state.saved.report.findings).toHaveLength(5);
  expect(JSON.parse(state.fetch.mock.calls[0][1].body).background).toBe(true);
  const refreshCount = state.refresh.mock.calls.length;
  await checkSpecCompletion(request());
  expect(state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === 'POST')).toHaveLength(1);
  expect(state.refresh).toHaveBeenCalledTimes(refreshCount);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(started.checked_at) + 360000);
  state.fetch.mockImplementation(async () => completed([{
    item_id: 'sink', room_id: roomId, field: 'quantity', confidence: 'high', page: 2, sheet: 'ID1', evidence: 'Two selected sinks.',
    quantity: 2, quantity_unit: 'count', count_scope: 'exact_material', exact_material_match: true,
  }]));
  const finished = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: 'load' }))).json();
  expect(finished.report.plan_status).toBe('checked'); expect(finished.issues.some((issue: any) => issue.finding.suggested === '2 count')).toBe(true);
  expect(state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === 'POST')).toHaveLength(1);
  vi.restoreAllMocks();
});
it('finishes and persists an AI plan review without any browser polling', async () => {
  state.fetch.mockResolvedValue(Response.json({ id: 'resp_test', status: 'queued' }));
  const started = await (await checkSpecCompletion(request())).json();
  expect(workerStart).toHaveBeenCalledWith(projectId, started.plan_job.request_id);
  expect(started.plan_job.worker_run_id).toBe('wrun_test_worker');
  state.fetch.mockImplementation(async () => completed());
  expect(await saveSpecCompletionInBackground(projectId, started.plan_job.request_id)).toBe('checked');
  expect(state.saved.report.plan_status).toBe('checked');
  expect(state.writes.filter(write => write.patch.checked_by === userId)).toHaveLength(1);
  expect(state.writes.every(row => !('quantity' in row.patch))).toBe(true);
  expect(state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === 'POST')).toHaveLength(1);
});
it('does not start paid AI if durable saving could not be queued', async () => {
  workerStart.mockRejectedValueOnce(new Error('Queue unavailable'));
  const result = await (await checkSpecCompletion(request())).json();
  expect(result.plan_status).toBe('unavailable');
  expect(result.plan_message).toContain('no AI plan check');
  expect(state.fetch).not.toHaveBeenCalled();
  expect(state.download).not.toHaveBeenCalled();
});
it('does not let an old collector poll or fail a replacement review', async () => {
  state.fetch.mockResolvedValue(Response.json({ id: 'resp_test', status: 'queued' }));
  const started = await (await checkSpecCompletion(request())).json();
  state.saved.report.plan_job.request_id = '1342d7ee-2f95-41c9-9ae3-cc0a2ab9e1cf';
  const reads = state.fetch.mock.calls.length;
  const writes = state.writes.length;
  expect(await pollCompletionSave(projectId, started.plan_job.request_id)).toBe('replaced');
  await failCompletionSave(projectId, started.plan_job.request_id);
  expect(state.fetch).toHaveBeenCalledTimes(reads);
  expect(state.writes).toHaveLength(writes);
  expect(state.saved.report.plan_status).toBe('checking');
});
it('reattaches a saved pending review once without refreshing sources or starting AI', async () => {
  state.fetch.mockResolvedValue(Response.json({ id: 'resp_test', status: 'queued' }));
  await checkSpecCompletion(request());
  delete state.saved.report.plan_job.worker_run_id;
  state.saved.report.plan_job.response_id = null;
  workerStart.mockClear();
  const paidCalls = state.fetch.mock.calls.length;
  const documentRefreshes = state.refresh.mock.calls.length;
  await savedSpecCompletionRequest(request({project_id: projectId, action: 'load'}));
  await savedSpecCompletionRequest(request({project_id: projectId, action: 'load'}));
  expect(workerStart).toHaveBeenCalledTimes(1);
  expect(state.saved.report.plan_job.worker_run_id).toBe('wrun_test_worker');
  expect(state.fetch).toHaveBeenCalledTimes(paidCalls);
  expect(state.refresh).toHaveBeenCalledTimes(documentRefreshes);
});
it('collects a large plan review past nine minutes and saves the same paid result', async () => {
  state.fetch.mockResolvedValue(Response.json({ id: 'resp_test', status: 'queued' }));
  const started = await (await checkSpecCompletion(request())).json();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(started.checked_at) + 12 * 60_000);
  state.fetch.mockImplementation(async () => Response.json({ status: 'in_progress' }));
  expect(await pollCompletionSave(projectId, started.plan_job.request_id)).toBe('checking');
  state.fetch.mockImplementation(async () => completed());
  expect(await pollCompletionSave(projectId, started.plan_job.request_id)).toBe('checked');
  expect(state.saved.report.plan_status).toBe('checked');
  expect(state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === 'POST')).toHaveLength(1);
  vi.restoreAllMocks();
});
it('retires an overdue AI response without retrying generation', async () => {
  state.fetch.mockResolvedValue(Response.json({ id: 'resp_test', status: 'queued' }));
  const started = await (await checkSpecCompletion(request())).json();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(started.checked_at) + 31 * 60_000);
  state.fetch.mockImplementation(async () => Response.json({ status: 'in_progress' }));
  expect(await pollCompletionSave(projectId, started.plan_job.request_id)).toBe('unavailable');
  expect(state.saved.report.plan_message).toContain('No automatic retry');
  vi.restoreAllMocks();
});
it('preserves staff decisions when a status save races the background result', async () => {
  state.fetch.mockResolvedValue(Response.json({ id: 'resp_test', status: 'queued' }));
  await checkSpecCompletion(request()); state.writeMisses = 1;
  state.fetch.mockImplementation(async () => completed());
  const result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: 'load' }))).json();
  expect(result.report.plan_status).toBe('checked'); expect(result.issues[0].status).toBe('completed');
  expect(state.writes.length).toBeGreaterThan(2);
});
it('rejects background suggestions when the selections changed, without starting another paid request', async () => {
  state.fetch.mockResolvedValue(Response.json({ id: 'resp_test', status: 'queued' })); await checkSpecCompletion(request());
  state.items[0].quantity = 4;
  const calls = state.fetch.mock.calls.length;
  const result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: 'load' }))).json();
  expect(result.report.plan_status).toBe('unavailable'); expect(result.report.plan_message).toContain('changed');
  expect(state.fetch).toHaveBeenCalledTimes(calls);
});
it('keeps saved details when a temporary background response expires', async () => {
  state.fetch.mockResolvedValue(Response.json({ id: 'resp_test', status: 'queued' })); await checkSpecCompletion(request());
  state.fetch.mockResolvedValue(Response.json({ error: 'expired' }, { status: 404 }));
  const result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: 'load' }))).json();
  expect(result.report.plan_status).toBe('unavailable'); expect(result.issues).toHaveLength(5);
});
it.each(['credit_balance_exhausted', 'insufficient_quota'])('saves the actual %s error from a background response without restarting AI', async code => {
  state.fetch.mockResolvedValue(Response.json({ id: 'resp_test', status: 'queued' }));
  const started = await (await checkSpecCompletion(request())).json();
  const issues = structuredClone(state.saved.issues);
  const generationCount = state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === 'POST').length;
  state.fetch.mockImplementation(async () => Response.json({ status: 'failed', error: { code } }));
  expect(await pollCompletionSave(projectId, started.plan_job.request_id)).toBe('unavailable');
  expect(state.saved.report.plan_failure_code).toBe(code);
  expect(state.saved.report.plan_message).toContain('OpenAI reported no available API credits');
  expect(state.saved.report.plan_message).toContain('plan quantities and missing items have not been verified');
  expect(state.saved.issues).toEqual(issues);
  expect(state.fetch.mock.calls.filter((call: any[]) => call[1]?.method === 'POST')).toHaveLength(generationCount);
});
it("refreshes only the authorized project before selecting the PDF and persists freshness evidence", async () => {
  state.refresh.mockImplementation(async () => {
    expect(state.reads.some(row => row.table === "project_documents")).toBe(false);
    state.documents = [{ ...state.documents[0], id: "newest-email-pdf", title: "Newer Plans" }];
    return { uploaded: 1, failed: 0, deferred: 0, needsReview: 0, needsReconnect: false, error: null };
  });
  const report = await (await checkSpecCompletion(request())).json();
  expect(state.refresh).toHaveBeenCalledWith(userId, { projectId, budgetMs: 45000, maxMessages: 12 });
  expect(report.document.id).toBe("newest-email-pdf");
  expect(report.document_refresh).toMatchObject({ status: "checked", uploaded: 1 });
  expect(state.writes[0].patch.report.document_refresh).toEqual(report.document_refresh);
});
it.each([{ needsReconnect: true }, { failed: 1 }, { deferred: 1 }, { error: "Gmail unavailable" }])("does not charge for a plan comparison after an incomplete refresh: %j", async failure => {
  state.refresh.mockResolvedValue({ uploaded: 0, failed: 0, deferred: 0, needsReconnect: false, error: null, ...failure });
  const report = await (await checkSpecCompletion(request())).json();
  expect(report.plan_status).toBe("unavailable");
  expect(report.document_refresh.status).toBe("incomplete");
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.download).not.toHaveBeenCalled();
  expect(report.findings.every((row: any) => row.source === "details")).toBe(true);
});
it("reports a failed refresh without starting paid AI work", async () => {
  state.refresh.mockRejectedValue(new Error("failed"));
  const report = await (await checkSpecCompletion(request())).json();
  expect(report.document_refresh.status).toBe("unavailable");
  expect(state.fetch).not.toHaveBeenCalled();
});
it("warns about uncertain matches without claiming the latest version is guaranteed", async () => {
  state.refresh.mockResolvedValue({ uploaded: 0, failed: 0, deferred: 0, needsReview: 2, needsReconnect: false, error: null });
  const report = await (await checkSpecCompletion(request())).json();
  expect(report.document_refresh.message).toContain("latest version cannot be guaranteed");
  expect(report.plan_status).toBe("checked");
});
it("loads saved results without starting AI and preserves old findings for removed rooms", async () => {
  state.saved = { report: { checked_at: "earlier", document: null }, source_signature: "old", issues: {
    old: { key: "old", status: "completed", room_name: "Former room", finding: { room_id: "removed", field: "quantity" } },
  } };
  const result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json();
  expect(result.issues[0].status).toBe("completed"); expect(result.stale).toBe(true);
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
});
it("hides optional missing-price warnings from saved reviews without another plan check or lost decisions", async () => {
  state.items.push({ ...state.items[0], id: 'counter', item_label: 'Countertop', category: 'Countertops' });
  const gap = (id: string) => ({ item_id: id, room_id: roomId, field: 'price', source: 'details' });
  state.saved = { report: { checked_at: 'earlier', document: null }, source_signature: 'old', issues: {
    counter: { key: 'counter', status: 'open', finding: gap('counter') },
    sink: { key: 'sink', status: 'open', finding: gap('sink') },
    completed: { key: 'completed', status: 'completed', finding: gap('counter') },
  } };
  const result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: 'load' }))).json();
  expect(result.issues.map((issue: any) => issue.key)).toEqual(['sink', 'completed']);
  expect(state.saved.issues.counter.status).toBe('open');
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled();
});
it("retires old blanket dimension flags from open results while retaining team decisions", async () => {
  const gap = { item_id: 'sink', room_id: roomId, field: 'dimensions', source: 'details' };
  state.saved = { report: { checked_at: 'earlier', document: null }, source_signature: 'old', issues: {
    open: { key: 'open', status: 'open', finding: gap },
    completed: { key: 'completed', status: 'completed', finding: gap },
    dismissed: { key: 'dismissed', status: 'not_needed', finding: gap },
  } };
  let result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: 'load' }))).json();
  expect(result.issues.map((issue: any) => issue.status)).toEqual(['completed', 'not_needed']);
  state.items[0].product = { size_options: ['24 in', '30 in'] };
  result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: 'load' }))).json();
  expect(result.issues).toHaveLength(3); expect(state.fetch).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});
it("removes saved countertop price and price-basis warnings from both detail and plan checks, preserving completed history", async () => {
  state.items.push({ ...state.items[0], id: "counter", item_label: "Countertop", category: "Countertops", product: { name: "Quartz slab", price: "$50-$60", price_unit: null } });
  const finding = (source: string, field: string) => ({ item_id: "counter", room_id: roomId, field, source });
  state.saved = { report: { checked_at: "earlier", document: null, findings: [finding("details", "price"), finding("plans", "price")] }, source_signature: "old", issues: {
    detail: { key: "detail", status: "open", finding: finding("details", "price") },
    basis: { key: "basis", status: "open", finding: finding("details", "price_unit") },
    plan: { key: "plan", status: "open", finding: finding("plans", "price") },
    completed: { key: "completed", status: "completed", finding: finding("plans", "price") },
  } };
  const result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json();
  expect(result.issues.map((issue: any) => issue.key)).toEqual(["completed"]); expect(result.report.findings).toEqual([]);
  expect(state.saved.issues.plan.status).toBe("open"); expect(state.rpc).not.toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled();
});
it("recognizes current saved results and detects later material edits without an AI call", async () => {
  const doc = { id: state.documents[0].id, title: state.documents[0].title, updated_at: state.documents[0].updated_at };
  state.saved = { report: { checked_at: "earlier", document: doc }, source_signature: completionSourceSignature(state.items, state.rooms, doc), issues: {} };
  expect((await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json()).stale).toBe(false);
  state.items[0].quantity = 2;
  expect((await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json()).stale).toBe(true);
  expect(state.fetch).not.toHaveBeenCalled();
});
it.each(["Client", "GC", "Builder", "Contractor"])("denies %s saved-review reads and status changes", async role => {
  state.profile.role = role;
  for (const action of ["load", "status"])
    expect((await savedSpecCompletionRequest(request({ project_id: projectId, action }))).status).toBe(403);
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.reads.some(row => row.table === "spec_completion_reviews")).toBe(false);
});
it("rejects forged findings, invalid statuses and missing update versions", async () => {
  for (const extra of [{ report: {} }, { action: "status", issue_key: "invalid", status: "completed", expected_updated_at: null },
    { action: "status", issue_key: "a".repeat(64), status: "deleted", expected_updated_at: null },
    { action: "status", issue_key: "a".repeat(64), status: "completed" }])
    expect((await savedSpecCompletionRequest(request({ project_id: projectId, action: "load", ...extra }))).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("sends only a project-scoped status patch and detects concurrent changes", async () => {
  const body = { project_id: projectId, action: "status", issue_key: "a".repeat(64), status: "completed", expected_updated_at: null };
  state.rpc.mockResolvedValue({ data: false, error: null });
  expect((await savedSpecCompletionRequest(request(body))).status).toBe(409);
  expect(state.rpc).toHaveBeenCalledWith("set_spec_completion_issue_status", { p_project_id: projectId, p_user_id: userId,
    p_issue_key: body.issue_key, p_status: "completed", p_expected_updated_at: null });
  state.rpc.mockResolvedValue({ data: true, error: null });
  expect((await savedSpecCompletionRequest(request(body))).status).toBe(200);
  expect(state.fetch).not.toHaveBeenCalled();
});
it("reports storage setup failures without starting an AI call", async () => {
  state.storageError = { code: "42P01" };
  const response = await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }));
  expect(response.status).toBe(503); expect(state.fetch).not.toHaveBeenCalled();
});
it("refuses paid checks when persistent storage is not installed", async () => {
  state.storageError = { code: "42P01" };
  await expect(checkSpecCompletion(request())).rejects.toThrow("database update");
  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});
it("does not overwrite a newer saved review when an older check finishes late", async () => {
  state.refresh.mockImplementation(async () => {
    state.saved = { report: { checked_at: "2099-01-01T00:00:00Z", plan_status: "checked", findings: [] },
      issues: {}, checked_at: "2099-01-01T00:00:00Z", updated_at: "2099-01-01T00:00:00Z" };
    return { uploaded: 0, failed: 0, deferred: 0, needsReconnect: false };
  });
  expect((await checkSpecCompletion(request())).status).toBe(409);
  expect(state.fetch).not.toHaveBeenCalled();
});
it.each(["Client", "Contractor", "Builder", "GC"])("denies %s before reading project data or PDFs", async role => {
  state.profile.role = role; expect((await checkSpecCompletion(request())).status).toBe(403);
  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.download).not.toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled();
  expect(state.reads.some(row => row.table === "material_items")).toBe(false);
});
it("requires active auth and limits employees to assigned projects", async () => {
  expect((await checkSpecCompletion(request(undefined, false))).status).toBe(401);
  state.authenticated = false; expect((await checkSpecCompletion(request())).status).toBe(401);
  state.authenticated = true; state.profile.is_active = false;
  expect((await checkSpecCompletion(request())).status).toBe(403);
  state.profile = { role: "employee", is_active: true, can_view_all_projects: false }; state.assigned = false;
  expect((await checkSpecCompletion(request())).status).toBe(403);
  expect(boardSync).not.toHaveBeenCalled();
});
it("does not accept caller-provided selections, arbitrary PDF URLs or document IDs", async () => {
  for (const extra of [{ items: [] }, { file_url: "https://evil.test" }, { document_id: "older" }])
    expect((await checkSpecCompletion(request({ project_id: projectId, ...extra }))).status).toBe(400);
  expect(state.download).not.toHaveBeenCalled();
  state.project = false; expect((await checkSpecCompletion(request())).status).toBe(404);
});
it("still completes data-gap checks when plans are absent, credits are exhausted or output is incomplete", async () => {
  state.fetch.mockResolvedValue(Response.json({ error: { code: "credit_balance_exhausted" } }, { status: 429 }));
  let result = await (await checkSpecCompletion(request())).json();
  expect(result.plan_status).toBe("unavailable"); expect(result.plan_message).toContain("needs AI credits");
  expect(result.findings).toHaveLength(5); expect(result.findings.every((row: any) => row.source === "details")).toBe(true);
  state.saved.checked_at = state.saved.report.checked_at = "2026-01-01T00:00:00Z";
  state.fetch.mockResolvedValue(Response.json({ status: "failed", error: { code: "credit_balance_exhausted" } }));
  result = await (await checkSpecCompletion(request())).json();
  expect(result.plan_status).toBe("unavailable"); expect(result.plan_message).toContain("needs AI credits");
  state.saved.checked_at = state.saved.report.checked_at = "2026-01-01T00:00:00Z";
  state.fetch.mockResolvedValue(Response.json({ status: "incomplete", output_text: "{}" }));
  result = await (await checkSpecCompletion(request())).json(); expect(result.plan_status).toBe("unavailable");
  state.saved.checked_at = state.saved.report.checked_at = "2026-01-01T00:00:00Z";
  state.documents = []; result = await (await checkSpecCompletion(request())).json();
  expect(result.plan_status).toBe("no_document"); expect(result.findings).toHaveLength(5);
});
it("filters stale board selections and refreshes quantities on each requested check", async () => {
  state.items.push({ ...state.items[0], id: "stale", source_board_id: projectId, source_board_page_id: "p", source_board_element_id: "deleted" });
  state.board = { pages: [{ id: "p", elements: [] }] };
  let result = await (await checkSpecCompletion(request())).json(); expect(result.item_count).toBe(1);
  expect(result.findings.some((row: any) => row.item_id === "stale")).toBe(false);
  state.items[0].quantity = 2;
  result = await (await checkSpecCompletion(request())).json();
  expect(result.findings.some((row: any) => row.field === "quantity")).toBe(false);
  expect(state.fetch).toHaveBeenCalledTimes(2);
});
it("fails rather than falsely completing when selection reads fail", async () => {
  state.dataError = true;
  await expect(checkSpecCompletion(request())).rejects.toThrow();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("rejects findings when selections or the latest document change during a scan", async () => {
  state.fetch.mockImplementation(async () => {
    state.documents = [{ ...state.documents[0], id: "new-plan" }];
    return completed();
  });
  const response = await checkSpecCompletion(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("changed during");
});
it("cannot read a PDF belonging to another project", async () => {
  state.documents[0].file_url = state.documents[0].file_url.replace(projectId, roomId);
  const result = await (await checkSpecCompletion(request())).json();
  expect(result.plan_status).toBe("unavailable"); expect(result.findings).toHaveLength(5);
  expect(state.download).not.toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled();
});
it("does not lose material records beyond the database page size", async () => {
  state.documents = [];
  state.items = Array.from({ length: 1001 }, (_, index) => ({ ...state.items[0], id: `item-${index}` }));
  const result = await (await checkSpecCompletion(request())).json();
  expect(result.item_count).toBe(1001); expect(result.findings).toHaveLength(5005);
});
