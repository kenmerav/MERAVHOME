import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  email: "kipshearer@gmail.com",
  authenticated: true,
  profile: { role: "Client", is_active: true, email: "kipshearer@gmail.com" } as any,
  assignment: { project_id: "assigned-1" } as any,
  project: { id: "assigned-1", client_can_view_spec_book: true } as any,
  updates: [] as any[],
  saveError: null as any,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      getUser: async () => ({
        data: { user: state.authenticated ? { id: "user-1", email: state.email } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      let updating = false;
      const query: any = {
        select: () => query,
        eq: () => query,
        update: (patch: any) => {
          updating = true;
          state.updates.push(patch);
          return query;
        },
        single: async () => ({
          data: state.saveError ? null : { id: "item-1", ...state.updates.at(-1) },
          error: state.saveError,
        }),
        maybeSingle: async () => ({
          data:
            table === "user_profiles"
              ? state.profile
              : table === "material_items"
                ? { id: "item-1", project_id: "assigned-1" }
                : table === "user_project_assignments"
                  ? state.assignment
                  : state.project,
          error: null,
        }),
      };
      return query;
    },
  },
}));
import { updateSpecOrdering } from "@/lib/specOrdering.server";
import { canEditSpecBook, canUpdateSpecOrderingForRole } from "@/lib/permissions";
function request(patch: Record<string, unknown> = { ordered: true }) {
  return new Request("https://studio.test/api/spec-ordering", {
    method: "PATCH",
    headers: { Authorization: "Bearer TEST_ONLY_TOKEN", "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: "d53ce9f9-051d-484a-92f4-d84d80dc2c8a", ...patch }),
  });
}
beforeEach(() => {
  state.email = "kipshearer@gmail.com";
  state.authenticated = true;
  state.profile = { role: "Client", is_active: true, email: state.email };
  state.assignment = { project_id: "assigned-1" };
  state.project = { id: "assigned-1", client_can_view_spec_book: true };
  state.updates = [];
  state.saveError = null;
});
describe("Kip's Ordered status access", () => {
  it.each([true, false])("saves only the Ordered boolean (%s)", async (ordered) => {
    const response = await updateSpecOrdering(request({ ordered }));
    expect(response.status).toBe(200);
    expect(state.updates).toEqual([{ ordered }]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("does not grant Kip product, price or quantity editing", () => {
    expect(canUpdateSpecOrderingForRole(state.profile, state.project)).toBe(true);
    expect(canEditSpecBook(state.profile)).toBe(false);
  });
  it.each([{ ordered_by: "Client" }, { ordered: true, ordered_by: "Merav" }])(
    "rejects who-is-ordering changes from Kip",
    async (patch) => {
      expect((await updateSpecOrdering(request(patch))).status).toBe(403);
      expect(state.updates).toEqual([]);
    },
  );
  it.each([{ quantity: 10 }, { price: 1 }, { project_id: "other" }, { ordered: "true" }, {}])(
    "rejects broader/invalid patches",
    async (patch) => {
      expect((await updateSpecOrdering(request(patch))).status).toBe(400);
      expect(state.updates).toEqual([]);
    },
  );
  it("rejects another client even if the profile claims Kip's email", async () => {
    state.email = "someone-else@example.test";
    expect((await updateSpecOrdering(request())).status).toBe(403);
    expect(state.updates).toEqual([]);
  });
  it("rejects an unassigned project", async () => {
    state.assignment = null;
    expect((await updateSpecOrdering(request())).status).toBe(403);
    expect(state.updates).toEqual([]);
  });
  it("rejects a project whose Spec Book is no longer shared", async () => {
    state.project.client_can_view_spec_book = false;
    expect((await updateSpecOrdering(request())).status).toBe(403);
    expect(state.updates).toEqual([]);
  });
  it("rejects an inactive account", async () => {
    state.profile.is_active = false;
    expect((await updateSpecOrdering(request())).status).toBe(403);
    expect(state.updates).toEqual([]);
  });
  it("rejects an expired login", async () => {
    state.authenticated = false;
    expect((await updateSpecOrdering(request())).status).toBe(401);
    expect(state.updates).toEqual([]);
  });
  it("preserves staff editing of both ordering fields", async () => {
    state.profile.role = "Admin";
    state.email = "ken@meravinteriors.com";
    expect((await updateSpecOrdering(request({ ordered: true, ordered_by: "Merav" }))).status).toBe(
      200,
    );
    expect(state.updates).toEqual([{ ordered: true, ordered_by: "Merav" }]);
  });
  it("does not report success after a failed save", async () => {
    state.saveError = new Error("Database unavailable");
    await expect(updateSpecOrdering(request())).rejects.toThrow("Database unavailable");
  });
});
