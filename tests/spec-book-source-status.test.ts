import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ viewer: vi.fn(), board: vi.fn(), client: vi.fn() }));
function query(result: () => unknown) {
  const chain: any = {};
  for (const method of ["select", "eq", "order", "range", "maybeSingle"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
  return chain;
}
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    mock.client(...args);
    return { from: () => query(mock.viewer) };
  },
}));
vi.mock("../src/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => query(mock.board) },
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
import { getSpecBookSourceStatus } from "../src/routes/api/spec-book-source-status";

const projectId = "11111111-1111-4111-8111-111111111111";
const material = { id: "material-1", project_id: projectId, source_board_id: projectId,
  source_board_page_id: "removed-page", source_board_element_id: "faucet" };
const request = (headers = {}) => new Request(`https://studio.example/api/spec-book-source-status?projectId=${projectId}`, { headers });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://test.example");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  mock.viewer.mockResolvedValue({ data: [material], error: null });
  mock.board.mockResolvedValue({ data: { board_state: { pages: [] } }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("Spec Book source status access", () => {
  it("returns only visible material IDs, never private board contents", async () => {
    const response = await getSpecBookSourceStatus(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ staleMaterialIds: [material.id] });
    expect(mock.client.mock.calls[0][1]).toBe("test-publishable-key");
    expect(mock.client.mock.calls[0][2].global.headers).toEqual({});
  });
  it("uses the caller's auth context for Materials RLS", async () => {
    await getSpecBookSourceStatus(request({ Authorization: "Bearer test-user-token" }));
    expect(mock.client.mock.calls[0][2].global.headers).toEqual({ Authorization: "Bearer test-user-token" });
  });
  it("does not read private boards when RLS exposes no materials", async () => {
    mock.viewer.mockResolvedValue({ data: [], error: null });
    expect(await (await getSpecBookSourceStatus(request())).json()).toEqual({ staleMaterialIds: [] });
    expect(mock.board).not.toHaveBeenCalled();
  });
  it("supports projects with more than one page of Materials", async () => {
    mock.viewer.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, n) => ({ ...material, id: `material-${n}` })), error: null })
      .mockResolvedValueOnce({ data: [{ ...material, id: "last-material" }], error: null });
    const response = await getSpecBookSourceStatus(request());
    const body = await response.json();
    expect(body.staleMaterialIds).toHaveLength(1001);
    expect(body.staleMaterialIds.at(-1)).toBe("last-material");
  });
  it("keeps manual Materials when the project has no board", async () => {
    mock.board.mockResolvedValue({ data: null, error: null });
    expect(await (await getSpecBookSourceStatus(request())).json()).toEqual({ staleMaterialIds: [] });
  });
  it("blocks rendering stale selections if validation fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mock.board.mockResolvedValue({ data: null, error: new Error("Database unavailable") });
    expect((await getSpecBookSourceStatus(request())).status).toBe(503);
    mock.viewer.mockResolvedValue({ data: null, error: new Error("RLS denied") });
    mock.board.mockClear();
    expect((await getSpecBookSourceStatus(request())).status).toBe(503);
    expect(mock.board).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("rejects invalid project IDs before querying", async () => {
    expect((await getSpecBookSourceStatus(new Request("https://studio.example/api/spec-book-source-status?projectId=invalid"))).status).toBe(400);
    expect(mock.client).not.toHaveBeenCalled();
  });
});
