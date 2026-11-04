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
