import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  profile: null as any,
  profileError: null as any,
  assignments: [{ project_id: "assigned-1" }] as any[],
  assignmentError: null as any,
  calls: [] as Array<{ table: string; operations: any[] }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: state.userId ? { user: { id: state.userId } } : null },
      }),
    },
    from: (table: string) => {
      const call = { table, operations: [] as any[] };
      state.calls.push(call);
      const result = () => {
        if (table === "user_profiles") return { data: state.profile, error: state.profileError };
        if (table === "user_project_assignments")
          return { data: state.assignments, error: state.assignmentError };
        if (table === "projects")
          return {
            data: call.operations.some(([op]) => op === "maybeSingle")
              ? {
                  id: "assigned-1",
                  client_can_view_construction_docs: true,
                  contractor_can_view_construction_docs: true,
                }
              : [],
            error: null,
          };
        return { data: [], error: null };
      };
      const query: any = { then: (resolve: any) => Promise.resolve(result()).then(resolve) };
      for (const op of ["select", "eq", "in", "order", "limit", "maybeSingle"])
        query[op] = (...args: any[]) => {
          call.operations.push([op, ...args]);
          return query;
        };
      return query;
    },
  },
}));
import { db } from "@/lib/db";
beforeEach(() => {
  state.userId = "user-1";
  state.profile = { id: "user-1", role: "Client", is_active: true, can_view_all_projects: false };
  state.profileError = null;
  state.assignmentError = null;
  state.assignments = [{ project_id: "assigned-1" }];
  state.calls = [];
});
describe("Project access while login is resolving", () => {
  it.each([null, { role: "Client", is_active: false }, { role: "Unknown", is_active: true }])(
    "never requests project rows for a missing/inactive/unknown profile",
    async (profile) => {
      state.profile = profile;
      expect(await db.listProjects()).toEqual([]);
      expect(state.calls.some((x) => x.table === "projects")).toBe(false);
    },
  );
  it("never requests project rows while signed out", async () => {
    state.userId = null;
    expect(await db.listProjects()).toEqual([]);
    expect(state.calls).toEqual([]);
  });
  it("does not turn a failed profile lookup into access to every project", async () => {
    state.profileError = { message: "Unavailable" };
    await expect(db.listProjects()).rejects.toThrow("project access");
    expect(state.calls.some((x) => x.table === "projects")).toBe(false);
  });
  it("fails closed if assignment lookup fails", async () => {
    state.assignmentError = { message: "Unavailable" };
    await expect(db.listProjects()).rejects.toThrow("assigned projects");
    expect(state.calls.some((x) => x.table === "projects")).toBe(false);
  });
  it.each(["Client", "Contractor", "GC", "Builder", "Employee"])(
    "limits %s to assigned project IDs",
    async (role) => {
      state.profile.role = role;
      await db.listProjects();
      expect(state.calls.find((x) => x.table === "projects")?.operations).toContainEqual([
        "in",
        "id",
        ["assigned-1"],
      ]);
    },
  );
  it.each(["Client", "Contractor", "GC", "Builder"])(
    "refuses an unassigned direct project page for %s",
    async (role) => {
      state.profile.role = role;
      expect(await db.getProject("someone-elses-project")).toBeNull();
      expect(state.calls.some((x) => x.table === "projects")).toBe(false);
    },
  );
  it("does not request an authenticated project page before a profile is ready", async () => {
    state.profile = null;
    expect(await db.getProject("assigned-1")).toBeNull();
    expect(state.calls.some((x) => x.table === "projects")).toBe(false);
  });
  it("preserves explicit public Spec Book / QR project access", async () => {
    state.userId = null;
    expect((await db.getProject("assigned-1", { publicView: true }))?.id).toBe("assigned-1");
    expect(state.calls.some((x) => x.table === "projects")).toBe(true);
  });
});
describe("External construction document view", () => {
  it.each(["Client", "Contractor", "GC", "Builder"])(
    "requests only the newest Construction Doc for %s",
    async (role) => {
      state.profile.role = role;
      await db.listProjectDocuments("assigned-1");
      const call = state.calls.find((x) => x.table === "project_documents");
      expect(call?.operations).toContainEqual(["eq", "document_type", "Construction Doc"]);
      expect(call?.operations).toContainEqual(["limit", 1]);
      expect(call?.operations).toContainEqual(["order", "created_at", { ascending: false }]);
    },
  );
  it("keeps the full staff document history", async () => {
    state.profile.role = "Admin";
    await db.listProjectDocuments("assigned-1");
    expect(
      state.calls
        .find((x) => x.table === "project_documents")
        ?.operations.some(([op]) => op === "limit"),
    ).toBe(false);
  });
  it("does not request documents from an unassigned project", async () => {
    expect(await db.listProjectDocuments("someone-elses-project")).toEqual([]);
    expect(state.calls.some((x) => x.table === "project_documents")).toBe(false);
  });
});
