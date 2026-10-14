import { beforeEach, describe, it, expect, vi } from "vitest";
const mocked = vi.hoisted(() => ({ review: vi.fn() }));
vi.mock("../src/lib/specReviewAI.server", () => ({
  SPEC_REVIEW_MODEL: "gpt-6.1-sol",
  fetchSpecReview: mocked.review,
}));
import { interpretMeasuredElevation } from "../src/lib/measuredInterpret.server";
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-only");
  vi.stubEnv("OPENAI_MEASURED_RENDERING_MODEL", "");
  mocked.review.mockReset();
});
describe("Measured drawing reader request", () => {
  it("uses the guarded reader, original images and an explicit scene contract", async () => {
    mocked.review.mockResolvedValue(
      Response.json({ status: "in_progress", id: "resp_saved", model: "gpt-6.1-sol" }),
    );
    const result = await interpretMeasuredElevation(
      "data:image/png;base64,AAAA",
      [],
      "Test",
      fetch,
      [],
      true,
    );
    expect(result.responseId).toBe("resp_saved");
    const [request, kind, background] = mocked.review.mock.calls[0];
    expect(kind).toBe("completion");
    expect(background).toBe(true);
    expect(request.input[0].content[0].text).toContain("Allowed element kinds");
    expect(request.input[0].content[0].text).toContain("Only the room depth may be null");
    expect(request.input[0].content[0].text).toContain("Mark every island cabinet");
    expect(request.input[0].content[0].text).toContain("never cover it with a full wall");
    expect(request.input[0].content[0].text).toContain("mark position in inferredAxes");
    expect(request.input[0].content[1].detail).toBe("original");
  });
  it("still validates a completed response before returning geometry", async () => {
    const elevation = {
      name: "Test",
      source: "S1",
      width: 100,
      height: 100,
      depth: null,
      elements: [],
      questions: ["Depth missing"],
    };
    mocked.review.mockResolvedValue(
      Response.json({
        status: "completed",
        output: [{ content: [{ type: "output_text", text: JSON.stringify(elevation) }] }],
        model: "gpt-6.1-sol",
      }),
    );
    expect(
      (await interpretMeasuredElevation("data:image/png;base64,AAAA", [], "Test")).elevation,
    ).toEqual(elevation);
  });
});
