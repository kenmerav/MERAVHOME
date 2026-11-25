import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; patch: unknown; id?: string }>,
  response: { data: { id: "material-1" }, error: null } as any,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const query = {
        update(patch: unknown) { state.writes.push({ table, patch }); return query; },
        upsert(patch: unknown) { state.writes.push({ table, patch }); return query; },
        eq(_field: string, id: string) { state.writes[state.writes.length - 1].id = id; return query; },
        select() { return query; },
        async maybeSingle() { return state.response; },
      };
      return query;
    },
  },
}));

import { db } from "@/lib/db";

beforeEach(() => {
  state.writes = [];
  state.response = { data: { id: "material-1" }, error: null };
});

describe("Procurement status saves", () => {
  it.each([true, false])("saves the per-selection availability flag (%s)", async (outOfStock) => {
    state.response = { data: { id: "material-1", out_of_stock: outOfStock }, error: null };
    expect(await db.updateProcurementAvailability("material-1", outOfStock)).toEqual(state.response.data);
    expect(state.writes).toEqual([{
      table: "procurement_item_availability",
      patch: { material_item_id: "material-1", out_of_stock: outOfStock },
    }]);
  });

  it("reports a failed availability save instead of confirming it", async () => {
    state.response = { data: null, error: { message: "Permission denied" } };
    await expect(db.updateProcurementAvailability("material-1", true)).rejects.toThrow("Permission denied");
    state.response = { data: null, error: null };
    await expect(db.updateProcurementAvailability("missing", false)).rejects.toThrow("could not be updated");
  });

  it.each(["Won’t ship until mid-March", ""])("saves a procurement note without overwriting stock or ordering status (%s)", async (notes) => {
    state.response = { data: { id: "material-1", notes }, error: null };
    expect(await db.updateProcurementNote("material-1", `  ${notes}  `)).toEqual(state.response.data);
    expect(state.writes).toEqual([{
      table: "procurement_item_availability",
      patch: { material_item_id: "material-1", notes },
    }]);
  });

  it("reports a note save failure", async () => {
    state.response = { data: null, error: { message: "Permission denied" } };
    await expect(db.updateProcurementNote("material-1", "Delayed")).rejects.toThrow("Permission denied");
    state.response = { data: null, error: null };
    await expect(db.updateProcurementNote("missing", "Delayed")).rejects.toThrow("could not be updated");
  });

  it.each(["ordered", "received", "installed"] as const)("confirms the saved %s field on the material row", async (key) => {
    state.response = { data: { id: "material-1", [key]: false, updated_at: "2026-11-25" }, error: null };
    expect(await db.updateProcurement("material-1", { [key]: false })).toEqual(state.response.data);
    expect(state.writes).toEqual([{
      table: "material_items", id: "material-1", patch: { [key]: false },
    }]);
  });

  it("reports a rejected save and an update that changed no matching row", async () => {
    state.response = { data: null, error: { message: "Permission denied" } };
    await expect(db.updateProcurement("material-1", { ordered: true })).rejects.toThrow("Permission denied");
    state.response = { data: null, error: null };
    await expect(db.updateProcurement("missing", { received: true })).rejects.toThrow("could not be updated");
  });
});

describe("Spec Book saves to Materials", () => {
  it("saves the category to the matching material item", async () => {
    await db.updateSpecMaterialItem("material-1", { category: "Tile & Stone" });
    expect(state.writes).toEqual([{ table: "material_items", id: "material-1", patch: { category: "Tile & Stone" } }]);
  });

  it("does not report success when the database rejects the edit", async () => {
    state.response = { data: null, error: { message: "Permission denied" } };
    await expect(db.updateSpecMaterialItem("material-1", { color: "Black" })).rejects.toThrow("Permission denied");
  });

  it("does not report success if no Materials item was updated", async () => {
    state.response = { data: null, error: null };
    await expect(db.updateSpecMaterialItem("missing", { notes: "test" })).rejects.toThrow("could not be updated");
  });
});
