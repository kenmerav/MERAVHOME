import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchSpecReview, reviewCostCeiling, CreditsUnavailable, SpecReviewCostError } from "@/lib/specReviewAI.server";

const request = { instructions: "Review this exact selection", input: [{ role: "user", content: [
  { type: "input_text", text: "Mirror in Bathroom 2" },
  { type: "input_file", filename: "plans.pdf", file_data: "data:application/pdf;base64,FIXTURE", detail: "high" },
] }], text: { format: { type: "json_schema", name: "fixture", strict: true, schema: { type: "object" } } } };
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "TEST_ONLY_KEY");
  vi.stubEnv("OPENAI_MARVIN_MODEL", "other-model");
  vi.stubEnv("OPENAI_FINISH_CHECK_MODEL", "other-model");
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) => url.endsWith("/input_tokens") ?
    Response.json({ input_tokens: 50000 }) : Response.json({ status: "completed" }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("counts the same complete PDF/image/schema input, pins Sol high/default tier and reserves reasoning output", async () => {
  await fetchSpecReview(request, "completion");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses/input_tokens");
  const counted = JSON.parse(fetchMock.mock.calls[0][1].body);
  const generated = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(counted).toEqual({ ...request, model: "gpt-6.1-sol", reasoning: { effort: "high" } });
  expect(generated).toEqual({ ...counted, store: false, service_tier: "default", max_output_tokens: 32000 });
  expect(reviewCostCeiling(50000, "completion").ceilingUsd).toBeLessThan(1);
});
it("charges the whole request at long-context/cache-write rates past the boundary, including a regional reserve", () => {
  expect(reviewCostCeiling(268000, "completion").ceilingUsd).toBe(1.1);
  expect(reviewCostCeiling(268001, "completion").ceilingUsd).toBe(2.03);
  expect(reviewCostCeiling(700000, "completion")).toMatchObject({ aboveTarget: true, ceilingUsd: 4.4 });
});
it("stops an expensive PDF before generation rather than silently downgrading or shortening the review", async () => {
  fetchMock.mockResolvedValue(Response.json({ input_tokens: 850000 }));
  await expect(fetchSpecReview(request, "completion")).rejects.toThrow("exceeds $5");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([0, -1, undefined, "50000", 1.5, NaN, Infinity, 1000000])("fails closed for invalid or oversized count %s", async input_tokens => {
  fetchMock.mockResolvedValue(Response.json({ input_tokens }));
  await expect(fetchSpecReview(request, "dimensions")).rejects.toBeInstanceOf(SpecReviewCostError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not generate if token counting fails, and recognizes exhausted credits", async () => {
  fetchMock.mockRejectedValue(new Error("Network timeout"));
  await expect(fetchSpecReview(request, "color")).rejects.toBeInstanceOf(SpecReviewCostError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockReset(); fetchMock.mockResolvedValue(Response.json({ error: { code: "credit_balance_exhausted" } }, { status: 429 }));
  await expect(fetchSpecReview(request, "completion")).rejects.toBeInstanceOf(CreditsUnavailable);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("never retries a failed or timed-out generation", async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/input_tokens")) return Response.json({ input_tokens: 50000 });
    throw new Error("Connection lost after submission");
  });
  await expect(fetchSpecReview(request, "completion")).rejects.toThrow("Connection lost");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
