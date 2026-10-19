import { afterEach, beforeEach, expect, it, vi } from "vitest";
const projectId = "527d1356-919b-48b9-877e-1924c766282b";
const docId = "cd3700c1-2889-43f9-b7a7-3e2af36036b1";
const roomId = "9015b5ff-6343-462b-9539-9e62ed1c52d0";
const state = vi.hoisted(() => ({ authenticated: true, profile: {} as any, assigned: true,
  documents: [] as any[], rooms: [] as any[], items: [] as any[], reads: [] as any[], download: vi.fn(), fetch: vi.fn(), load: vi.fn(), tile: vi.fn() }));
vi.mock("@/lib/tileInstallation.server", () => ({ checkTileInstallation: state.tile }));
vi.mock("@/lib/materialCatalogFit.server", () => ({ loadCatalogDocumentFit: state.load }));
vi.mock("pdf-lib", () => ({ PDFDocument: { load: async () => ({ getPageCount: () => 20 }) } }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "staff" } : null }, error: null }) },
  storage: { from: () => ({ download: state.download }) },
  from: (table: string) => {
    const filters: any = {};
    const query: any = { select: () => query, eq: (key: string, value: string) => { filters[key] = value; return query; },
      is: (key: string, value: any) => { filters[key] = value; return query; }, order: () => query, limit: () => query, range: () => query,
      maybeSingle: async () => table === "design_boards" ? { data: { board_state: null }, error: null } : table === "user_profiles" ? { data: state.profile, error: null } :
        { data: state.assigned ? { project_id: projectId } : null, error: null },
      then: (resolve: any) => { state.reads.push({ table, filters }); return Promise.resolve({
        data: filters.project_id === projectId ? (table === "rooms" ? state.rooms : table === "material_items" ? state.items : state.documents) : [], error: null,
      }).then(resolve); },
    };
    return query;
  },
} }));
import { checkMaterialPlans, cleanBathroomPlanEvidence, projectDocumentStoragePath } from "@/lib/materialPlanCheck.server";
let version = 0;
const evidence = { room_id: roomId, shower: "absent", confidence: "high", complete_layout: true,
  page: 4, sheet: "ID2.1", evidence: "Full proposed bathroom layout has toilet and vanity, no shower or tub." };
const request = (body: any = { project_id: projectId, document_id: docId }, token = true) =>
  new Request("https://studio.test/api/check-material-plans", { method: "POST",
    headers: { ...(token ? { Authorization: "Bearer TEST_ONLY_TOKEN" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); state.authenticated = true; state.assigned = true;
  state.items = []; state.tile.mockResolvedValue({ version: "tile-installation-v1", findings: [], checked_items: 0, plan_status: "no_document" });
  state.profile = { role: "Admin", is_active: true, can_view_all_projects: true };
  state.documents = [{ id: docId, title: "Latest plans", updated_at: `version-${++version}`, file_size: 12,
    file_url: `https://example.supabase.co/storage/v1/object/public/project-files/${projectId}/construction-docs/latest.pdf` }];
  state.rooms = [{ id: roomId, name: "Bathroom 3" }, { id: "kitchen", name: "Kitchen" }]; state.reads = [];
  state.download.mockResolvedValue({ data: new Blob(["fixture-pdf"]), error: null });
  state.fetch.mockResolvedValue(Response.json({ status: "completed", output_text: JSON.stringify({ rooms: [evidence] }) }));
  state.load.mockImplementation(async (project: string, document: any) => {
    projectDocumentStoragePath(document.file_url, project, "https://example.supabase.co");
    return { status: "checked", bathroom_layouts: cleanBathroomPlanEvidence([evidence], state.rooms.filter(r => /bath|powder/i.test(r.name)), 20) };
  });
  vi.stubGlobal("fetch", state.fetch); vi.stubEnv("OPENAI_API_KEY", "TEST_ONLY_KEY"); vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("checks installation details using current server-selected documents and notes, without a paid layout scan", async () => {
  state.items = [{ id: "tile", project_id: projectId, room_id: roomId, item_label: "Shower tile", is_required: false, notes: "Vertical straight set" }];
  const response = await checkMaterialPlans(request({ project_id: projectId, action: "tile_details" }));
  expect(response.status).toBe(200);
  expect(state.tile).toHaveBeenCalledWith(projectId, state.items, state.rooms, null, state.documents[0]);
  expect(state.load).not.toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled();
});
it("checks notes even with no construction attachment", async () => {
  state.documents = [];
  const response = await checkMaterialPlans(request({ project_id: projectId, action: "tile_details" }));
  expect(response.status).toBe(200);
  expect(state.tile).toHaveBeenCalledWith(projectId, [], state.rooms, null, null);
});
it("authorizes installation reviews before reading any project sources", async () => {
  state.profile = { role: "Client", is_active: true };
  expect((await checkMaterialPlans(request({ project_id: projectId, action: "tile_details" }))).status).toBe(403);
  expect(state.tile).not.toHaveBeenCalled(); expect(state.reads).toEqual([]);
  state.profile = { role: "Employee", is_active: true, can_view_all_projects: false }; state.assigned = false;
  expect((await checkMaterialPlans(request({ project_id: projectId, action: "tile_details" }))).status).toBe(403);
  expect(state.tile).not.toHaveBeenCalled();
});

it("checks the latest project plan and returns room-specific, page-supported evidence", async () => {
  const response = await checkMaterialPlans(request()); const result = await response.json();
  expect(result.status).toBe("checked"); expect(result.rooms).toHaveLength(1);
  expect(result.rooms[0]).toMatchObject({ room_id: roomId, shower: "absent", page: 4 });
  expect(state.reads[0]).toMatchObject({ table: "project_documents", filters: {
    project_id: projectId, document_type: "Construction Doc", superseded_by_document_id: null,
  } });
  expect(state.load).toHaveBeenCalledWith(projectId, state.documents[0], state.rooms, true);
  expect(state.fetch).not.toHaveBeenCalled();
});
it("routes layout reads through the persistent shared extraction instead of direct AI calls", async () => {
  await Promise.all([checkMaterialPlans(request()), checkMaterialPlans(request())]);
  expect(state.load).toHaveBeenCalledTimes(2);
  state.documents[0].updated_at = "new-version";
  await checkMaterialPlans(request()); expect(state.load.mock.calls[2][1].updated_at).toBe("new-version");
  state.rooms[0].name = "Guest Bathroom";
  await checkMaterialPlans(request()); expect(state.load.mock.calls[3][2][0].name).toBe("Guest Bathroom");
  expect(state.fetch).not.toHaveBeenCalled();
});
it.each(["Client", "Contractor", "GC", "Builder"])("denies external %s access before reading PDFs", async role => {
  state.profile.role = role; expect((await checkMaterialPlans(request())).status).toBe(403);
  expect(state.download).not.toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled();
});
it("rejects missing, expired and inactive sessions", async () => {
  expect((await checkMaterialPlans(request(undefined, false))).status).toBe(401);
  state.authenticated = false; expect((await checkMaterialPlans(request())).status).toBe(401);
  state.authenticated = true; state.profile.is_active = false;
  expect((await checkMaterialPlans(request())).status).toBe(403);
});
it("limits restricted employees to assigned projects", async () => {
  state.profile = { role: "Employee", is_active: true, can_view_all_projects: false }; state.assigned = false;
  expect((await checkMaterialPlans(request())).status).toBe(403);
  expect(state.download).not.toHaveBeenCalled();
  state.assigned = true; expect((await checkMaterialPlans(request())).status).toBe(200);
});
it("rejects stale document IDs, cross-project documents, and caller-supplied URLs", async () => {
  expect((await checkMaterialPlans(request({ project_id: projectId, document_id: roomId }))).status).toBe(409);
  const other = await checkMaterialPlans(request({ project_id: roomId, document_id: docId }));
  expect((await other.json()).status).toBe("no_document");
  expect((await checkMaterialPlans(request({ project_id: projectId, document_id: docId, file_url: "https://evil.test" }))).status).toBe(400);
  expect(state.download).not.toHaveBeenCalled();
});
it("leaves shower suggestions undecided for missing or unreadable PDFs", async () => {
  state.documents = []; expect((await (await checkMaterialPlans(request())).json()).status).toBe("no_document");
  state.documents = [{ id: docId, updated_at: "broken", file_url: "https://evil.test/doc.pdf" }];
  const result = await (await checkMaterialPlans(request())).json();
  expect(result.status).toBe("unavailable"); expect(result.rooms).toEqual([]);
  expect(state.fetch).not.toHaveBeenCalled();
});
it("retains uncertainty when the shared extraction is unavailable or cannot be loaded", async () => {
  state.load.mockResolvedValue({ status: "unavailable", bathroom_layouts: [] });
  expect((await (await checkMaterialPlans(request())).json()).status).toBe("unavailable");
  state.load.mockRejectedValue(new Error("timeout"));
  expect((await (await checkMaterialPlans(request())).json()).status).toBe("unavailable");
});
it("clearly reports exhausted AI credits without claiming the plans were reviewed", async () => {
  state.load.mockResolvedValue({ status: "unavailable", message: "Plan review needs AI credits. Catalog fit remains unconfirmed." });
  const result = await (await checkMaterialPlans(request())).json();
  expect(result.status).toBe("unavailable");
  expect(result.rooms).toEqual([]);
  expect(result.message).toContain("needs AI credits");
});
it("returns pending status without accepting incomplete layout evidence", async () => {
  state.load.mockResolvedValue({ status: "checking", bathroom_layouts: [evidence] });
  const result = await (await checkMaterialPlans(request())).json();
  expect(result.status).toBe("checking");
  expect(result.rooms).toEqual([]);
  expect(state.fetch).not.toHaveBeenCalled();
});
it.each([{ ...evidence, complete_layout: false }, { ...evidence, confidence: "medium" },
  { ...evidence, page: 21 }, { ...evidence, evidence: "" }, { ...evidence, room_id: "wrong-room" }])(
  "does not accept unsupported absence: %j", row => {
    expect(cleanBathroomPlanEvidence([row], [{ id: roomId, name: "Bathroom 3" }], 20)[0].shower).toBe("unknown");
  });
it("does not combine conflicting findings for the same room", () => {
  expect(cleanBathroomPlanEvidence([evidence, { ...evidence, shower: "present" }], state.rooms, 20)[0].shower).toBe("unknown");
});
it("accepts a positively identified tub/shower combination", () => {
  expect(cleanBathroomPlanEvidence([{ ...evidence, shower: "present", complete_layout: false }], state.rooms, 20)[0].shower).toBe("present");
});
it("permits only this project's stored construction PDF", () => {
  const good = state.documents[0].file_url;
  expect(projectDocumentStoragePath(good, projectId, "https://example.supabase.co")).toContain(`${projectId}/construction-docs/`);
  expect(() => projectDocumentStoragePath(good, roomId, "https://example.supabase.co")).toThrow();
  expect(() => projectDocumentStoragePath("https://evil.test/pdf", projectId, "https://example.supabase.co")).toThrow();
});
