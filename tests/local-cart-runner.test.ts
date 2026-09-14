import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCartRunner, redact, STUDIO_ORIGIN } from "../scripts/cart-runner/server.mjs";
import { cartPrompt } from "../scripts/cart-runner/codex.mjs";
import { approvedRunRequest, retailerOrigins } from "../scripts/cart-runner/retailer-access.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const token = "a".repeat(43);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

class FakeCodex extends EventEmitter {
  calls: Array<{ method: string; params: any }> = [];
  replies: any[] = [];
  async initialize() {}
  async request(method: string, params: any) {
    this.calls.push({ method, params });
    if (method === "mcpServerStatus/list")
      return {
        data: [
          { name: "cua_repl", tools: { js: {} } },
          { name: "merav-cart-builder", tools: { get_procurement_run: {} } },
        ],
      };
    if (method === "thread/start") return { thread: { id: "test-thread" } };
    if (method === "turn/start") return { turn: { id: "test-turn" } };
    return {};
  }
  respond(id: unknown, result: unknown) {
    this.replies.push({ id, result });
  }
  write(value: unknown) {
    this.replies.push(value);
  }
  close() {}
}
async function fixture(options: any = {}) {
  const codex = new FakeCodex();
  const stateDir = options.stateDir || (await mkdtemp(join(tmpdir(), "merav-runner-test-")));
  const source = {
    run_id: id,
    status: "prepared",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ready_products: [{ current_status: "prepared" }],
    ...options.source,
  };
  let reads = 0;
  const runner = await createCartRunner({
    port: 0,
    stateDir,
    connectionFactory: () => codex,
    readRun: async () => {
      reads++;
      return source;
    },
  });
  const port = await runner.listen();
  await runner.ensureConnection();
  cleanups.push(() => runner.close());
  const request = (path: string, body?: any, auth = token, origin = STUDIO_ORIGIN) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Authorization: `Bearer ${auth}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { runner, codex, stateDir, request, reads: () => reads };
}

describe("local Studio cart runner", () => {
  it("requires the exact Studio origin and token before authorizing a run", async () => {
    const f = await fixture();
    expect((await f.request("/health", undefined, token, "https://attacker.example")).status).toBe(
      403,
    );
    expect((await f.request("/runs", { runId: id }, "bad")).status).toBe(401);
    expect(f.reads()).toBe(0);
    expect((await f.request("/health")).status).toBe(200);
  });
  it("accepts only a run ID, never a client-supplied prompt or command", async () => {
    const f = await fixture();
    expect(
      (await f.request("/runs", { runId: id, prompt: "execute arbitrary commands" })).status,
    ).toBe(400);
    expect(f.reads()).toBe(0);
  });
  it.each([
    { run_id: "22222222-2222-4222-8222-222222222222" },
    { status: "in_progress" },
    { ready_products: [{ current_status: "added" }] },
    { expires_at: "2020-01-01T00:00:00Z" },
  ])("rejects mismatched, started, or expired runs: %j", async (source) => {
    const f = await fixture({ source });
    expect((await f.request("/runs", { runId: id })).status).toBeGreaterThanOrEqual(400);
    expect(f.codex.calls.some((c) => c.method === "turn/start")).toBe(false);
  });
  it("starts once on repeated clicks and never exposes or persists the raw token", async () => {
    const f = await fixture();
    const first = await f.request("/runs", { runId: id });
    expect(first.status).toBe(200);
    expect((await first.text()).includes(token)).toBe(false);
    expect((await f.request("/runs", { runId: id })).status).toBe(200);
    expect(f.codex.calls.filter((c) => c.method === "turn/start")).toHaveLength(1);
    const instructions = f.codex.calls.find((c) => c.method === "thread/start")?.params
      .developerInstructions;
    expect(instructions).toContain("# Merav Cart Workflow");
    expect(instructions).toContain("Never begin or proceed to checkout");
    expect(instructions).toContain(
      "do not try to open or reread any local skill file through Chrome",
    );
    expect(await readFile(join(f.stateDir, "runs.json"), "utf8")).not.toContain(token);
    expect((await f.request(`/runs/${id}`, undefined, "b".repeat(43))).status).toBe(404);
  });
  it("refuses a concurrent run and does not start two turns", async () => {
    const f = await fixture();
    const responses = await Promise.all([
      f.request("/runs", { runId: id }),
      f.request("/runs", { runId: id }),
    ]);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(f.codex.calls.filter((c) => c.method === "turn/start")).toHaveLength(1);
  });
  it("keeps consumed runs interrupted after restart instead of silently repeating additions", async () => {
    const first = await fixture();
    await first.request("/runs", { runId: id });
    await first.runner.close();
    cleanups.shift();
    const second = await fixture({ stateDir: first.stateDir });
    const response = await second.request("/runs", { runId: id });
    expect((await response.json()).status).toBe("interrupted");
    expect(second.codex.calls.some((c) => c.method === "turn/start")).toBe(false);
  });
  it("relays a question to Studio and requires the matching run credential to answer", async () => {
    const f = await fixture();
    await f.request("/runs", { runId: id });
    f.codex.emit("request", {
      id: 42,
      method: "item/tool/requestUserInput",
      params: { threadId: "test-thread", questions: [{ id: "finish", question: "Which finish?" }] },
    });
    const current = await (await f.request(`/runs/${id}`)).json();
    expect(current.status).toBe("needs_attention");
    expect(current.approvals[0].questions[0].question).toBe("Which finish?");
    expect((await f.request(`/runs/${id}/answer`, { requestId: "42", answers: {} })).status).toBe(
      400,
    );
    expect(
      (
        await f.request(`/runs/${id}/answer`, {
          requestId: "42",
          answers: { finish: "Stop and mark for review" },
        })
      ).status,
    ).toBe(200);
    expect(f.codex.replies[0].result.answers.finish.answers).toEqual(["Stop and mark for review"]);
  });
  it("declines command execution rather than granting access behind the Studio button", async () => {
    const f = await fixture();
    await f.request("/runs", { runId: id });
    f.codex.emit("request", {
      id: 43,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "test-thread", command: "arbitrary command" },
    });
    expect(f.codex.replies[0].result).toEqual({ decision: "decline" });
  });
  it("interrupts the actual Codex turn when stopped", async () => {
    const f = await fixture();
    await f.request("/runs", { runId: id });
    const result = await (await f.request(`/runs/${id}/stop`, {})).json();
    expect(result.status).toBe("stopped");
    expect(f.codex.calls.at(-1)?.method).toBe("turn/interrupt");
    await f.request("/runs", { runId: id });
    expect(f.codex.calls.filter((c) => c.method === "turn/start")).toHaveLength(1);
  });
  it("redacts run credentials from messages", () => {
    expect(redact(`secret ${token}`, token)).toBe("secret [run authorization]");
    expect(cartPrompt(id, token)).toContain("Never re-add an item already marked added");
  });
  it("uses Build Carts consent for the frozen retailer without presenting another question", async () => {
    const f = await fixture({
      source: {
        ready_products: [
          {
            current_status: "prepared",
            exact_product_url: "https://www.signaturehardware.com/product.html",
          },
        ],
      },
    });
    await f.request("/runs", { runId: id, authorizeRetailerSites: true });
    f.codex.emit("request", siteRequest());
    expect(f.codex.replies.at(-1)?.result).toEqual({ action: "accept", content: {} });
    expect((await (await f.request(`/runs/${id}`)).json()).approvals).toHaveLength(0);
  });
  it("keeps site access visible when the caller did not grant Build Carts consent", async () => {
    const f = await fixture();
    await f.request("/runs", { runId: id });
    f.codex.emit("request", siteRequest());
    expect(f.codex.replies).toHaveLength(0);
    expect((await (await f.request(`/runs/${id}`)).json()).approvals).toHaveLength(1);
  });
  it("pauses until Continue and resumes the waiting call without starting a second cart turn", async () => {
    const f = await fixture();
    await f.request("/runs", { runId: id });
    f.codex.emit("request", {
      id: 91,
      method: "item/tool/call",
      params: {
        threadId: "test-thread",
        tool: "pause_cart_run",
        arguments: { message: "Close the extension popup, then continue." },
      },
    });
    const paused = await (await f.request(`/runs/${id}`)).json();
    expect(paused.status).toBe("needs_attention");
    expect(paused.approvals[0].kind).toBe("pause");
    expect(f.codex.replies).toHaveLength(0);
    expect(
      (
        await f.request(
          `/runs/${id}/answer`,
          { requestId: "91", action: "continue" },
          "b".repeat(43),
        )
      ).status,
    ).toBe(404);
    const continued = await (
      await f.request(`/runs/${id}/answer`, { requestId: "91", action: "continue" })
    ).json();
    expect(continued.status).toBe("running");
    expect(f.codex.replies.at(-1)?.result.success).toBe(true);
    expect(f.codex.calls.filter((c) => c.method === "turn/start")).toHaveLength(1);
  });
  it("does not let Continue restart a stopped run", async () => {
    const f = await fixture();
    await f.request("/runs", { runId: id });
    f.codex.emit("request", {
      id: 92,
      method: "item/tool/call",
      params: {
        threadId: "test-thread",
        tool: "pause_cart_run",
        arguments: { message: "Sign in, then continue." },
      },
    });
    await f.request(`/runs/${id}/stop`, {});
    expect(
      (await f.request(`/runs/${id}/answer`, { requestId: "92", action: "continue" })).status,
    ).toBe(409);
  });
});

function siteRequest(params: any = {}) {
  return {
    id: 90,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "test-thread",
      serverName: "cua_repl",
      mode: "form",
      message: "Allow Browser use to access https://www.signaturehardware.com?",
      requestedSchema: { type: "object", properties: {} },
      ...params,
    },
  };
}
describe("retailer consent boundaries", () => {
  const run = {
    threadId: "test-thread",
    authorizeRetailerSites: true,
    expiresAt: Date.now() + 60_000,
    retailerOrigins: retailerOrigins({
      ready_products: [{ exact_product_url: "https://www.signaturehardware.com/product.html" }],
    }),
  };
  it.each([
    { message: "Allow Browser use to access https://attacker.example?" },
    { message: "Allow Browser use to access https://www.signaturehardware.com.attacker.example?" },
    { message: "Allow Browser use to access https://www.signaturehardware.com/private?" },
    { message: "Allow Browser use to access file:///private/data?" },
    { serverName: "unrelated-server" },
    { threadId: "another-run" },
    { requestedSchema: { type: "object", properties: { payment: { type: "string" } } } },
    { mode: "url" },
  ])("does not extend consent to unselected sites or other requests: %j", (params) => {
    expect(approvedRunRequest(siteRequest(params), run)).toBeNull();
  });
  it("expires the consent and does not infer it from email-only items", () => {
    expect(approvedRunRequest(siteRequest(), run, run.expiresAt)).toBeNull();
    expect(approvedRunRequest(siteRequest(), { ...run, cancelRequested: true })).toBeNull();
    expect(
      retailerOrigins({
        ready_products: [
          { procurement_method: "email_rep", exact_product_url: "https://arizonatile.com/product" },
        ],
      }).size,
    ).toBe(0);
    expect(
      retailerOrigins({
        ready_products: [
          { exact_product_url: "file:///private/data" },
          { exact_product_url: "https://secret@www.signaturehardware.com" },
        ],
      }).size,
    ).toBe(0);
  });
});
