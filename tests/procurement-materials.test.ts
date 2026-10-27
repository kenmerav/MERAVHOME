import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { materialVisibleInProcurement } from "@/lib/materialSelection";
import { staleSpecBookMaterialIds } from "@/lib/specBookSources";

const state = vi.hoisted(() => ({ materials: [] as any[], legacy: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) },
    from: (table: string) => {
      let nonNullField: string | null = null;
      const query: any = {
        select: () => query,
        order: () => query,
        not: (field: string) => {
          nonNullField = field;
          return query;
        },
        range: async (from: number, to: number) => {
          const rows = table === "material_items" ? state.materials : state.legacy;
          const filtered = nonNullField ? rows.filter((row) => row[nonNullField!] != null) : rows;
          return { data: structuredClone(filtered.slice(from, to + 1)), error: null };
        },
      };
      return query;
    },
  },
}));
import { db } from "@/lib/db";

const room = { id: "bath", name: "Guest Bathroom", project: { id: "project", name: "Kaufman" } };
function material(id: string, patch: any = {}) {
  return {
    id,
    room_id: room.id,
    room,
    project_id: "project",
    item_label: "Sink",
    client_product_name: "Guest Bathroom Sink",
    category: "Plumbing",
    is_required: false,
    not_needed: false,
    product_id: null,
    product: null,
    product_url: null,
    quantity: null,
    ordered: false,
    ...patch,
  };
}
beforeEach(() => {
  state.materials = [];
  state.legacy = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("Materials flowing into Procurement", () => {
  it("omits items without a product because they are not shown in the Spec Book", async () => {
    state.materials = [
      material("linked", { product_url: "https://on.ltk.com/selection" }),
      material("for-later", { item_label: "Toilet" }),
    ];
    const items = await db.listProcurement();
    expect(items).toEqual([]);
  });

  it("keeps untouched room-template suggestions and not-needed items out, while showing a manually selected template item", async () => {
    state.materials = [
      material("untouched", { is_required: true }),
      material("dismissed", { not_needed: true, product_url: "https://vendor.example/toilet" }),
      material("chosen-template", {
        is_required: true,
        product_url: "https://vendor.example/sink",
        product_id: "sink",
        product: { id: "sink", name: "Sink" },
      }),
      material("no-room", { room: null }),
    ];
    expect((await db.listProcurement()).map((item) => item.material?.id)).toEqual([
      "chosen-template",
    ]);
  });

  it("preserves product-invoice source IDs, quantities and tracking for existing catalog selections", async () => {
    const product = { id: "product", name: "Toilet", price: "$250" };
    state.materials = [material("existing", { product_id: product.id, product, quantity: 4 })];
    state.legacy = [
      {
        id: "invoice-source",
        ordered: true,
        received: true,
        room_product: {
          id: "room-product",
          product_id: product.id,
          room_id: room.id,
          product,
          room,
          approval_status: "approved",
        },
      },
    ];
    const items = await db.listProcurement();
    expect(items[0]).toMatchObject({
      id: "invoice-source",
      ordered: true,
      received: true,
      material: { id: "existing", quantity: 4 },
      room_product: { product, approval_status: "approved" },
    });
    expect(state.materials[0].quantity).toBe(4);
  });

  it("includes a newly added item beyond the first database page", async () => {
    state.materials = Array.from({ length: 1000 }, (_, i) =>
      material(`template-${i}`, { is_required: true }),
    );
    state.materials.push(material("new-sink", { product_url: "https://vendor.example/new", product_id: "sink", product: { id: "sink", name: "Sink" } }));
    expect((await db.listProcurement()).map((item) => item.material?.id)).toEqual(["new-sink"]);
  });

  it("requires the same product selection shown by the Spec Book", () => {
    expect(materialVisibleInProcurement({ is_required: true, quantity: 0 })).toBe(false);
    expect(
      materialVisibleInProcurement({ is_required: true, source_board_element_id: "layer" }),
    ).toBe(false);
    expect(materialVisibleInProcurement({ is_required: true, product_url: "  " })).toBe(false);
  });

  it("omits removed board selections, keeps current and manual ones, and preserves records", async () => {
    const product = { id: "product", name: "Lamp", price: "$80" };
    const source = { project_id: "project", source_board_id: "project", source_board_page_id: "page", source_board_element_id: "layer", product_id: product.id, product };
    state.materials = [material("removed", source), material("current", source), material("manual", { product_id: product.id, product })];
    const before = structuredClone(state.materials);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ staleMaterialIds: ["removed"] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect((await db.listProcurement()).map((item) => item.material?.id)).toEqual(["current", "manual"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/spec-book-source-status?projectId=project", expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }));
    expect(state.materials).toEqual(before);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ staleMaterialIds: [] }) });
    expect((await db.listProcurement()).map((item) => item.material?.id)).toEqual(["removed", "current", "manual"]);
  });

  it("fails closed if current selections cannot be verified", async () => {
    state.materials = [material("selected", { product_id: "p", product: { id: "p" }, source_board_id: "project", source_board_page_id: "page", source_board_element_id: "layer" })];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(db.listProcurement()).rejects.toThrow("Could not check the current design selections");
  });

  it("hides an old Lovesy-style vanity and chair when the current board has replacements", async () => {
    const source = { source_board_id: "project", product_id: "p", product: { id: "p", name: "Vanity" } };
    state.materials = [
      material("old-vanity", { ...source, source_board_page_id: "old", source_board_element_id: "old-vanity-layer" }),
      material("old-chair", { ...source, source_board_page_id: "old", source_board_element_id: "old-chair-layer" }),
      material("current-vanity", { ...source, source_board_page_id: "current", source_board_element_id: "vanity-layer" }),
      material("current-chair", { ...source, source_board_page_id: "current", source_board_element_id: "chair-layer" }),
    ];
    const board = { pages: [{ id: "current", elements: [
      { id: "vanity-layer", materialItemId: "current-vanity" },
      { id: "chair-layer", materialItemId: "current-chair" },
    ] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ staleMaterialIds: staleSpecBookMaterialIds("project", state.materials, board) }) }));
    expect((await db.listProcurement()).map((item) => item.material?.id)).toEqual(["current-vanity", "current-chair"]);
  });
});
