import { beforeEach, afterEach, expect, it, vi } from "vitest";
const projectId = "527d1356-919b-48b9-877e-1924c766282b";
const itemId = "0033186c-a2e6-417f-a50f-37f5390f5cf5";
const roomId = "4204f2d1-e10c-4d98-a01b-350cf7d8cafe";
const state = vi.hoisted(() => ({ active: true, role: "Admin", assigned: true, authenticated: true,
  item: null as any, room: null as any, document: null as any, board: null as any, fetch: vi.fn(), download: vi.fn(), reads: [] as any[] }));
vi.mock("pdf-lib", () => ({ PDFDocument: { load: async () => ({ getPageCount: () => 14 }) } }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "staff" } : null }, error: null }) },
  storage: { from: () => ({ download: state.download }) },
  from: (table: string) => {
    const filters: any = {};
    const get = () => {
      state.reads.push({ table, filters });
      const scoped = filters.project_id === projectId;
      const data = table === "user_profiles" ? { role: state.role, is_active: state.active, can_view_all_projects: false } :
        table === "projects" ? (filters.id === projectId ? { id: projectId } : null) :
        table === "user_project_assignments" ? (state.assigned && scoped ? { project_id: projectId } : null) :
        !scoped ? null : table === "material_items" ? (filters.id === itemId ? state.item : null) :
        table === "rooms" ? (filters.id === roomId ? state.room : null) :
        table === "design_boards" ? { board_state: state.board } : state.document ? [state.document] : [];
      return { data, error: null };
    };
    const q: any = { select: () => q, eq: (key: string, value: any) => { filters[key] = value; return q; },
      is: (key: string, value: any) => { filters[key] = value; return q; }, order: () => q, limit: () => q,
      maybeSingle: async () => get(), then: (resolve: any) => Promise.resolve(get()).then(resolve) };
    return q;
  },
} }));
import { suggestPlanDimensions } from "@/lib/planDimensionSuggestion.server";
const finding = { item_id: itemId, room_id: roomId, field: "dimensions", confidence: "high", page: 10, sheet: "ID2.5",
  evidence: "The mirror is labelled with a 30-inch width and 36-inch height in the proposed bathroom elevation.",
  value: "Width: 30 in; Height: 36 in", explicit_specification: true, exact_material_match: true,
  dimension_scope: "proposed_layout", conflicting_dimensions: false };
const request = (extra: any = {}, token = true) => new Request("https://studio.test/api/suggest-plan-dimensions", {
  method: "POST", headers: { ...(token ? { Authorization: "Bearer TEST_ONLY_TOKEN" } : {}), "Content-Type": "application/json" },
  body: JSON.stringify({ project_id: projectId, item_id: itemId, ...extra }) });
beforeEach(() => {
  vi.clearAllMocks(); state.active = true; state.role = "Admin"; state.assigned = true; state.authenticated = true; state.reads = [];
  state.item = { id: itemId, project_id: projectId, room_id: roomId, item_label: "Mirror", is_required: false,
    product_id: "product", not_needed: false, product: { name: "Selected mirror", dimensions: null } };
  state.room = { id: roomId, name: "Primary Bath" }; state.board = null;
  state.document = { id: "latest", title: "Latest Construction Plans", updated_at: "v1", file_size: 20,
    file_url: `https://example.supabase.co/storage/v1/object/public/project-files/${projectId}/construction-docs/latest.pdf` };
  state.download.mockResolvedValue({ data: new Blob(["fixture-pdf"]), error: null });
  state.fetch.mockResolvedValue(Response.json({ status: "completed", output_text: JSON.stringify({ findings: [finding] }) }));
  vi.stubGlobal("fetch", (url: string, options: unknown) => url.endsWith("/input_tokens") ?
    Promise.resolve(Response.json({ input_tokens: 50000 })) : state.fetch(url, options));
  vi.stubEnv("OPENAI_API_KEY", "TEST_ONLY_KEY"); vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("finds an explicit mirror size in the latest plans, labels it as planned and saves nothing", async () => {
  const result = await (await suggestPlanDimensions(request())).json();
  expect(result).toMatchObject({ status: "suggested", dimensions: "Width: 30 in; Height: 36 in", dimension_scope: "proposed_layout", page: 10, sheet: "ID2.5" });
  expect(result.message).toContain("Confirm the selected product"); expect(state.item.product.dimensions).toBeNull();
  expect(state.reads.find(row => row.table === "project_documents").filters).toMatchObject({ project_id: projectId, document_type: "Construction Doc", superseded_by_document_id: null });
  const body = JSON.parse(state.fetch.mock.calls[0][1].body);
  expect(body.instructions).toContain(`TARGETED DIMENSION REVIEW: return only dimensions findings for item_id ${itemId}`);
  expect(body.instructions).toContain("not its vanity"); expect(body.store).toBe(false);
  expect(body).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "high" }, service_tier: "default", max_output_tokens: 12000 });
  const input = JSON.parse(body.input[0].content[0].text);
  expect(input.selections).toHaveLength(1); expect(input.rooms).toEqual([state.room]);
});
it("distinguishes an explicitly specified product size from a planned size", async () => {
  state.fetch.mockResolvedValue(Response.json({ status: "completed", output_text: JSON.stringify({ findings: [{ ...finding, dimension_scope: "product_specification" }] }) }));
  const result = await (await suggestPlanDimensions(request())).json();
  expect(result.dimension_scope).toBe("product_specification"); expect(result.message).toContain("Verify the selected product/variant");
});
it.each(["Client", "Builder", "GC", "Contractor"])("denies %s before reading the PDF", async role => {
  state.role = role; expect((await suggestPlanDimensions(request())).status).toBe(403);
  expect(state.download).not.toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled();
});
it("requires active authentication and employee assignment", async () => {
  expect((await suggestPlanDimensions(request({}, false))).status).toBe(401);
  state.authenticated = false; expect((await suggestPlanDimensions(request())).status).toBe(401);
  state.authenticated = true; state.active = false; expect((await suggestPlanDimensions(request())).status).toBe(403);
  state.active = true; state.role = "Employee"; state.assigned = false;
  expect((await suggestPlanDimensions(request())).status).toBe(403);
});
it("rejects caller-supplied PDFs, other projects, unchosen selections and populated dimensions", async () => {
  expect((await suggestPlanDimensions(request({ file_url: "https://evil.test" }))).status).toBe(400);
  expect((await suggestPlanDimensions(request({ project_id: roomId }))).status).toBe(404);
  state.item.not_needed = true; expect((await suggestPlanDimensions(request())).status).toBe(404);
  state.item.not_needed = false; state.item.product.dimensions = '24" x 36"';
  expect((await suggestPlanDimensions(request())).status).toBe(409); expect(state.fetch).not.toHaveBeenCalled();
});
it.each([{ ...finding, value: "Standard mirror size" }, { ...finding, page: 15 }, { ...finding, confidence: "medium" },
  { ...finding, explicit_specification: false }, { ...finding, item_id: projectId }, { ...finding, room_id: itemId },
  { ...finding, conflicting_dimensions: true }])("leaves dimensions unknown for unsupported output %j", async row => {
  state.fetch.mockResolvedValue(Response.json({ status: "completed", output_text: JSON.stringify({ findings: [row] }) }));
  const result = await (await suggestPlanDimensions(request())).json();
  expect(result.status).toBe("not_found"); expect(result.dimensions).toBe("");
});
it("reports missing plans and unavailable credits clearly", async () => {
  state.document = null;
  expect((await (await suggestPlanDimensions(request())).json()).message).toContain("No current construction document");
  expect(state.fetch).not.toHaveBeenCalled();
  state.document = { id: "latest", title: "Plans", updated_at: "v1", file_size: 20,
    file_url: `https://example.supabase.co/storage/v1/object/public/project-files/${projectId}/construction-docs/latest.pdf` };
  state.fetch.mockResolvedValue(Response.json({ error: { code: "credit_balance_exhausted" } }, { status: 429 }));
  const result = await (await suggestPlanDimensions(request())).json(); expect(result.status).toBe("unavailable");
  expect(result.message).toContain("need AI credits"); expect(result.dimensions).toBe("");
});
it("rejects findings when the source document or selection changes during review", async () => {
  state.fetch.mockImplementation(async () => { state.document = { ...state.document, id: "new" };
    return Response.json({ status: "completed", output_text: JSON.stringify({ findings: [finding] }) }); });
  expect((await suggestPlanDimensions(request())).status).toBe(409);
});
it("does not suggest dimensions for an obsolete board selection", async () => {
  Object.assign(state.item, { source_board_id: projectId, source_board_page_id: "page", source_board_element_id: "deleted" });
  state.board = { pages: [{ id: "page", elements: [] }] };
  expect((await suggestPlanDimensions(request())).status).toBe(409); expect(state.fetch).not.toHaveBeenCalled();
});
