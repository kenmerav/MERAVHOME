import { beforeEach, expect, it, vi } from "vitest";
const project = "527d1356-919b-48b9-877e-1924c766282b";
const room = "0033186c-a2e6-417f-a50f-37f5390f5cf5";
const actor = "4204f2d1-e10c-4d98-a01b-350cf7d8cafe";
const state = vi.hoisted(() => ({ board: null as any, items: [] as any[], rooms: [] as any[], products: [] as any[], writes: [] as any[], reads: [] as any[], casMiss: false, insertFail: false, materialMiss: false }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (table: string) => {
  const filters: any = {}; let patch: any; let inserts: any; let offset = 0; let end = 999;
  const get = () => {
    state.reads.push({ table, filters: { ...filters } });
    if (table === "design_boards") {
      if (patch) {
        state.writes.push({ table, patch, filters });
        if (state.casMiss || filters.updated_at !== state.board.updated_at) return { data: null, error: null };
        state.board = { ...state.board, ...patch, updated_at: "next" };
      }
      return { data: structuredClone(state.board), error: null };
    }
    if (table === "products") return { data: state.products, error: null };
    if (table === "material_items" && patch) {
      state.writes.push({ table, patch, filters });
      const item = state.items.find(row => row.id === filters.id && row.project_id === filters.project_id && row.updated_at === filters.updated_at);
      if (!item || state.materialMiss) return { data: null, error: null };
      Object.assign(item, patch, { updated_at: "material-next" });
      return { data: structuredClone(item), error: null };
    }
    if (inserts) {
      state.writes.push({ table, inserts, filters });
      if (state.insertFail) return { data: null, error: { message: "save failed" } };
      for (const item of inserts) if (!state.items.some(row => row.id === item.id)) state.items.push(item);
    }
    const rows = table === "rooms" ? state.rooms : state.items;
    return { data: structuredClone(rows.filter(row => row.project_id === filters.project_id).slice(offset, end + 1)), error: null };
  };
  const q: any = { select: () => q, eq: (key: string, value: any) => { filters[key] = value; return q; }, in: (key: string, value: any) => { filters[key] = value; return q; },
    order: () => q, range: (start: number, last: number) => { offset = start; end = last; return q; }, update: (value: any) => { patch = value; return q; },
    upsert: (values: any, options: any) => { expect(options.ignoreDuplicates).toBe(true); inserts = values; return q; },
    maybeSingle: async () => get(), then: (resolve: any) => Promise.resolve(get()).then(resolve) };
  return q;
} } }));
import { syncSpecBoardForStaff } from "@/lib/specBoardSync.server";
beforeEach(() => {
  state.board = { updated_at: "before", board_state: { pages: [{ id: "p", title: "Bathroom", roomId: room, elements: [{ id: "layer", type: "image", label: "Sink", materialQuantity: 2, link: "https://vendor.example/sink", src: "https://vendor.example/sink.png" }] }], presentationSlideOrder: ["p"] } };
  state.items = []; state.rooms = [{ id: room, name: "Bathroom", project_id: project }]; state.products = [];
  state.reads = []; state.writes = []; state.casMiss = false; state.insertFail = false; state.materialMiss = false;
});
it("persists board references before new material rows, scopes writes and returns only after confirming both", async () => {
  const result = await syncSpecBoardForStaff(project, actor, true);
  expect(result.summary.imported).toBe(1); expect(result.updated_at).toBe("next");
  expect(state.writes.map(write => write.table)).toEqual(["design_boards", "material_items", "design_boards"]);
  expect(state.writes[0].filters).toEqual({ project_id: project, updated_at: "before" });
  expect(state.writes[0].patch.updated_by).toBe(actor);
  expect(state.writes[1].inserts[0].project_id).toBe(project);
  expect(state.board.board_state.pages[0].elements[0].materialItemId).toBe(state.items[0].id);
  expect((await syncSpecBoardForStaff(project, actor, true)).summary.imported).toBe(0);
  expect(state.items).toHaveLength(1);
});
it("does not write materials when the board compare-and-swap loses to a newer editor", async () => {
  state.casMiss = true;
  await expect(syncSpecBoardForStaff(project, actor, true)).rejects.toThrow("changed while sending");
  expect(state.items).toHaveLength(0); expect(state.writes.some(write => write.table === "material_items")).toBe(false);
});
it("stops before any writes when the board changed during product scraping", async () => {
  await expect(syncSpecBoardForStaff(project, actor, false, "older")).rejects.toThrow("changed during the product refresh");
  expect(state.writes).toEqual([]);
});
it("retries a failed material insert with its saved board ID, without multiplying rows or changing layouts", async () => {
  state.insertFail = true;
  await expect(syncSpecBoardForStaff(project, actor, true)).rejects.toThrow("new materials could not be saved");
  const savedId = state.board.board_state.pages[0].elements[0].materialItemId;
  state.insertFail = false;
  await syncSpecBoardForStaff(project, actor, true);
  expect(state.items).toHaveLength(1); expect(state.items[0].id).toBe(savedId);
  expect(state.board.board_state.presentationSlideOrder).toEqual(["p"]);
});
it("keeps the board unchanged after scraping and never imports a late selection", async () => {
  await syncSpecBoardForStaff(project, actor, true);
  state.items[0].product_id = actor; state.items[0].product = { id: actor, name: "Exact Sink", price: "$300", dimensions: "24 in" };
  state.board.board_state.pages[0].elements.push({ id: "late", type: "image", label: "Faucet", link: "https://vendor.example/faucet" });
  const result = await syncSpecBoardForStaff(project, actor, false, "next");
  expect(result.summary.imported).toBe(0); expect(state.items).toHaveLength(1);
  expect(result.summary.issues[0].message).toContain("changed during the refresh");
  expect(state.board.board_state.pages[0].elements[0].price).toBeUndefined();
  expect(state.board.board_state.pages[0].elements[0].materialDimensions).toBeUndefined();
});
it("saves new board edits to Materials before advancing the send snapshot, and retries conflicts without losing edits", async () => {
  await syncSpecBoardForStaff(project, actor, true);
  state.items[0].updated_at = "material-before";
  state.items[0].ordered = false; state.items[0].quantity_unit = "count";
  state.board.board_state.pages[0].elements[0].materialQuantity = 3;
  state.materialMiss = true;
  await expect(syncSpecBoardForStaff(project, actor, true)).rejects.toThrow("material changed");
  expect(state.items[0].quantity).toBe(2);
  expect(state.board.board_state.pages[0].materialsSyncSnapshot.materialImages[0].materialQuantity).toBe(2);
  state.materialMiss = false;
  await syncSpecBoardForStaff(project, actor, true);
  expect(state.items[0].quantity).toBe(3);
  expect(state.items[0].quantity_unit).toBe("count"); expect(state.items[0].ordered).toBe(false);
  expect(state.board.board_state.pages[0].materialsSyncSnapshot.materialImages[0].materialQuantity).toBe(3);
});
