import { afterEach, expect, it, vi } from "vitest";
import { cancelSpecReview } from "../src/lib/specReviewAI.server";
afterEach(() => vi.unstubAllEnvs());
it("cancels only a validated background response ID using the documented server-only endpoint", async () => {
  vi.stubEnv("OPENAI_API_KEY", "local-test-key");
  const fetcher = vi.fn(async () => Response.json({ status: "cancelled" }));
  await cancelSpecReview("resp_fixture123", fetcher);
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.openai.com/v1/responses/resp_fixture123/cancel",
    expect.objectContaining({ method: "POST" }),
  );
  await expect(cancelSpecReview("../../other-project", fetcher)).rejects.toThrow(/Invalid/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("reports a failed provider cancellation honestly", async () => {
  vi.stubEnv("OPENAI_API_KEY", "local-test-key");
  await expect(
    cancelSpecReview("resp_fixture123", async () => new Response("unavailable", { status: 503 })),
  ).rejects.toThrow(/not confirmed/);
});
