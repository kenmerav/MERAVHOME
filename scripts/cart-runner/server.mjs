import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CodexConnection, cartPrompt } from "./codex.mjs";
import { approvedRunRequest, retailerOrigins } from "./retailer-access.mjs";

export const PORT = 43189;
export const STUDIO_ORIGIN = "https://studio.meravinteriors.com";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const terminal = new Set(["finished", "failed", "stopped", "interrupted"]);
const hash = (token) => createHash("sha256").update(token).digest("hex");
export function matches(token, expected) {
  if (!TOKEN.test(token) || !/^[a-f0-9]{64}$/.test(expected || "")) return false;
  return timingSafeEqual(Buffer.from(hash(token), "hex"), Buffer.from(expected, "hex"));
}
export function redact(value, token) {
  return String(value ?? "")
    .replaceAll(token, "[run authorization]")
    .slice(0, 4000);
}
function failure(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export async function readAuthorizedRun(token, studioOrigin = STUDIO_ORIGIN) {
  const client = new Client({ name: "merav-cart-runner", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${studioOrigin}/api/procurement-mcp`),
  );
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "get_procurement_run",
      arguments: { run_authorization: token },
    });
    if (result.isError || !result.structuredContent?.run)
      throw failure("Studio could not authorize this run. Prepare a fresh run in Studio.", 401);
    return result.structuredContent.run;
  } finally {
    await client.close().catch(() => {});
  }
}

export async function createCartRunner({
  port = PORT,
  studioOrigin = STUDIO_ORIGIN,
  stateDir = join(homedir(), ".merav-cart-runner"),
  extraOrigins = [],
  connectionFactory = (options) => new CodexConnection(options),
  readRun = (token) => readAuthorizedRun(token, studioOrigin),
  executable = process.env.MERAV_CODEX_BIN || "codex",
} = {}) {
  if (studioOrigin !== STUDIO_ORIGIN && !/^http:\/\/127\.0\.0\.1:\d+$/.test(studioOrigin))
    throw new Error("Invalid Studio origin.");
  if (extraOrigins.some((origin) => !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)))
    throw new Error("Preview origins must use localhost.");
  const allowedOrigins = new Set([studioOrigin, ...extraOrigins]);
  // Supply the complete bundled workflow to the model without requiring browser
  // access to local files or granting it shell/filesystem tools.
  const workflow = await readFile(
    new URL(
      "../../plugins/merav-cart-builder/skills/merav-cart-workflow/SKILL.md",
      import.meta.url,
    ),
    "utf8",
  );
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const ledgerPath = join(stateDir, "runs.json");
  const runs = new Map();
  try {
    const stored = JSON.parse(await readFile(ledgerPath, "utf8"));
    for (const run of stored)
      runs.set(run.id, {
        ...run,
        status: terminal.has(run.status) ? run.status : "interrupted",
        approvals: [],
        messages: terminal.has(run.status)
          ? run.messages
          : ["Runner restarted. Review Studio and the retailer cart before creating a new run."],
      });
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(
        "Runner history could not be read. Resolve it before starting; history prevents duplicate cart additions.",
      );
  }
  let persistence = Promise.resolve();
  const persist = () => {
    // Keep only hashes, outcomes, and run IDs. Raw credentials are memory-only.
    const data = JSON.stringify(
      [...runs.values()].map(({ id, tokenHash, status, messages, startedAt }) => ({
        id,
        tokenHash,
        status,
        messages,
        startedAt,
      })),
    );
    persistence = persistence.then(async () => {
      await writeFile(`${ledgerPath}.tmp`, data, { mode: 0o600 });
      await rename(`${ledgerPath}.tmp`, ledgerPath);
    });
    return persistence;
  };
  let connection;
  let connecting;
  let ready = false;
  let active;
  let starting = false;
  let driverError = "";
  const safeRun = (run) => ({
    id: run.id,
    status: run.status,
    messages: run.messages,
    approvals: run.approvals,
    startedAt: run.startedAt,
  });
  const addMessage = (run, message) => {
    run.messages = [...run.messages, redact(message, run.token)].slice(-20);
  };
  const settle = async (status, message) => {
    const run = active;
    if (!run) return;
    clearTimeout(run.deadline);
    run.status = status;
    if (message) addMessage(run, message);
    run.approvals = [];
    run.requests?.clear();
    active = undefined;
    delete run.token;
    await persist();
  };
  const ensureConnection = async () => {
    if (ready) return;
    if (connecting) return connecting;
    connecting = (async () => {
      connection = connectionFactory({ executable, cwd: stateDir, studioOrigin });
      connection.on("disconnected", () => {
        ready = false;
        driverError = "The local runner disconnected. Reconnect before starting another run.";
        void settle(
          "interrupted",
          "Runner disconnected. Review the retailer cart before retrying.",
        ).catch(() => {});
      });
      connection.on("notification", ({ method, params }) => {
        if (!active || params?.threadId !== active.threadId) return;
        if (method === "item/completed" && params.item?.type === "agentMessage")
          addMessage(active, params.item.text);
        if (method === "turn/completed")
          void settle(
            params.turn?.status === "completed" ? "finished" : "failed",
            params.turn?.error?.message,
          ).catch(() => {});
      });
      connection.on("request", (request) => {
        const run = active;
        if (!run || request.params?.threadId !== run.threadId) {
          connection.write({
            id: request.id,
            error: { code: -32601, message: "No matching authorized cart run." },
          });
          return;
        }
        const includedApproval = approvedRunRequest(request, run);
        if (includedApproval) {
          addMessage(run, includedApproval);
          connection.respond(request.id, { action: "accept", content: {} });
          return;
        }
        if (request.method === "item/tool/call" && request.params.tool === "pause_cart_run") {
          const question = request.params.arguments?.message;
          if (typeof question !== "string" || !question.trim() || question.length > 2000) {
            connection.respond(request.id, {
              success: false,
              contentItems: [
                {
                  type: "inputText",
                  text: "Provide a short message describing the browser blocker.",
                },
              ],
            });
            return;
          }
          run.requests.set(String(request.id), request);
          run.approvals.push({
            id: String(request.id),
            kind: "pause",
            message: redact(question, run.token),
          });
          run.status = "needs_attention";
        } else if (request.method === "item/tool/requestUserInput") {
          run.requests.set(String(request.id), request);
          run.approvals.push({
            id: String(request.id),
            kind: "questions",
            questions: request.params.questions.map((question) => ({
              ...question,
              question: redact(question.question, run.token),
            })),
          });
          run.status = "needs_attention";
        } else if (
          request.method === "mcpServer/elicitation/request" &&
          ["form", "openai/form", "openaiForm"].includes(request.params.mode)
        ) {
          const schema = request.params.requestedSchema;
          const properties = Object.values(schema?.properties || {});
          if (
            schema?.type === "object" &&
            properties.every((field) => ["string", "boolean"].includes(field.type))
          ) {
            run.requests.set(String(request.id), request);
            run.approvals.push({
              id: String(request.id),
              kind: "approval",
              message: redact(request.params.message, run.token),
              schema,
            });
            run.status = "needs_attention";
          } else {
            connection.respond(request.id, { action: "decline", content: null });
            addMessage(
              run,
              "This browser permission needs setup in Codex before it can run from Studio.",
            );
          }
        } else {
          // A cart run must never approve arbitrary commands, file edits, or broader permissions.
          const response =
            request.method === "item/permissions/requestApproval"
              ? { permissions: {}, scope: "turn" }
              : request.method === "mcpServer/elicitation/request"
                ? { action: "decline", content: null }
                : { decision: "decline" };
          connection.respond(request.id, response);
          addMessage(
            run,
            "An action outside this cart run was declined. Review any setup request in Codex.",
          );
        }
      });
      await connection.initialize();
      const catalog = await connection.request("mcpServerStatus/list", { limit: 100 });
      if (
        catalog.data?.some(
          (entry) =>
            ["codex_apps", "codex_app"].includes(entry.name) &&
            Object.keys(entry.tools || {}).length,
        )
      )
        throw new Error(
          "Unrelated app tools are still enabled. The cart runner will not start with this configuration.",
        );
      const hasTool = (server, tool) =>
        catalog.data?.some(
          (entry) => entry.name === server && entry.tools?.[tool] && !entry.toolsError,
        );
      if (!hasTool("cua_repl", "js") || !hasTool("merav-cart-builder", "get_procurement_run"))
        throw new Error("Enable the Merav Cart Builder and Chrome tools in Codex first.");
      ready = true;
      driverError = "";
    })()
      .catch((error) => {
        ready = false;
        driverError = error.message;
        connection?.close();
        throw error;
      })
      .finally(() => {
        connecting = undefined;
      });
    return connecting;
  };
  async function start(id, token, authorizeRetailerSites = false) {
    const existing = runs.get(id);
    if (existing) {
      if (!matches(token, existing.tokenHash))
        throw failure("This run belongs to a different authorization.", 403);
      return existing; // Including after a restart: no implicit retry, ever.
    }
    if (active || starting)
      throw failure("Another cart run is active. Finish or stop it before starting another.", 409);
    starting = true;
    try {
      await ensureConnection();
      const source = await readRun(token);
      if (
        source.run_id !== id ||
        source.status !== "prepared" ||
        !Array.isArray(source.ready_products) ||
        !source.ready_products.length ||
        source.ready_products.some((item) => item.current_status !== "prepared")
      )
        throw failure(
          "This run has already started or needs review. Prepare a fresh run in Studio.",
          409,
        );
      const remaining = Date.parse(source.expires_at) - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 61 * 60_000)
        throw failure("Run access has expired. Prepare a fresh run in Studio.", 401);
      const run = {
        id,
        tokenHash: hash(token),
        token,
        status: "starting",
        startedAt: new Date().toISOString(),
        messages: ["Starting the selected Studio cart run…"],
        approvals: [],
        requests: new Map(),
        authorizeRetailerSites,
        retailerOrigins: retailerOrigins(source),
        expiresAt: Date.parse(source.expires_at),
      };
      runs.set(id, run);
      await persist(); // Record consumption before any action can occur.
      active = run;
      try {
        const { thread } = await connection.request("thread/start", {
          cwd: stateDir,
          sandbox: "read-only",
          approvalPolicy: "on-request",
          ephemeral: true,
          dynamicTools: [
            {
              type: "function",
              name: "pause_cart_run",
              description:
                "Pause this cart run until Ken resolves a browser popup, login, or other blocker and clicks Continue in Studio. This tool waits for his response; do not finish the run while waiting.",
              inputSchema: {
                type: "object",
                properties: { message: { type: "string" } },
                required: ["message"],
                additionalProperties: false,
              },
            },
          ],
          developerInstructions:
            "You are a MERAV cart runner. Use only merav-cart-builder, cua_repl, and pause_cart_run tools for the authorized run. Never execute shell commands, edit files, send emails, use checkout, place an order, or change permissions. Build Carts includes browsing the selected retailer sites; the helper applies that consent only to matching site-access requests. Never repeat an ambiguous Add to Cart action. Recover read-only navigation failures by inspecting current tabs; they are not ambiguous additions. For an extension popup, login, or other blocker that needs Ken, call pause_cart_run and wait. Never say the run is paused in a final answer: the pause tool provides the actual Continue control. The helper has already loaded the complete Merav Cart Workflow skill below. This fulfills reading that skill; apply these supplied instructions directly and do not try to open or reread any local skill file through Chrome.\n\n" +
            workflow,
        });
        run.threadId = thread.id;
        if (active !== run || run.cancelRequested) return run;
        run.status = "running";
        const turn = await connection.request("turn/start", {
          threadId: thread.id,
          input: [
            {
              type: "text",
              text: cartPrompt(id, token, authorizeRetailerSites ? [...run.retailerOrigins] : []),
              text_elements: [],
            },
          ],
        });
        run.turnId = turn.turn.id;
        if (active !== run || run.cancelRequested) {
          await connection.request("turn/interrupt", {
            threadId: run.threadId,
            turnId: run.turnId,
          });
          return run;
        }
        if (active === run)
          run.deadline = setTimeout(
            () => {
              void connection
                .request("turn/interrupt", { threadId: run.threadId, turnId: run.turnId })
                .catch(() => {});
              void settle(
                "stopped",
                "Run access expired. Review the results in Studio before retrying.",
              ).catch(() => {});
            },
            Math.max(1, Date.parse(source.expires_at) - Date.now()),
          );
      } catch (error) {
        await settle("failed", error.message);
      }
      return run;
    } finally {
      starting = false;
    }
  }

  async function bodyOf(request) {
    let text = "";
    for await (const chunk of request) {
      text += chunk;
      if (text.length > 8192) throw failure("Request too large.", 413);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw failure("Invalid request.");
    }
  }
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const host = request.headers.host;
    const boundPort = server.address()?.port;
    if (
      !allowedOrigins.has(origin) ||
      host !== `127.0.0.1:${boundPort}` ||
      !["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Private-Network": "true",
    };
    const send = (status, value) => {
      response.writeHead(status, headers);
      response.end(JSON.stringify(value));
    };
    if (request.method === "OPTIONS") {
      send(204);
      return;
    }
    try {
      const path = new URL(request.url, `http://127.0.0.1:${boundPort}`).pathname;
      if (request.method === "GET" && path === "/health") {
        if (!ready && !connecting && !active) void ensureConnection().catch(() => {});
        send(200, {
          version: 1,
          ready,
          message: ready
            ? "Connected to the local cart runner"
            : driverError || "Connecting to Codex…",
        });
        return;
      }
      const token = (request.headers.authorization || "").replace(/^Bearer /, "");
      if (!TOKEN.test(token)) throw failure("A valid Studio run authorization is required.", 401);
      if (request.method === "POST" && path === "/runs") {
        const body = await bodyOf(request);
        if (
          !UUID.test(body.runId || "") ||
          Object.keys(body).some((key) => !["runId", "authorizeRetailerSites"].includes(key)) ||
          (body.authorizeRetailerSites !== undefined &&
            typeof body.authorizeRetailerSites !== "boolean")
        )
          throw failure("Only a prepared Studio run ID is accepted.");
        send(200, safeRun(await start(body.runId, token, body.authorizeRetailerSites === true)));
        return;
      }
      const match = path.match(/^\/runs\/([a-f0-9-]+)(?:\/(stop|answer))?$/i);
      const run = match && runs.get(match[1]);
      if (!run || !matches(token, run.tokenHash))
        throw failure("Run not found on this computer.", 404);
      if (request.method === "GET" && !match[2]) {
        send(200, safeRun(run));
        return;
      }
      if (request.method === "POST" && match[2] === "stop") {
        if (active === run) {
          run.cancelRequested = true;
          if (run.turnId)
            await connection.request("turn/interrupt", {
              threadId: run.threadId,
              turnId: run.turnId,
            });
          await settle(
            "stopped",
            "Stopped. Items already added remain in retailer carts. Review before retrying.",
          );
        }
        send(200, safeRun(run));
        return;
      }
      if (request.method === "POST" && match[2] === "answer") {
        const body = await bodyOf(request);
        const pending = run.requests?.get(body.requestId);
        if (!pending || active !== run)
          throw failure("This request is no longer waiting for an answer.", 409);
        let answer;
        if (pending.method === "item/tool/call" && pending.params.tool === "pause_cart_run") {
          if (body.action !== "continue")
            throw failure("Choose Continue when the browser blocker is resolved.");
          answer = {
            success: true,
            contentItems: [
              {
                type: "inputText",
                text: "Ken clicked Continue in Studio after resolving the browser blocker. Inspect the current browser state and retrieve the latest run status before proceeding. This does not authorize substitutions, checkout, bypassing a CAPTCHA, or repeating an uncertain cart addition.",
              },
            ],
          };
        } else if (pending.method === "item/tool/requestUserInput") {
          const answers = {};
          for (const question of pending.params.questions) {
            const value = body.answers?.[question.id];
            if (typeof value !== "string" || !value.trim() || value.length > 2000)
              throw failure("Answer each question before continuing.");
            answers[question.id] = { answers: [value] };
          }
          answer = { answers };
        } else {
          if (!["accept", "decline"].includes(body.action))
            throw failure("Choose approve or decline.");
          const schema = pending.params.requestedSchema;
          const content = {};
          if (body.action === "accept")
            for (const [key, field] of Object.entries(schema.properties || {})) {
              const value = body.content?.[key];
              if (value === undefined && !schema.required?.includes(key)) continue;
              if (typeof value !== field.type || (field.enum && !field.enum.includes(value)))
                throw failure("Complete the permission request fields.");
              content[key] = value;
            }
          answer = { action: body.action, content: body.action === "accept" ? content : null };
        }
        connection.respond(pending.id, answer);
        run.requests.delete(body.requestId);
        run.approvals = run.approvals.filter((approval) => approval.id !== body.requestId);
        run.status = run.approvals.length ? "needs_attention" : "running";
        send(200, safeRun(run));
        return;
      }
      throw failure("Not found.", 404);
    } catch (error) {
      send(error.status || 500, {
        error: "The runner could not complete this request.",
        detail: error.status
          ? error.message
          : "Check the local runner and reconnect. No automatic retry was started.",
      });
    }
  });
  const listen = async () => {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    void ensureConnection().catch(() => {});
    return server.address().port;
  };
  const close = async () => {
    await settle("interrupted", "Runner closed. Review the retailer cart before retrying.");
    connection?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  return { listen, close, server, ensureConnection };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runner = await createCartRunner({
    extraOrigins: (process.env.MERAV_CART_PREVIEW_ORIGINS || "").split(",").filter(Boolean),
  });
  await runner.listen();
  console.log(
    "MERAV Cart Runner is listening locally. Keep this window open while building carts in Studio.",
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void runner.close().finally(() => process.exit());
    });
}
