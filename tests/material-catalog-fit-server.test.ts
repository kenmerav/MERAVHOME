import { beforeEach, afterEach, expect, it, vi } from "vitest";
const projectId = "9015b5ff-6343-462b-9539-9e62ed1c52d0";
const room = { id: "de252929-38a3-4e2f-9ae9-4acc810818f3", name: "Powder Bath" };
const state = vi.hoisted(() => ({
  cache: null as any,
  document: null as any,
  items: [] as any[],
  rooms: [] as any[],
  board: null as any,
  tasks: [] as Promise<unknown>[],
  reads: [] as any[],
  writes: [] as any[],
  download: vi.fn(),
  generate: vi.fn(),
  retrieve: vi.fn(),
  conflict: false,
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (task: Promise<unknown>) => state.tasks.push(task),
}));
vi.mock("pdf-lib", () => ({ PDFDocument: { load: async () => ({ getPageCount: () => 26 }) } }));
vi.mock("@/lib/specReviewAI.server", () => ({
  fetchSpecReview: state.generate,
  retrieveSpecReview: state.retrieve,
  CreditsUnavailable: class extends Error {},
  SpecReviewCostError: class extends Error {},
}));
vi.mock("@/lib/constructionDocumentPath.server", () => ({
  projectDocumentStoragePath: (url: string, project: string) => {
    if (!url.includes(project + "/construction-docs/")) throw Error("Invalid path");
    return project + "/construction-docs/plan.pdf";
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    storage: { from: () => ({ download: state.download }) },
    from: (table: string) => {
      const filters: any = {};
      let patch: any = null,
        insert: any = null;
      const get = () => {
        state.reads.push({ table, filters });
        if (table === "project_documents")
          return { data: state.document ? [state.document] : [], error: null };
        if (table === "material_items") return { data: state.items, error: null };
        if (table === "rooms") return { data: state.rooms, error: null };
        if (table === "design_boards") return { data: { board_state: state.board }, error: null };
        if (table === "spec_completion_reviews") {
          if (insert) {
            if (state.cache) return { data: null, error: null };
            state.cache = { ...insert, updated_at: new Date().toISOString() };
            state.writes.push({ table, patch: insert });
            return { data: { project_id: projectId } };
          }
          if (patch) {
            if (state.conflict) {
              state.conflict = false;
              state.cache.report.concurrent_note = "Preserved";
              state.cache.updated_at = "2026-10-13T22:00:01Z";
              return { data: null };
            }
            if (filters.updated_at !== state.cache.updated_at) return { data: null };
            state.cache = { ...state.cache, ...patch };
            state.writes.push({ table, patch });
            return { data: { project_id: projectId } };
          }
          return { data: state.cache ? structuredClone(state.cache) : null, error: null };
        }
        return { data: null, error: null };
      };
      const q: any = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (k: string, v: any) => {
          filters[k] = v;
          return q;
        },
        is: (k: string, v: any) => {
          filters[k] = v;
          return q;
        },
        update: (v: any) => {
          patch = v;
          return q;
        },
        upsert: (v: any) => {
          insert = v;
          return q;
        },
        maybeSingle: async () => get(),
        then: (resolve: any) => Promise.resolve(get()).then(resolve),
      };
      return q;
    },
  },
}));
import { loadCatalogFitContext, loadCatalogDocumentFit, parsedDocumentRequirements } from "@/lib/materialCatalogFit.server";
const flush = async () => {
  await Promise.all(state.tasks.splice(0));
};
const output = {
  status: "completed",
  output_text: JSON.stringify({
    rooms: [{ room_id: room.id, requirements: [
      {
        label: "Sink",
        field: "mount",
        value: "wall",
        page: 9,
        sheet: "ID0.7",
        evidence: "Proposed Powder Bath basin explicitly wall mounted",
        confidence: "high",
        explicit_specification: true,
        exact_object: true,
        inferred: false,
      },
    ], shower: "absent", confidence: "high", complete_layout: true, page: 9, sheet: "ID0.7",
      evidence: "Complete proposed powder layout shows no shower." }],
  }),
};
beforeEach(() => {
  vi.clearAllMocks();
  state.cache = null;
  state.items = [];
  state.rooms = [room];
  state.board = null;
  state.tasks = [];
  state.reads = [];
  state.writes = [];
  state.conflict = false;
  state.document = {
    id: "doc",
    title: "Latest construction",
    updated_at: "v1",
    file_size: 25,
    file_url: `https://project.supabase.co/storage/v1/object/public/project-files/${projectId}/construction-docs/plan.pdf`,
  };
  state.download.mockResolvedValue({ data: new Blob(["sample PDF"]), error: null });
  state.generate.mockResolvedValue(Response.json(output));
  state.retrieve.mockResolvedValue(Response.json(output));
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
});
afterEach(async () => {
  await flush();
  vi.unstubAllEnvs();
});
it("uses the latest project document and scoped room selections", async () => {
  const first = await loadCatalogFitContext(projectId, room, true);
  expect(first.plan.status).toBe("checking");
  await flush();
  const saved = await loadCatalogFitContext(projectId, room, true);
  expect(saved.plan.status).toBe("checked");
  expect(saved.plan.requirements[0].value).toBe("wall");
  expect(state.reads.find((r) => r.table === "project_documents").filters).toMatchObject({
    project_id: projectId,
    document_type: "Construction Doc",
    superseded_by_document_id: null,
  });
  expect(state.reads.find((r) => r.table === "material_items").filters).toEqual({
    project_id: projectId,
    room_id: room.id,
  });
  expect(state.generate).toHaveBeenCalledTimes(1);
  expect(state.generate.mock.calls[0][1]).toBe("completion");
  expect(state.generate.mock.calls[0][2]).toBe(true);
});
it("does not generate again when another missing item or filter opens in the same room", async () => {
  await loadCatalogFitContext(projectId, room, true);
  await loadCatalogFitContext(projectId, room, true);
  await flush();
  await loadCatalogFitContext(projectId, room, true);
  expect(state.generate).toHaveBeenCalledTimes(1);
});
it("starts a new review after the construction document changes", async () => {
  await loadCatalogFitContext(projectId, room, true);
  await flush();
  state.document = { ...state.document, id: "new-doc", updated_at: "v2" };
  await loadCatalogFitContext(projectId, room, true);
  await flush();
  expect(state.generate).toHaveBeenCalledTimes(2);
});
it("uses room context without AI when no construction document exists", async () => {
  state.document = null;
  state.items = [
    {
      id: "shower",
      project_id: projectId,
      room_id: room.id,
      product_id: "p",
      is_required: false,
      item_label: "Shower system",
      color: "Polished Nickel",
    },
  ];
  const result = await loadCatalogFitContext(projectId, room, true);
  expect(result.plan.status).toBe("no_document");
  expect(result.items).toHaveLength(1);
  expect(state.generate).not.toHaveBeenCalled();
  expect(state.writes).toEqual([]);
});
it("persists background response IDs and polls without another generation", async () => {
  state.generate.mockResolvedValue(Response.json({ status: "queued", id: "resp_test" }));
  await loadCatalogFitContext(projectId, room, true);
  await flush();
  const result = await loadCatalogFitContext(projectId, room, false);
  expect(result.plan.status).toBe("checked");
  expect(state.retrieve).toHaveBeenCalledWith("resp_test");
  expect(state.generate).toHaveBeenCalledTimes(1);
});
it("retains existing completion results and concurrent review changes while caching", async () => {
  state.cache = {
    report: { checked_at: "2026-10-13T21:00:00Z", findings: [{ id: "keep" }] },
    issues: { keep: { status: "completed" } },
    source_signature: "keep",
    updated_at: "2026-10-13T22:00:00Z",
  };
  state.conflict = true;
  await loadCatalogFitContext(projectId, room, true);
  await flush();
  expect(state.cache.report.findings).toEqual([{ id: "keep" }]);
  expect(state.cache.report.concurrent_note).toBe("Preserved");
  expect(state.cache.issues.keep.status).toBe("completed");
  expect(state.cache.source_signature).toBe("keep");
});
it("does not fabricate a completion review when creating the catalog-only cache", async () => {
  await loadCatalogFitContext(projectId, room, true);
  await flush();
  expect(state.cache.report.checked_at).toBeUndefined();
  expect(state.cache.checked_by).toBeUndefined();
  expect(state.cache.report.catalog_fit_checks).toBeTruthy();
  expect(state.writes.every((r) => r.table === "spec_completion_reviews")).toBe(true);
});
it("does not restart an unavailable review automatically", async () => {
  state.generate.mockRejectedValue(Error("network failed"));
  await loadCatalogFitContext(projectId, room, true);
  await flush();
  const result = await loadCatalogFitContext(projectId, room, true);
  expect(result.plan.status).toBe("unavailable");
  expect(state.generate).toHaveBeenCalledTimes(1);
});
it("changes the add-context key when the room's selected plumbing changes without charging for another PDF review", async () => {
  await loadCatalogFitContext(projectId, room, true);
  await flush();
  const before = await loadCatalogFitContext(projectId, room, true);
  state.items = [
    {
      id: "shower",
      project_id: projectId,
      room_id: room.id,
      product_id: "p",
      is_required: false,
      item_label: "Shower system",
      color: "Brushed Gold",
      updated_at: "v2",
    },
  ];
  const after = await loadCatalogFitContext(projectId, room, true);
  expect(after.contextKey).not.toBe(before.contextKey);
  expect(state.generate).toHaveBeenCalledTimes(1);
});

it("shares one persisted extraction across rooms, concurrent openings and layout checks", async () => {
  const other = { id: "bathroom-two", name: "Bathroom 2" };
  state.rooms = [room, other];
  const value = JSON.parse(output.output_text);
  value.rooms.push({ ...value.rooms[0], room_id: other.id,
    requirements: [{ ...value.rooms[0].requirements[0], value: "undermount" }] });
  state.generate.mockResolvedValue(Response.json({ status: "completed", output_text: JSON.stringify(value) }));
  await Promise.all([loadCatalogFitContext(projectId, room, true), loadCatalogFitContext(projectId, other, true)]);
  await flush();
  const first = await loadCatalogFitContext(projectId, room, true);
  const second = await loadCatalogFitContext(projectId, other, true);
  const layouts = await loadCatalogDocumentFit(projectId, state.document, state.rooms, true);
  expect(first.plan.requirements[0].value).toBe("wall");
  expect(second.plan.requirements[0].value).toBe("undermount");
  expect(layouts?.bathroom_layouts).toHaveLength(2);
  expect(state.generate).toHaveBeenCalledTimes(1);
  expect(state.download).toHaveBeenCalledTimes(1);
  expect(Object.values(state.cache.report.catalog_fit_checks)).toHaveLength(1);
});

it("invalidates extraction after a room identity changes, but not a selected product", async () => {
  await loadCatalogFitContext(projectId, room, true); await flush();
  const renamed = { ...room, name: "Guest Bath" };
  state.rooms = [renamed];
  await loadCatalogFitContext(projectId, renamed, true); await flush();
  expect(state.generate).toHaveBeenCalledTimes(2);
});

it("retains completed room caches from before the release without a new AI charge", async () => {
  const { createHash } = await import("node:crypto");
  const key = createHash("sha256").update(JSON.stringify(["catalog-fit-v1", projectId,
    room.id, room.name, state.document.id, state.document.updated_at])).digest("hex");
  state.cache = { updated_at: new Date().toISOString(), report: { catalog_fit_checks: {
    [key]: { key, room_id: room.id, room_name: room.name, status: "checked", document: state.document,
      request_id: "legacy", started_at: new Date().toISOString(), requirements: [{ label: "Sink", field: "mount", value: "wall" }] },
  } } };
  expect((await loadCatalogFitContext(projectId, room, true)).plan.requirements[0].value).toBe("wall");
  expect(state.generate).not.toHaveBeenCalled();
});

it("requires complete, unique room mapping and does not accept cross-room requirements", () => {
  const value = JSON.parse(output.output_text);
  const rooms = [{ ...room, targets: ["Sink"] }];
  for (const rows of [[], [value.rooms[0], value.rooms[0]], [{ ...value.rooms[0], room_id: "other-project" }]])
    expect(() => parsedDocumentRequirements({ status: "completed", output_text: JSON.stringify({ rooms: rows }) }, rooms, 26)).toThrow();
  const wrongLabel = { ...value, rooms: [{ ...value.rooms[0], requirements: [{ ...value.rooms[0].requirements[0], label: "Other room product" }] }] };
  expect(parsedDocumentRequirements({ status: "completed", output_text: JSON.stringify(wrongLabel) }, rooms, 26).room_requirements[room.id]).toEqual([]);
});

it("fails closed on an incomplete multi-room response without charging automatically again", async () => {
  state.generate.mockResolvedValue(Response.json({ status: "completed", output_text: JSON.stringify({ rooms: [] }) }));
  await loadCatalogFitContext(projectId, room, true); await flush();
  expect((await loadCatalogFitContext(projectId, room, true)).plan.status).toBe("unavailable");
  expect(state.generate).toHaveBeenCalledTimes(1);
});

it("reuses the database result after server modules restart", async () => {
  await loadCatalogFitContext(projectId, room, true); await flush();
  vi.resetModules();
  const restarted = await import("@/lib/materialCatalogFit.server");
  expect((await restarted.loadCatalogFitContext(projectId, room, true)).plan.status).toBe("checked");
  expect(state.generate).toHaveBeenCalledTimes(1);
  expect(state.download).toHaveBeenCalledTimes(1);
});

it("requires explicit retry and claims only one new request when retries race", async () => {
  state.generate.mockRejectedValue(Error("network failed"));
  await loadCatalogFitContext(projectId, room, true); await flush();
  await loadCatalogFitContext(projectId, room, true);
  expect(state.generate).toHaveBeenCalledTimes(1);
  state.generate.mockResolvedValue(Response.json(output));
  await Promise.all([loadCatalogFitContext(projectId, room, true, true), loadCatalogFitContext(projectId, room, true, true)]);
  await flush();
  expect(state.generate).toHaveBeenCalledTimes(2);
  expect((await loadCatalogFitContext(projectId, room, true)).plan.status).toBe("checked");
});
