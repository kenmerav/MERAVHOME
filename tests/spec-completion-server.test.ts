import { afterEach, beforeEach, expect, it, vi } from "vitest";
const projectId = "527d1356-919b-48b9-877e-1924c766282b";
const roomId = "0033186c-a2e6-417f-a50f-37f5390f5cf5";
const userId = "4204f2d1-e10c-4d98-a01b-350cf7d8cafe";
const state = vi.hoisted(() => ({ authenticated: true, profile: {} as any, assigned: true, project: true,
  documents: [] as any[], rooms: [] as any[], items: [] as any[], board: null as any,
  reads: [] as any[], download: vi.fn(), fetch: vi.fn(), rpc: vi.fn(), dataError: false, storageError: null as any, saved: null as any }));
vi.mock("pdf-lib", () => ({ PDFDocument: { load: async () => ({ getPageCount: () => 14 }) } }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: userId } : null }, error: null }) },
  storage: { from: () => ({ download: state.download }) },
  rpc: state.rpc,
  from: (table: string) => {
    const filters: any = {}; const orders: any[] = []; let slice: number[] | null = null;
    const get = () => { state.reads.push({ table, filters, orders });
      if (table === "user_profiles") return { data: state.profile, error: null };
      if (table === "user_project_assignments") return { data: state.assigned ? { project_id: projectId } : null, error: null };
      if (table === "projects") return { data: state.project ? { id: projectId } : null, error: null };
      if (table === "design_boards") return { data: { board_state: state.board }, error: null };
      if (table === "spec_completion_reviews") return { data: state.saved, error: state.storageError };
      let data = table === "rooms" ? state.rooms : table === "material_items" ? state.items : state.documents;
      if (filters.project_id !== projectId) data = [];
      if (slice) data = data.slice(slice[0], slice[1] + 1);
      return { data, error: state.dataError ? new Error("read failed") : null };
    };
    const query: any = { select: () => query, eq: (key: string, value: any) => { filters[key] = value; return query; },
      is: (key: string, value: any) => { filters[key] = value; return query; }, order: (key: string, options: any) => { orders.push([key, options]); return query; },
      range: (start: number, end: number) => { slice = [start, end]; return query; }, limit: () => query,
      maybeSingle: async () => get(), then: (resolve: any) => Promise.resolve(get()).then(resolve) };
    return query;
  },
} }));
import { checkSpecCompletion } from "@/lib/specCompletion.server";
import { savedSpecCompletionRequest } from "@/lib/savedSpecCompletionApi.server";
import { completionSourceSignature } from "@/lib/savedSpecCompletion.server";
const request = (body: any = { project_id: projectId }, token = true) => new Request("https://studio.test/api/check-spec-completion", {
  method: "POST", headers: { ...(token ? { Authorization: "Bearer TEST_ONLY_TOKEN" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); state.authenticated = true; state.assigned = true; state.project = true; state.dataError = false;
  state.storageError = null; state.saved = null; state.rpc.mockResolvedValue({ data: null, error: null });
  state.profile = { role: "Admin", is_active: true, can_view_all_projects: true };
  state.rooms = [{ id: roomId, name: "Bathroom 2" }]; state.board = null; state.reads = [];
  state.documents = [{ id: "latest", title: "Latest Plans", updated_at: "v1", file_size: 20,
    file_url: `https://example.supabase.co/storage/v1/object/public/project-files/${projectId}/construction-docs/latest.pdf` }];
  state.items = [{ id: "sink", project_id: projectId, room_id: roomId, item_label: "Sink", is_required: false,
    quantity: null, color: null, product_id: null, not_needed: false }];
  state.download.mockResolvedValue({ data: new Blob(["fixture-pdf"]), error: null });
  state.fetch.mockResolvedValue(Response.json({ status: "completed", output_text: JSON.stringify({ findings: [{
    item_id: "sink", room_id: roomId, field: "quantity", confidence: "high", page: 2, sheet: "ID1", evidence: "Two identical selected sinks in proposed vanity.",
    quantity: 2, quantity_unit: "count", count_scope: "exact_material", exact_material_match: true,
  }] }) }));
  vi.stubGlobal("fetch", (url: string, options: unknown) => url.endsWith("/input_tokens") ?
    Promise.resolve(Response.json({ input_tokens: 50000 })) : state.fetch(url, options));
  vi.stubEnv("OPENAI_API_KEY", "TEST_ONLY_KEY"); vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
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
  expect(state.rpc).toHaveBeenCalledWith("save_spec_completion_review", expect.objectContaining({ p_project_id: projectId, p_report: expect.objectContaining({ plan_status: "checked" }) }));
});
it("loads saved results without starting AI and preserves old findings for removed rooms", async () => {
  state.saved = { report: { checked_at: "earlier", document: null }, source_signature: "old", issues: {
    old: { key: "old", status: "completed", room_name: "Former room", finding: { room_id: "removed", field: "quantity" } },
  } };
  const result = await (await savedSpecCompletionRequest(request({ project_id: projectId, action: "load" }))).json();
  expect(result.issues[0].status).toBe("completed"); expect(result.stale).toBe(true);
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
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
  expect(state.fetch).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});
it("does not overwrite a newer saved review when an older check finishes late", async () => {
  state.rpc.mockResolvedValue({ error: { code: "40001" } });
  expect((await checkSpecCompletion(request())).status).toBe(409);
});
it.each(["Client", "Contractor", "Builder", "GC"])("denies %s before reading project data or PDFs", async role => {
  state.profile.role = role; expect((await checkSpecCompletion(request())).status).toBe(403);
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
  state.fetch.mockResolvedValue(Response.json({ status: "incomplete", output_text: "{}" }));
  result = await (await checkSpecCompletion(request())).json(); expect(result.plan_status).toBe("unavailable");
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
    return Response.json({ status: "completed", output_text: JSON.stringify({ findings: [] }) });
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
