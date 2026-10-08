import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  USER_VIEW_INFO_KEY,
  isUserViewTab,
  userViewAuthKey,
  userViewRequestAllowed,
} from "@/lib/userView";
const channel = "4333c3b8-995d-47ef-aa82-a72f9f3e3342";
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("window", {
    location: { pathname: "/view-user", hash: `#${channel}`, origin: "https://studio.test" },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("Separate account-view sessions", () => {
  it("uses a separate auth key for each tab and retains it when navigating or reloading", () => {
    expect(isUserViewTab()).toBe(true);
    expect(userViewAuthKey()).toBe(`merav.user-view.auth.${channel}`);
    storage.set(
      USER_VIEW_INFO_KEY,
      JSON.stringify({
        id: "target",
        auth_key: `merav.user-view.auth.${channel}`,
        expires_at: Date.now() + 1000,
      }),
    );
    window.location.pathname = "/projects";
    window.location.hash = "";
    expect(isUserViewTab()).toBe(true);
    expect(userViewAuthKey()).toBe(`merav.user-view.auth.${channel}`);
    storage.clear();
    expect(isUserViewTab()).toBe(false);
  });
  it("does not accept the normal admin auth storage key from preview metadata", () => {
    storage.set(
      USER_VIEW_INFO_KEY,
      JSON.stringify({
        id: "target",
        auth_key: "sb-normal-admin-auth-token",
        expires_at: Date.now() + 1000,
      }),
    );
    expect(userViewAuthKey()).not.toBe("sb-normal-admin-auth-token");
  });
});
describe("View-only requests", () => {
  it("blocks writes before they reach the network and marks Studio reads as view-only", async () => {
    vi.resetModules();
    const network = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    window.fetch = network;
    const { installUserViewFetchGuard } = await import("@/lib/userView");
    installUserViewFetchGuard("https://database.supabase.co");
    expect(
      (
        await window.fetch("https://database.supabase.co/rest/v1/material_items", {
          method: "PATCH",
        })
      ).status,
    ).toBe(403);
    expect(network).not.toHaveBeenCalled();
    await window.fetch("https://studio.test/api/client-dashboard");
    expect(new Headers(network.mock.calls[0][1].headers).get("x-merav-user-view")).toBe("1");
  });
  it("blocks reads after expiration but still allows ending the isolated session", async () => {
    vi.resetModules();
    storage.set(
      USER_VIEW_INFO_KEY,
      JSON.stringify({ id: "target", expires_at: Date.now() - 1000 }),
    );
    const network = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    window.fetch = network;
    const { installUserViewFetchGuard } = await import("@/lib/userView");
    installUserViewFetchGuard("https://database.supabase.co");
    expect((await window.fetch("https://studio.test/api/client-dashboard")).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
    expect(
      (await window.fetch("https://database.supabase.co/auth/v1/logout", { method: "POST" }))
        .status,
    ).toBe(200);
  });
  const allowed = (path: string, method: string) =>
    userViewRequestAllowed(
      new URL(path),
      method,
      "https://studio.test",
      "https://database.supabase.co",
    );
  it("allows reads while blocking app and database writes", () => {
    expect(allowed("https://studio.test/api/client-dashboard", "GET")).toBe(true);
    expect(allowed("https://database.supabase.co/rest/v1/projects", "GET")).toBe(true);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(allowed("https://studio.test/api/users", method)).toBe(false);
      expect(allowed("https://database.supabase.co/rest/v1/material_items", method)).toBe(false);
    }
    expect(allowed("https://database.supabase.co/rest/v1/rpc/write_something", "POST")).toBe(false);
    expect(
      allowed("https://database.supabase.co/storage/v1/object/product-images/item.png", "POST"),
    ).toBe(false);
  });
  it("allows isolated sign-in, refresh, local logout, and signed file downloads", () => {
    for (const path of [
      "/auth/v1/verify",
      "/auth/v1/logout",
      "/auth/v1/token?grant_type=refresh_token",
      "/storage/v1/object/sign/project-documents/document.pdf",
    ])
      expect(allowed(`https://database.supabase.co${path}`, "POST")).toBe(true);
    expect(allowed("https://database.supabase.co/auth/v1/user", "PUT")).toBe(false);
    expect(allowed("https://database.supabase.co/auth/v1/admin/generate_link", "POST")).toBe(false);
  });
});
