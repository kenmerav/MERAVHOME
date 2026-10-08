import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: state.create }));
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
const normal = storage();
const tab = storage();
const channel = "4333c3b8-995d-47ef-aa82-a72f9f3e3342";
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://database.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "TEST_ONLY_PUBLIC_KEY");
  vi.stubGlobal("localStorage", normal);
  vi.stubGlobal("window", {
    location: { pathname: "/view-user", hash: `#${channel}`, origin: "https://studio.test" },
    sessionStorage: tab,
    localStorage: normal,
    fetch: vi.fn(),
  });
  state.create.mockReturnValue({ auth: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Supabase account-view session isolation", () => {
  it("stores the viewed account only in this tab with its own auth channel", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    void supabase.auth;
    const options = state.create.mock.calls[0][2];
    expect(options.auth.storage).toBe(tab);
    expect(options.auth.storageKey).toBe(`merav.user-view.auth.${channel}`);
    expect(options.auth.detectSessionInUrl).toBe(false);
  });
  it("leaves the normal admin session storage and default key unchanged", async () => {
    window.location.pathname = "/users";
    const { supabase } = await import("@/integrations/supabase/client");
    void supabase.auth;
    const options = state.create.mock.calls[0][2];
    expect(options.auth.storage).toBe(normal);
    expect(options.auth.storageKey).toBeUndefined();
  });
});
