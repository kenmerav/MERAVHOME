import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: state.signOut } },
}));
import { returnFromUserView } from "@/lib/userViewExit";
import { USER_VIEW_INFO_KEY } from "@/lib/userView";
const authKey = "merav.user-view.auth.4333c3b8-995d-47ef-aa82-a72f9f3e3342";
const sessionValues = new Map<string, string>();
const localValues = new Map<string, string>();
const replace = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessionValues.clear();
  localValues.clear();
  sessionValues.set(
    USER_VIEW_INFO_KEY,
    JSON.stringify({ id: "viewed-user", auth_key: authKey, expires_at: Date.now() + 1000 }),
  );
  sessionValues.set(authKey, "TEST_ONLY_VIEW_SESSION");
  localValues.set("sb-normal-admin-auth-token", "TEST_ONLY_NORMAL_ADMIN_SESSION");
  state.signOut.mockResolvedValue({ error: null });
  vi.stubGlobal("window", {
    location: { pathname: "/projects", hash: "", replace },
    sessionStorage: {
      getItem: (key: string) => sessionValues.get(key) ?? null,
      removeItem: (key: string) => sessionValues.delete(key),
    },
    localStorage: { getItem: (key: string) => localValues.get(key) ?? null },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("Returning to the admin account", () => {
  it("signs out only the preview session and preserves the normal admin login", async () => {
    await returnFromUserView();
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(sessionValues.has(authKey)).toBe(false);
    expect(sessionValues.has(USER_VIEW_INFO_KEY)).toBe(false);
    expect(localValues.get("sb-normal-admin-auth-token")).toBe("TEST_ONLY_NORMAL_ADMIN_SESSION");
    expect(replace).toHaveBeenCalledWith("/users");
  });
  it("still returns when the network fails", async () => {
    state.signOut.mockRejectedValue(new Error("Offline"));
    await returnFromUserView();
    expect(replace).toHaveBeenCalledWith("/users");
    expect(sessionValues.has(USER_VIEW_INFO_KEY)).toBe(false);
  });
  it("never signs out the normal session if no preview is active", async () => {
    sessionValues.clear();
    await returnFromUserView();
    expect(state.signOut).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/users");
  });
});
