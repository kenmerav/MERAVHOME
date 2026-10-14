import { beforeEach, expect, it, vi } from "vitest";
const projectId = "9015b5ff-6343-462b-9539-9e62ed1c52d0";
const roomId = "de252929-38a3-4e2f-9ae9-4acc810818f3";
const productId = "4667bd26-11c7-456f-a3c7-4e6cd066888e";
const itemId = "2da318a0-a229-4b83-815a-de7b000c3bb7";
const state = vi.hoisted(() => ({
  context: vi.fn(),
  denied: null as Response | null,
  queues: {} as Record<string, any[]>,
  reads: [] as any[],
  writes: [] as any[],
  status: vi.fn(),
}));
vi.mock("@/lib/savedSpecCompletion.server", () => ({ setCompletionIssueStatus: state.status }));
vi.mock("@/lib/materialCatalogFit.server", () => ({ loadCatalogFitContext: state.context }));
vi.mock("@/lib/specCompletion.server", () => ({
  authorizeCompletionProject: async (request: Request) =>
    state.denied ?? {
      projectId: "9015b5ff-6343-462b-9539-9e62ed1c52d0",
      userId: "staff",
      body: await request.json(),
    },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: any = {};
      let patch: any = null;
      let fields = "";
      const run = () => {
        state.reads.push({ table, filters });
        // Rooms also references Materials for presentation selections, so an
        // unqualified embed is ambiguous in the production schema.
        if (["material_items", "room_products"].includes(table) && fields.includes("room:rooms("))
          return {
            data: null,
            error: { code: "PGRST201", message: "Ambiguous room relationship" },
          };
        if (patch) state.writes.push({ table, filters, ...patch });
        return state.queues[table]?.shift() ?? { data: [], error: null };
      };
      const q: any = {
        select: (value: string) => {
          fields = value;
          return q;
        },
        order: () => q,
        range: () => q,
        limit: () => q,
        eq: (key: string, value: any) => {
          filters[key] = value;
          return q;
        },
        is: (key: string, value: any) => {
          filters[key] = value;
          return q;
        },
        update: (value: any) => {
          patch = { kind: "update", value };
          return q;
        },
        insert: (value: any) => {
          patch = { kind: "insert", value };
          return q;
        },
        maybeSingle: async () => run(),
        single: async () => run(),
        then: (resolve: any) => Promise.resolve(run()).then(resolve),
      };
      return q;
    },
  },
}));
import { materialCatalogRequest } from "@/lib/materialCatalogSuggestions.server";
const request = (patch = {}) =>
  new Request("https://studio.test/api/material-catalog-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: projectId,
      room_id: roomId,
      label: "Toilet",
      action: "add",
      product_id: productId,
      existing_item_id: itemId,
      expected_updated_at: "version",
      context_key: "0".repeat(64),
      ...patch,
    }),
  });
beforeEach(() => {
  state.context.mockReset().mockResolvedValue({
    items: [],
    plan: { status: "no_document", document: null, requirements: [], message: "No plans" },
    contextKey: "0".repeat(64),
  });
  state.denied = null;
  state.reads = [];
  state.writes = [];
  state.status.mockReset().mockResolvedValue(undefined);
  state.queues = {
    rooms: [{ data: { id: roomId, name: "Powder Bath" } }],
    products: [
      {
        data: {
          id: productId,
          name: "White Toilet",
          category: "Plumbing",
          product_url: "https://example.com/toilet",
          finish: "White",
        },
      },
    ],
    material_items: [
      {
        data: [
          {
            id: itemId,
            project_id: projectId,
            room_id: roomId,
            item_label: "Toilet",
            is_required: true,
            not_needed: false,
            product_id: null,
            updated_at: "version",
          },
        ],
      },
      { data: { id: itemId } },
    ],
    design_boards: [{ data: { board_state: null } }],
    room_products: [{ data: [] }, { data: { id: "room-link" } }],
  };
});
const issueKey = "a".repeat(64);
const checkedAt = "2026-10-14T20:00:00Z";
function reviewIssue(field = "product", patch: any = {}) {
  const issue = { key: issueKey, status: "open", status_updated_at: null, last_seen_at: checkedAt,
    finding: { item_id: field === "missing_item" ? null : itemId, room_id: roomId, field, item_label: "Toilet" }, ...patch };
  state.queues.spec_completion_reviews = [{ data: { report: { checked_at: checkedAt, plan_status: "checked" }, issues: { [issueKey]: issue } } }];
  if (field === "missing_item") {
    state.queues.material_items.splice(1, 0, { data: [] });
    state.queues.rooms.push({ data: [{ id: roomId, name: "Powder Bath" }] });
  }
  if (field !== "missing_item") state.queues.material_items.unshift({ data: state.queues.material_items[0].data[0] });
  return { completion_issue_key: issueKey, expected_issue_updated_at: null };
}
it("fills a missing review item and completes only that issue after saving the room connection", async () => {
  expect((await materialCatalogRequest(request(reviewIssue("missing_item")))).status).toBe(200);
  expect(state.status).toHaveBeenCalledWith(projectId, "staff", issueKey, "completed", null);
  expect(state.writes).toHaveLength(2);
});
it("replaces a selected review product with a version guard, preserving quantities and source history", async () => {
  const existing = state.queues.material_items[0].data[0];
  Object.assign(existing, { product_id: "old-product", is_required: false, quantity: 7, quantity_tbd: false, source_board_id: projectId });
  expect((await materialCatalogRequest(request({ ...reviewIssue(), action: "replace" }))).status).toBe(200);
  expect(state.writes[0].filters.product_id).toBe("old-product");
  expect(state.writes[0].value.product_id).toBe(productId);
  for (const field of ["quantity", "quantity_tbd", "quantity_unit", "source_board_id", "ordered", "received", "installed"]) expect(state.writes[0].value).not.toHaveProperty(field);
  expect(state.status).toHaveBeenCalledOnce();
});
it("keeps plan fit corrections open after a replacement until staff confirms them", async () => {
  Object.assign(state.queues.material_items[0].data[0], { product_id: "old-product", is_required: false });
  expect((await materialCatalogRequest(request({ ...reviewIssue("dimensions"), action: "replace" }))).status).toBe(200);
  expect(state.status).not.toHaveBeenCalled();
});
it("replaces the specific material even when the room has another fixture of the same type", async () => {
  const existing = state.queues.material_items[0].data[0];
  Object.assign(existing, { product_id: "old-product", is_required: false });
  state.queues.material_items[0].data.push({ ...existing, id: "second-toilet" });
  expect((await materialCatalogRequest(request({ ...reviewIssue(), action: "replace" }))).status).toBe(200);
  expect(state.writes[0].filters.id).toBe(itemId);
});
it.each(["ordered", "received", "installed"])("refuses replacement of a %s material", async field => {
  Object.assign(state.queues.material_items[0].data[0], { product_id: "old-product", [field]: true });
  expect((await materialCatalogRequest(request({ ...reviewIssue(), action: "replace" }))).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it.each([{ status: "completed" }, { last_seen_at: "previous" }, { finding: { room_id: "another-room", field: "missing_item", item_id: null, item_label: "Toilet" } }])("rejects changed or foreign review issues before catalog writes: %j", async patch => {
  const body = reviewIssue("missing_item", patch);
  expect((await materialCatalogRequest(request(body))).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("refuses a missing-item add now covered by Materials Throughout", async () => {
  const body = reviewIssue("missing_item");
  state.queues.rooms[1] = { data: [{ id: roomId, name: "Powder Bath" }, { id: "shared", name: "Materials Throughout" }] };
  state.queues.material_items[1] = { data: [{ id: "shared-toilet", project_id: projectId, room_id: "shared", item_label: "Toilet", is_required: false, product_id: "shared-product" }] };
  expect((await materialCatalogRequest(request(body))).status).toBe(409);
  expect(state.writes).toEqual([]); expect(state.status).not.toHaveBeenCalled();
});
it("finds catalog sinks from a plan finding with a room-prefixed item label", async () => {
  const body = reviewIssue("missing_item", { finding: { field: "missing_item", room_id: roomId, item_id: null, item_label: "Bathroom sink" } });
  state.queues.products = [{ data: [{ id: productId, name: "White Bathroom Sink", category: "Plumbing" }] }];
  state.queues.material_items = [{ data: [] }]; state.queues.room_products = [{ data: [] }];
  const response = await materialCatalogRequest(request({ ...body, label: "Bathroom sink", existing_item_id: null, action: "list" }));
  expect(response.status).toBe(200); expect((await response.json()).suggestions[0].product.id).toBe(productId);
});
it("rejects a replacement when the selection has changed since its saved issue", async () => {
  const body = reviewIssue("product", { item_preview: { product_id: "old-product" } });
  expect((await materialCatalogRequest(request({ ...body, action: "replace" }))).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("does not expose replacement actions without an authenticated saved review issue", async () => {
  expect((await materialCatalogRequest(request({ action: "replace" }))).status).toBe(400);
  expect(state.writes).toEqual([]);
});
it("reports a saved product accurately when only the issue-status update fails", async () => {
  state.status.mockRejectedValue(new Error("Concurrent review"));
  const response = await materialCatalogRequest(request(reviewIssue("missing_item")));
  expect(response.status).toBe(200);
  expect((await response.json()).warning).toContain("product is saved");
});
it("returns staff/project authorization failures before accessing catalog data", async () => {
  state.denied = Response.json({ error: "Only staff" }, { status: 403 });
  expect((await materialCatalogRequest(request())).status).toBe(403);
  expect(state.reads).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.context).not.toHaveBeenCalled();
});
it("does not let a caller use a room from another project", async () => {
  state.queues.rooms = [{ data: null }];
  expect((await materialCatalogRequest(request())).status).toBe(404);
  expect(state.reads[0].filters).toEqual({ id: roomId, project_id: projectId });
  expect(state.writes).toEqual([]);
});
it("links a confirmed catalog choice with scoped optimistic writes and TBD quantity", async () => {
  expect((await materialCatalogRequest(request())).status).toBe(200);
  expect(state.writes[0]).toEqual(
    expect.objectContaining({
      table: "material_items",
      kind: "update",
      filters: {
        id: itemId,
        room_id: roomId,
        project_id: projectId,
        updated_at: "version",
        product_id: null,
      },
      value: expect.objectContaining({
        product_id: productId,
        quantity: null,
        quantity_tbd: true,
        quantity_unit: "count",
        color: "White",
        is_required: false,
      }),
    }),
  );
  expect(state.writes[1].value).toEqual({
    room_id: roomId,
    product_id: productId,
    is_key_selection: false,
  });
  expect(state.writes.some((write) => write.table === "products")).toBe(false);
});
it("refuses to overwrite a placeholder edited after the suggestions were opened", async () => {
  state.queues.material_items[0].data[0].updated_at = "newer";
  expect((await materialCatalogRequest(request())).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("does not insert another item when a selection already covers it", async () => {
  state.queues.material_items[0].data[0] = {
    id: "another",
    product_id: productId,
    item_label: "Water Closet",
    not_needed: false,
    is_required: false,
  };
  expect((await materialCatalogRequest(request({ existing_item_id: null }))).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("rejects a toilet seat as a toilet selection", async () => {
  state.queues.products[0].data.name = "Toilet Seat";
  expect((await materialCatalogRequest(request())).status).toBe(400);
  expect(state.writes).toEqual([]);
});
it("reports a concurrent material write without linking the room or claiming success", async () => {
  state.queues.material_items[1] = { data: null };
  expect((await materialCatalogRequest(request())).status).toBe(409);
  expect(state.writes).toHaveLength(1);
});
it("does not infer successful room linking after a partial write failure", async () => {
  state.queues.room_products[1] = { error: new Error("write failed") };
  const result = await materialCatalogRequest(request());
  expect(result.status).toBe(409);
  expect((await result.json()).error).toContain("material was added");
});
it("rejects invalid sink width filters before loading the catalog", async () => {
  const result = await materialCatalogRequest(
    request({ action: "list", criteria: { width: -10 } }),
  );
  expect(result.status).toBe(400);
  expect(state.reads).toHaveLength(1);
});
it("lists prior catalog use from Materials and legacy room selections without double counting", async () => {
  state.queues.products = [
    { data: [{ id: productId, name: "White Toilet", category: "Plumbing" }] },
  ];
  state.queues.material_items = [
    {
      data: [
        {
          product_id: productId,
          project_id: "previous",
          not_needed: false,
          room: { name: "Bathroom" },
        },
      ],
    },
  ];
  state.queues.room_products = [
    { data: [{ product_id: productId, room: { project_id: "previous", name: "Bathroom" } }] },
  ];
  const result = await materialCatalogRequest(request({ action: "list" }));
  expect(result.status).toBe(200);
  expect((await result.json()).suggestions[0].project_count).toBe(1);
  expect(state.writes).toEqual([]);
});
it("creates a manual material and room connection when there is no template row", async () => {
  state.queues.material_items = [{ data: [] }, { data: { id: itemId } }];
  expect((await materialCatalogRequest(request({ existing_item_id: null }))).status).toBe(200);
  expect(state.writes[0]).toEqual(
    expect.objectContaining({
      kind: "insert",
      value: expect.objectContaining({
        project_id: projectId,
        room_id: roomId,
        product_id: productId,
        source_board_id: null,
        source_board_page_id: null,
        source_board_element_id: null,
        quantity_tbd: true,
      }),
    }),
  );
});
it("respects an item explicitly marked not needed", async () => {
  state.queues.material_items[0].data[0].not_needed = true;
  expect((await materialCatalogRequest(request())).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("refuses an add against a stale room/document context", async () => {
  expect((await materialCatalogRequest(request({ context_key: "1".repeat(64) }))).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("refuses a product whose variant or dimensions changed after the suggestion was shown", async () => {
  state.queues.products[0].data.updated_at = "2026-10-13T23:30:00Z";
  const response = await materialCatalogRequest(
    request({ expected_product_updated_at: "2026-10-13T23:00:00Z" }),
  );
  expect(response.status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("does not add while the construction review is still running", async () => {
  state.context.mockResolvedValue({
    items: [],
    plan: { status: "checking", requirements: [] },
    contextKey: "0".repeat(64),
  });
  expect((await materialCatalogRequest(request())).status).toBe(409);
  expect(state.writes).toEqual([]);
});
it("prioritizes the room's shower finish over a drain used more often elsewhere", async () => {
  state.context.mockResolvedValue({
    contextKey: "0".repeat(64),
    plan: { status: "no_document", document: null, requirements: [], message: "No plans" },
    items: [
      {
        id: "shower",
        product_id: "chosen",
        item_label: "Shower system",
        color: "Polished Nickel",
        product: { name: "Shower Trim" },
      },
    ],
  });
  state.queues.products = [
    {
      data: [
        { id: "black", name: "Round Shower Drain", category: "Plumbing", finish: "Matte Black" },
        {
          id: "nickel",
          name: "Round Shower Drain",
          category: "Plumbing",
          finish: "Polished Nickel",
        },
      ],
    },
  ];
  state.queues.material_items = [
    {
      data: [
        { product_id: "black", project_id: projectId, not_needed: false, room: { name: "Bath 3" } },
      ],
    },
  ];
  state.queues.room_products = [{ data: [] }];
  const result = await materialCatalogRequest(request({ label: "Shower Drain", action: "list" }));
  const body = await result.json();
  expect(body.suggestions[0].product.id).toBe("nickel");
  expect(body.suggestions[0].fit.status).toBe("needs_review");
});
it("blocks a catalog sink that conflicts with explicitly planned mounting", async () => {
  state.context.mockResolvedValue({
    contextKey: "0".repeat(64),
    items: [],
    plan: {
      status: "checked",
      document: { id: "doc", title: "Latest", updated_at: "v1" },
      requirements: [
        {
          label: "Sink",
          field: "mount",
          value: "wall",
          page: 4,
          sheet: "ID2",
          evidence: "Wall mounted basin",
        },
      ],
    },
  });
  state.queues.products[0].data = {
    id: productId,
    name: "Undermount Bathroom Sink",
    category: "Plumbing",
    dimensions: "Width: 20 in",
  };
  const response = await materialCatalogRequest(request({ label: "Sink" }));
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("conflicts");
  expect(state.writes).toEqual([]);
});
