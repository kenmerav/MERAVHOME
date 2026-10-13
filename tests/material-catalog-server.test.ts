import { beforeEach, expect, it, vi } from "vitest";
const projectId = "9015b5ff-6343-462b-9539-9e62ed1c52d0";
const roomId = "de252929-38a3-4e2f-9ae9-4acc810818f3";
const productId = "4667bd26-11c7-456f-a3c7-4e6cd066888e";
const itemId = "2da318a0-a229-4b83-815a-de7b000c3bb7";
const state = vi.hoisted(() => ({
  denied: null as Response | null,
  queues: {} as Record<string, any[]>,
  reads: [] as any[],
  writes: [] as any[],
}));
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
      const run = () => {
        state.reads.push({ table, filters });
        if (patch) state.writes.push({ table, filters, ...patch });
        return state.queues[table]?.shift() ?? { data: [], error: null };
      };
      const q: any = {
        select: () => q,
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
      ...patch,
    }),
  });
beforeEach(() => {
  state.denied = null;
  state.reads = [];
  state.writes = [];
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
it("returns staff/project authorization failures before accessing catalog data", async () => {
  state.denied = Response.json({ error: "Only staff" }, { status: 403 });
  expect((await materialCatalogRequest(request())).status).toBe(403);
  expect(state.reads).toEqual([]);
  expect(state.writes).toEqual([]);
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
