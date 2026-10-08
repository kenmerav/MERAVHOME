import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  profiles: [] as any[],
  getUser: vi.fn(),
  getUserById: vi.fn(),
  generateLink: vi.fn(),
  createUser: vi.fn(),
  updateUserById: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      getUser: state.getUser,
      admin: {
        getUserById: state.getUserById,
        generateLink: state.generateLink,
        createUser: state.createUser,
        updateUserById: state.updateUserById,
      },
    },
    from: () => {
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: state.profiles.shift(), error: null }),
      };
      return query;
    },
  },
}));
import { startUserView } from "@/lib/userView.server";
const targetId = "d53ce9f9-051d-484a-92f4-d84d80dc2c8a";
const admin = { email: "ken@meravinteriors.com", role: "Admin", is_active: true, is_owner: false };
const target = {
  id: targetId,
  email: "client@example.test",
  full_name: "Test Client",
  role: "Client",
  is_active: true,
};
function request(userId = targetId, overrides: Record<string, string> = {}) {
  return new Request("https://studio.test/api/view-user", {
    method: "POST",
    headers: {
      Authorization: "Bearer TEST_ONLY_ADMIN_TOKEN",
      Origin: "https://studio.test",
      "Content-Type": "application/json",
      ...overrides,
    },
    body: JSON.stringify({ user_id: userId }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.profiles = [admin, target];
  state.getUser.mockResolvedValue({
    data: {
      user: { id: "admin-id", email: admin.email, email_confirmed_at: "2026-01-01T00:00:00Z" },
    },
    error: null,
  });
  state.getUserById.mockResolvedValue({
    data: {
      user: { id: targetId, email: target.email, email_confirmed_at: "2026-01-01T00:00:00Z" },
    },
    error: null,
  });
  state.generateLink.mockResolvedValue({
    data: {
      user: { id: targetId },
      properties: {
        hashed_token: "TEST_ONLY_ONE_TIME_HASH",
        action_link: "https://test.invalid/not-returned",
        email_otp: "NOT_RETURNED",
      },
    },
    error: null,
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
describe("Admin-only account views", () => {
  it("does not confirm an unfinished account by previewing it", async () => {
    state.getUserById.mockResolvedValue({
      data: { user: { id: targetId, email: target.email, email_confirmed_at: null } },
      error: null,
    });
    expect((await startUserView(request())).status).toBe(400);
    expect(state.generateLink).not.toHaveBeenCalled();
  });
  it("rejects a forged admin profile when the verified login belongs to someone else", async () => {
    state.getUser.mockResolvedValue({
      data: {
        user: {
          id: "admin-id",
          email: "client@example.test",
          email_confirmed_at: "2026-01-01T00:00:00Z",
        },
      },
      error: null,
    });
    expect((await startUserView(request())).status).toBe(403);
    expect(state.generateLink).not.toHaveBeenCalled();
  });
  it("uses an existing active account and returns only the one-time grant and display information", async () => {
    const response = await startUserView(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(["expires_at", "token_hash", "user"]);
    expect(body.user.id).toBe(targetId);
    expect(body.expires_at).toBeGreaterThan(Date.now());
    expect(state.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: target.email });
    expect(state.createUser).not.toHaveBeenCalled();
    expect(state.updateUserById).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...admin, is_active: false },
    { ...admin, role: "Employee" },
    { ...admin, role: "Client" },
    { ...admin, email: "other@example.test" },
  ])("rejects an unauthorized or inactive actor before creating a grant", async (actor) => {
    state.profiles = [actor, target];
    expect((await startUserView(request())).status).toBe(403);
    expect(state.generateLink).not.toHaveBeenCalled();
  });
  it("rejects an invalid bearer session", async () => {
    state.getUser.mockResolvedValue({ data: { user: null }, error: new Error("Expired") });
    expect((await startUserView(request())).status).toBe(401);
    expect(state.generateLink).not.toHaveBeenCalled();
  });
  it("rejects missing bearer credentials and cross-origin launch requests", async () => {
    expect((await startUserView(request(targetId, { Authorization: "" }))).status).toBe(401);
    expect((await startUserView(request(targetId, { Origin: "https://other.test" }))).status).toBe(
      403,
    );
    expect(state.generateLink).not.toHaveBeenCalled();
  });
  it("rejects an inactive target and a mismatched login account", async () => {
    state.profiles = [admin, { ...target, is_active: false }];
    expect((await startUserView(request())).status).toBe(400);
    state.profiles = [admin, target];
    state.getUserById.mockResolvedValue({
      data: { user: { email: "different@example.test" } },
      error: null,
    });
    expect((await startUserView(request())).status).toBe(400);
    expect(state.generateLink).not.toHaveBeenCalled();
  });
  it("rejects a malformed target ID and a grant for the wrong user", async () => {
    expect((await startUserView(request("invalid"))).status).toBe(400);
    state.profiles = [admin, target];
    state.generateLink.mockResolvedValue({
      data: { user: { id: "wrong-user" }, properties: { hashed_token: "TEST_ONLY_HASH" } },
      error: null,
    });
    expect((await startUserView(request())).status).toBe(500);
  });
});
