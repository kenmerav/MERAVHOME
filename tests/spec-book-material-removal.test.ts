import { beforeEach, describe, expect, it, vi } from "vitest";

const projectId = "527d1356-919b-48b9-877e-1924c766282b";
const itemId = "cd3700c1-2889-43f9-b7a7-3e2af36036b1";
const state = vi.hoisted(() => ({
  authenticated: true,
  profile: { role: "Admin", is_active: true, can_view_all_projects: true } as any,
  assigned: true,
  error: null as any,
  rows: [] as any[],
  writes: [] as any[],
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "staff" } : null }, error: null }) },
    from: (table: string) => {
      const filters: Record<string, string> = {};
      let patch: any;
      const query: any = {
        select: () => query,
        eq: (key: string, value: string) => { filters[key] = value; return query; },
        update: (next: any) => { patch = next; return query; },
        maybeSingle: async () => {
          if (table === "user_profiles") return { data: state.profile, error: null };
          if (table === "user_project_assignments") return { data: state.assigned ? { project_id: filters.project_id } : null, error: null };
          if (state.error) return { data: null, error: state.error };
          const row = state.rows.find((row) => row.id === filters.id && row.project_id === filters.project_id);
          if (row && patch) {
            state.writes.push({ table, filters: { ...filters }, patch });
            Object.assign(row, patch);
          }
          return { data: row || null, error: null };
        },
      };
      return query;
    },
  },
}));
import { setSpecBookMaterialRemoved } from "@/lib/specBookMaterialRemoval.server";
import { materialVisibleInProcurement } from "@/lib/materialSelection";

const request = (body: any = { project_id: projectId, item_id: itemId, removed: true }) =>
  new Request("https://studio.test/api/spec-book-material", {
    method: "PATCH", headers: { Authorization: "Bearer TEST_ONLY_TOKEN", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  state.authenticated = true;
  state.profile = { role: "Admin", is_active: true, can_view_all_projects: true };
  state.assigned = true;
  state.error = null;
  state.writes = [];
  state.rows = [
    { id: itemId, project_id: projectId, room_id: "bathroom-3", product_id: "shared-catalog-valve", not_needed: false, ordered: true, procurement_notes: "Paid deposit", source_board_element_id: "board-valve" },
    { id: "other-room-item", project_id: projectId, room_id: "bathroom-2", product_id: "shared-catalog-valve", not_needed: false },
  ];
});
describe("Remove a Spec Book selection from the project", () => {
  it("removes only the selected material and preserves its catalog link and ordering history", async () => {
    const response = await setSpecBookMaterialRemoved(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.writes).toEqual([{ table: "material_items", filters: { id: itemId, project_id: projectId }, patch: { not_needed: true } }]);
    expect(state.rows[0]).toMatchObject({ product_id: "shared-catalog-valve", ordered: true, procurement_notes: "Paid deposit", source_board_element_id: "board-valve" });
    expect(state.rows[1].not_needed).toBe(false);
    expect(materialVisibleInProcurement(state.rows[0])).toBe(false);
  });
  it("restores the same selection with Undo", async () => {
    await setSpecBookMaterialRemoved(request());
    const response = await setSpecBookMaterialRemoved(request({ project_id: projectId, item_id: itemId, removed: false }));
    expect(response.status).toBe(200);
    expect(state.rows[0]).toMatchObject({ not_needed: false, ordered: true, product_id: "shared-catalog-valve" });
    expect(materialVisibleInProcurement(state.rows[0])).toBe(true);
  });
  it.each(["Client", "Contractor", "Builder", "GC"])("denies removal and Undo for %s", async (role) => {
    state.profile.role = role;
    expect((await setSpecBookMaterialRemoved(request())).status).toBe(403);
    expect((await setSpecBookMaterialRemoved(request({ project_id: projectId, item_id: itemId, removed: false }))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });
  it("rejects expired and inactive accounts", async () => {
    state.authenticated = false;
    expect((await setSpecBookMaterialRemoved(request())).status).toBe(401);
    state.authenticated = true;
    state.profile.is_active = false;
    expect((await setSpecBookMaterialRemoved(request())).status).toBe(403);
    expect(state.writes).toEqual([]);
  });
  it("allows a restricted employee only on an assigned project", async () => {
    state.profile = { role: "Employee", is_active: true, can_view_all_projects: false };
    state.assigned = false;
    expect((await setSpecBookMaterialRemoved(request())).status).toBe(403);
    expect(state.writes).toEqual([]);
    state.assigned = true;
    expect((await setSpecBookMaterialRemoved(request())).status).toBe(200);
  });
  it("does not remove an item that belongs to another project", async () => {
    const response = await setSpecBookMaterialRemoved(request({ project_id: "9015b5ff-6343-462b-9539-9e62ed1c52d0", item_id: itemId, removed: true }));
    expect(response.status).toBe(404);
    expect(state.writes).toEqual([]);
  });
  it.each([
    { project_id: projectId, item_id: itemId, removed: true, product_id: "replacement" },
    { project_id: projectId, item_id: itemId, removed: "true" },
    { project_id: projectId, item_id: "invalid", removed: true },
  ])("rejects unsupported changes: %j", async (body) => {
    expect((await setSpecBookMaterialRemoved(request(body))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
  it("reports database failures without claiming a removal succeeded", async () => {
    state.error = new Error("Write failed");
    await expect(setSpecBookMaterialRemoved(request())).rejects.toThrow("Write failed");
    expect(state.writes).toEqual([]);
  });
});
