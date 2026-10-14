import { beforeEach, afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
import { createStudioSessionRequest } from "@/lib/studioSessionRequest";
const session = (token: string, user = "staff") => ({
  data: { session: { access_token: token, user: { id: user } } },
  error: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockReset().mockResolvedValue(session("current"));
  auth.refreshSession.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it("uses renewed tokens across requests during a long run", async () => {
  auth.getSession
    .mockResolvedValueOnce(session("initial"))
    .mockResolvedValueOnce(session("initial"))
    .mockResolvedValue(session("renewed"));
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  const request = await createStudioSessionRequest();
  await request("/api/scrape-materials", { method: "POST" });
  await request("/api/check-spec-completion", { method: "POST" });
  expect(
    fetcher.mock.calls.map((call) => new Headers(call[1].headers).get("Authorization")),
  ).toEqual(["Bearer initial", "Bearer renewed"]);
});
it("renews and retries an authorization rejection once with the exact same body", async () => {
  auth.refreshSession.mockResolvedValue(session("renewed"));
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: "expired" }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  const request = await createStudioSessionRequest();
  expect(
    (await request("/api/scrape-materials", { method: "PUT", body: '{"rows":[]}' })).status,
  ).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls.map((call) => call[1].body)).toEqual(['{"rows":[]}', '{"rows":[]}']);
  expect(new Headers(fetcher.mock.calls[1][1].headers).get("Authorization")).toBe("Bearer renewed");
});
it("does not loop if the renewed session is also rejected", async () => {
  auth.refreshSession.mockResolvedValue(session("renewed"));
  const fetcher = vi
    .fn()
    .mockImplementation(() => Response.json({ error: "expired" }, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  const request = await createStudioSessionRequest();
  expect((await request("/api/check-spec-completion", { method: "POST" })).status).toBe(401);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(auth.refreshSession).toHaveBeenCalledTimes(1);
});
it.each([403, 500])("does not retry status %s or start additional work", async (status) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "stopped" }, { status }));
  vi.stubGlobal("fetch", fetcher);
  const request = await createStudioSessionRequest();
  await request("/api/check-spec-completion", { method: "POST" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(auth.refreshSession).not.toHaveBeenCalled();
});
it("stops if another user signs in during a run", async () => {
  auth.getSession
    .mockResolvedValueOnce(session("initial"))
    .mockResolvedValue(session("other", "different-staff"));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const request = await createStudioSessionRequest();
  await expect(request("/api/scrape-materials", { method: "POST" })).rejects.toThrow(
    "sign-in expired",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps credentials away from other destinations", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const request = await createStudioSessionRequest();
  await expect(request("https://retailer.test/api/scrape", { method: "POST" })).rejects.toThrow(
    "Invalid Studio request",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
