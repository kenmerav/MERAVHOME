import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  profile: { id: "designer", role: "Employee", is_active: true, can_view_all_projects: false },
  assigned: true,
  enrolled: true,
  enabled: true,
  roomMatches: true,
  anonymous: false,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      getUser: async () => ({ data: { user: { id: "designer", is_anonymous: state.anonymous } } }),
    },
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data:
            table === "user_profiles"
              ? state.profile
              : table === "studio_feature_flags"
                ? { enabled: state.enabled }
                : table === "user_project_assignments"
                  ? state.assigned
                    ? { project_id: "p" }
                    : null
                  : table === "room_design_projects"
                    ? state.enrolled
                      ? { project_id: "p" }
                      : null
                    : state.roomMatches
                      ? { id: "r" }
                      : null,
        }),
      };
      return chain;
    },
  },
}));
import { requireRoomDesignPilotAccess } from "../src/lib/roomDesignAuth.server";
const request = () =>
  new Request("https://studio.example/api/room-design", {
    headers: { Authorization: "Bearer test-only-token" },
  });
const scope = { projectId: "p", roomId: "r" };
beforeEach(() =>
  Object.assign(state, {
    profile: { id: "designer", role: "Employee", is_active: true, can_view_all_projects: false },
    assigned: true,
    enrolled: true,
    enabled: true,
    roomMatches: true,
    anonymous: false,
  }),
);
it("allows an assigned active designer to prepare products and images", async () =>
  expect(await requireRoomDesignPilotAccess(request(), scope)).toHaveProperty(
    "user.id",
    "designer",
  ));
it("denies a designer's unassigned project at the server boundary", async () => {
  state.assigned = false;
  const result = await requireRoomDesignPilotAccess(request(), scope);
  expect("error" in result && result.error?.status).toBe(403);
});
it("allows employees already granted all-project access", async () => {
  state.assigned = false;
  state.profile.can_view_all_projects = true;
  expect(await requireRoomDesignPilotAccess(request(), scope)).toHaveProperty(
    "user.id",
    "designer",
  );
});
it.each(["Client", "Contractor"])("denies external %s users", async (role) => {
  state.profile.role = role;
  const result = await requireRoomDesignPilotAccess(request(), scope);
  expect("error" in result && result.error?.status).toBe(403);
});
it("denies inactive and anonymous accounts", async () => {
  state.profile.is_active = false;
  expect(await requireRoomDesignPilotAccess(request(), scope)).toHaveProperty("error.status", 403);
  state.profile.is_active = true;
  state.anonymous = true;
  expect(await requireRoomDesignPilotAccess(request(), scope)).toHaveProperty("error.status", 403);
});
it("honors enrollment, the global switch and room ownership", async () => {
  state.enrolled = false;
  expect(await requireRoomDesignPilotAccess(request(), scope)).toHaveProperty("error.status", 403);
  state.enrolled = true;
  state.enabled = false;
  expect(await requireRoomDesignPilotAccess(request(), scope)).toHaveProperty("error.status", 503);
  state.enabled = true;
  state.roomMatches = false;
  expect(await requireRoomDesignPilotAccess(request(), scope)).toHaveProperty("error.status", 403);
});
