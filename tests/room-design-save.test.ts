import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  filters: {} as Record<string, unknown>,
  operation: "",
  result: { data: null, error: null } as any,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const q: any = {
        update: () => {
          mock.operation = "update";
          return q;
        },
        insert: () => {
          mock.operation = "insert";
          return q;
        },
        eq: (key: string, value: unknown) => {
          mock.filters[key] = value;
          return q;
        },
        select: () => q,
        maybeSingle: async () => mock.result,
      };
      return q;
    },
  },
}));
import { db } from "@/lib/db";
beforeEach(() => {
  mock.filters = {};
  mock.result = { data: null, error: null };
  mock.operation = "";
});
it("does not overwrite a newer extension import when the row version has changed", async () => {
  expect(
    await db.saveRoomDesignWorkflowIfFresh("project", "kitchen", {}, "staff", "before-import"),
  ).toBeNull();
  expect(mock.filters).toEqual({
    project_id: "project",
    room_id: "kitchen",
    updated_at: "before-import",
  });
});
it("does not replace an imported room when another writer creates it during the first save", async () => {
  mock.result = { data: null, error: { code: "23505" } };
  expect(
    await db.saveRoomDesignWorkflowIfFresh("project", "kitchen", {}, "staff", null),
  ).toBeNull();
  expect(mock.operation).toBe("insert");
});
it("reports a failed version read instead of treating an existing room as empty", async () => {
  mock.result = { data: null, error: new Error("Connection interrupted") };
  await expect(db.getRoomDesignWorkflow("project", "kitchen")).rejects.toThrow(
    "Connection interrupted",
  );
});
