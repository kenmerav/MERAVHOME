import { describe, it, expect, vi, afterEach } from "vitest";
import { measuredPhotorealPrompt } from "../src/lib/measuredPhotoreal";
import {
  generateMeasuredPhotoreal,
  inlinePhotorealInput,
} from "../src/lib/measuredPhotoreal.server";
import type { MeasuredElevation, RenderReview } from "../src/lib/measuredRendering";
const elevation: MeasuredElevation = {
  name: "Room",
  source: "ID2.8",
  width: 178,
  height: 121,
  depth: null,
  elements: [],
  questions: ["Depth missing"],
};
const review: RenderReview = { elements: [], changes: [], issues: ["Depth missing"], ready: false };
const inputs = [
  inlinePhotorealInput("data:image/png;base64,YQ==", "base.png", "Measured camera: dimensions"),
  inlinePhotorealInput("data:image/png;base64,Yg==", "drawing.png", "Construction drawing"),
];
afterEach(() => vi.unstubAllEnvs());
describe("Measured view to photorealistic presentation", () => {
  it("maps each image role and preserves the measured source and unresolved checks", () => {
    const prompt = measuredPhotorealPrompt(elevation, review, [
      "Measured view",
      "Drawing",
      "Quality only",
    ]);
    expect(prompt).toContain("Image 1: Measured view");
    expect(prompt).toContain("Image 3: Quality only");
    expect(prompt).toContain("178 × 121");
    expect(prompt).toContain("Depth missing");
    expect(prompt).toContain("does not certify measurements");
    expect(prompt).toContain("never add whole-room quantities");
  });
  it("uses original image bytes, high quality and one explicit editing model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.get("quality")).toBe("max");
      expect(form.get("model")).toBe("gpt-image-2.5-sunburst");
      expect(form.getAll("image[]")).toHaveLength(2);
      expect(await (form.getAll("image[]")[0] as Blob).text()).toBe("a");
      return Response.json({ data: [{ b64_json: "Yw==" }] });
    });
    const result = await generateMeasuredPhotoreal(
      elevation,
      review,
      inputs,
      fetcher as typeof fetch,
    );
    expect(result.bytes.toString()).toBe("c");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry exhausted credits or substitute a cheaper model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetcher = vi.fn(async () =>
      Response.json({ error: { message: "No credits remaining" } }, { status: 429 }),
    );
    await expect(
      generateMeasuredPhotoreal(elevation, review, inputs, fetcher as typeof fetch),
    ).rejects.toThrow("No credits remaining");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requires a measured view plus drawing before a paid call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetcher = vi.fn();
    await expect(
      generateMeasuredPhotoreal(elevation, review, [inputs[0]], fetcher),
    ).rejects.toThrow("measured view and drawing");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects remote URLs as reference bytes", () =>
    expect(() => inlinePhotorealInput("http://127.0.0.1/private", "ref.png", "style")).toThrow(
      "inline PNG",
    ));
});
