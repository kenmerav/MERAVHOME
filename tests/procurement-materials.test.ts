import { beforeEach, describe, expect, it, vi } from "vitest";
import { materialVisibleInProcurement } from "@/lib/materialSelection";

const state = vi.hoisted(() => ({ materials: [] as any[], legacy: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
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

describe("Materials flowing into Procurement", () => {
  it("shows an added item with a link before product details are scraped, and an explicit add-for-later item", async () => {
    state.materials = [
      material("linked", { product_url: "https://on.ltk.com/selection" }),
      material("for-later", { item_label: "Toilet" }),
    ];
    const items = await db.listProcurement();
    expect(items.map((item) => item.material?.id)).toEqual(["linked", "for-later"]);
    expect(items[0].room_product.product).toBeNull();
    expect(items[0].room_product.room.project.id).toBe("project");
    expect(items[0].material?.product_url).toBe("https://on.ltk.com/selection");
  });

  it("keeps untouched room-template suggestions and not-needed items out, while showing a manually selected template item", async () => {
    state.materials = [
      material("untouched", { is_required: true }),
      material("dismissed", { not_needed: true, product_url: "https://vendor.example/toilet" }),
      material("chosen-template", {
        is_required: true,
        product_url: "https://vendor.example/sink",
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
    state.materials.push(material("new-sink", { product_url: "https://vendor.example/new" }));
    expect((await db.listProcurement()).map((item) => item.material?.id)).toEqual(["new-sink"]);
  });

  it("recognizes selections with manual quantity or board references without a catalog link", () => {
    expect(materialVisibleInProcurement({ is_required: true, quantity: 0 })).toBe(true);
    expect(
      materialVisibleInProcurement({ is_required: true, source_board_element_id: "layer" }),
    ).toBe(true);
    expect(materialVisibleInProcurement({ is_required: true, product_url: "  " })).toBe(false);
  });
});
