// Verified against GPT-6.1 Sol model/pricing docs on 2026-10-12.
// Keep the model, tier and rate card together: account-wide model overrides
// must not invalidate this review's cost guard.
export const SPEC_REVIEW_MODEL = "gpt-6.1-sol";
export const SPEC_REVIEW_TARGET_USD = 3;
export const SPEC_REVIEW_MAX_USD = 5;
export class CreditsUnavailable extends Error {}
export class SpecReviewCostError extends Error {}

type ReviewRequest = { instructions: string; input: unknown[]; text?: unknown };
type ReviewKind = "completion" | "dimensions" | "color";
const outputLimits: Record<ReviewKind, number> = { completion: 32000, dimensions: 12000, color: 8000 };
// Full construction-document reviews at high reasoning can exceed two minutes.
const reviewTimeouts: Record<ReviewKind, number> = { completion: 300000, dimensions: 240000, color: 120000 };

export function reviewCostCeiling(inputTokens: number, kind: ReviewKind, outputLimit = outputLimits[kind]) {
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1000 || outputLimit > 32000)
    throw new SpecReviewCostError("Invalid AI response budget.");
  if (!Number.isSafeInteger(inputTokens) || inputTokens <= 0)
    throw new SpecReviewCostError("The AI review was stopped because its cost could not be confirmed. Try again later.");
  // Reserve extra input for schema/processing differences and a changed remote
  // image. PDFs are immutable inline bytes; images use a bounded high detail.
  const reservedInput = inputTokens + 4000;
  if (reservedInput > 922000)
    throw new SpecReviewCostError("The AI review was stopped because this document exceeds the review size limit. Use a smaller construction document.");
  const longContext = reservedInput > 272000;
  // Assume every input token pays the highest input rate (cache writes),
  // apply long-context rates, and reserve 10% for regional price differences.
  // max_output_tokens includes both reasoning and visible output tokens.
  // Integer arithmetic through the final cents rounding avoids floating-point
  // errors at the spending boundary (all rates are in tenths of dollars/M).
  const costNumerator = (reservedInput * (longContext ? 50 : 25) + outputLimit * (longContext ? 150 : 100)) * 11;
  const ceilingUsd = Math.ceil(costNumerator / 1000000) / 100;
  if (ceilingUsd > SPEC_REVIEW_MAX_USD)
    throw new SpecReviewCostError("The AI review was stopped before generation because its estimated cost exceeds $5. Use a smaller construction document. Missing-detail checks still work.");
  return { ceilingUsd, aboveTarget: ceilingUsd > SPEC_REVIEW_TARGET_USD, maxOutputTokens: outputLimit };
}

export async function fetchSpecReview(request: ReviewRequest, kind: ReviewKind, background = false, fetcher:typeof fetch = fetch): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) throw new Error("AI configuration unavailable");
  const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" };
  const countedRequest = { ...request, model: SPEC_REVIEW_MODEL, reasoning: { effort: "high" } };
  let countResponse: Response;
  try {
    countResponse = await fetcher("https://api.openai.com/v1/responses/input_tokens", {
      method: "POST", signal: AbortSignal.timeout(45000), headers, body: JSON.stringify(countedRequest),
    });
  } catch {
    throw new SpecReviewCostError("The AI review was stopped because its cost could not be confirmed. Try again later.");
  }
  const count = await countResponse.json().catch(() => null);
  if (!countResponse.ok) {
    if (["credit_balance_exhausted", "insufficient_quota"].includes(count?.error?.code)) throw new CreditsUnavailable();
    throw new SpecReviewCostError("The AI review was stopped because its cost could not be confirmed. Try again later.");
  }
  const budget = reviewCostCeiling(count?.input_tokens, kind);
  // One generation per button press, no automatic retries or hosted tools.
  // This guards estimated model-token cost, not an account-wide billing limit.
  return fetcher("https://api.openai.com/v1/responses", {
    method: "POST", signal: AbortSignal.timeout(background ? 60000 : reviewTimeouts[kind]), headers,
    body: JSON.stringify({ ...countedRequest, service_tier: "default", store: false,
      max_output_tokens: budget.maxOutputTokens, ...(background ? { background: true } : {}) }),
  });
}

export async function retrieveSpecReview(responseId: string) {
  if (!/^resp_[a-zA-Z0-9_-]{1,200}$/.test(responseId) || !process.env.OPENAI_API_KEY) throw new Error("Invalid saved plan job");
  return fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15000),
  });
}
