import { expect, it } from "vitest";
import { BatchApprovalError, batchApprovalResponse, batchResultsComplete } from "@/lib/batchApprovalResponse";

const valid = (value: unknown): value is { results: { itemId: string; status: string }[] } =>
  batchResultsComplete(value, ["one", "two"], "itemId", ["applied", "check", "skipped"]);

it("warns and requires checking when transport fails or a server times out", async () => {
  for (const request of [
    async () => { throw new TypeError("network disconnected"); },
    async () => new Response("Gateway timeout", { status: 504 }),
    async () => Response.json({ error: "internal error" }, { status: 500 }),
  ]) {
    const error = await batchApprovalResponse(request, valid).catch(reason => reason);
    expect(error).toBeInstanceOf(BatchApprovalError);
    expect(error.unknownOutcome).toBe(true);
    expect(error.message).toMatch(/some changes may have saved/i);
    expect(error.message).toMatch(/refresh and check/i);
  }
});

it("preserves an explicit 4xx rejection and does not mark it as a write uncertainty", async () => {
  const error = await batchApprovalResponse(async () => Response.json({ error: "The selection changed." }, { status: 409 }), valid).catch(reason => reason);
  expect(error).toBeInstanceOf(BatchApprovalError);
  expect(error.unknownOutcome).toBe(false);
  expect(error.message).toBe("The selection changed.");
});

it("treats missing, duplicate, or unknown result entries as uncertain even on HTTP success", async () => {
  for (const results of [
    [{ itemId: "one", status: "applied" }],
    [{ itemId: "one", status: "applied" }, { itemId: "one", status: "applied" }],
    [{ itemId: "one", status: "applied" }, { itemId: "two", status: "unknown" }],
  ]) {
    const error = await batchApprovalResponse(async () => Response.json({ results }), valid).catch(reason => reason);
    expect(error.unknownOutcome).toBe(true);
  }
});

it("returns complete, explicit per-item results including partial outcomes", async () => {
  const results = [{ itemId: "one", status: "applied" }, { itemId: "two", status: "check" }];
  expect(await batchApprovalResponse(async () => Response.json({ results }), valid)).toEqual({ results });
  expect(batchResultsComplete({ results: [{ issue_key: "a", status: "saved" }, { issue_key: "b", status: "not_attempted" }] }, ["a", "b"], "issue_key", ["saved", "not_attempted"])).toBe(true);
});
