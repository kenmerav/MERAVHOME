import { describe, it, expect, vi, afterEach } from "vitest";
import {
  measuredPhotorealPrompt,
  compactMeasuredRenderBrief,
  MEASURED_IMAGE_PROMPT_LIMIT,
} from "../src/lib/measuredPhotoreal";
import {
  generateMeasuredPhotoreal,
  inlinePhotorealInput,
} from "../src/lib/measuredPhotoreal.server";
import {
  measuredRenderBrief,
  type MeasuredElevation,
  type RenderReview,
} from "../src/lib/measuredRendering";
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
  it("fits a dense tile elevation without dropping positions, finishes, product identity, or unresolved checks", () => {
    const elements = Array.from({ length: 250 }, (_, i) => ({
      id: `tile-${i}`,
      name: `Lower wall band Ivoire strip ${String(i + 1).padStart(2, "0")}`,
      kind: "tile" as const,
      x: 3 + (i % 25) * 6,
      y: Math.floor(i / 25) * 6,
      z: 0.375,
      width: 6,
      height: 2,
      depth: 0.375,
      specId: "tile-product",
      color: "#faf5ed",
      front: "solid" as const,
      dimensionEvidence: "Written stripe course",
      inferredAxes: ["depth" as const],
      dimensionStatus: "Drawing / review",
      appearanceStatus: "Product photo available",
      selection: {
        id: "tile-product",
        name: "Selected Ivoire handmade ceramic strip tile",
        finish: "Ivoire glaze",
        sku: "IVOIRE-2X6",
      } as any,
    }));
    const dense = {
      ...review,
      elements,
      issues: elements.flatMap((e) => [
        `${e.name}: confirm depth against the construction documents.`,
        `${e.name}: procedural detail and material scale need designer verification.`,
      ]),
    };
    expect(measuredRenderBrief(elevation, dense).length).toBeGreaterThan(
      MEASURED_IMAGE_PROMPT_LIMIT,
    );
    const prompt = measuredPhotorealPrompt(elevation, dense, [
      "Measured camera",
      "Drawing",
      "Exact Ivoire tile photo",
    ]);
    expect(prompt.length).toBeLessThanOrEqual(MEASURED_IMAGE_PROMPT_LIMIT);
    expect(prompt).toContain("Ivoire glaze");
    expect(prompt).toContain("IVOIRE-2X6");
    expect(prompt).toContain("[250 repeated instances]");
    expect(prompt).toContain("no labels, annotations or watermark");
    const compact = compactMeasuredRenderBrief(elevation, dense);
    const geometry = JSON.parse(
      compact.split("\n").find((line) => line.startsWith('{"products"'))!,
    );
    expect(geometry.groups).toHaveLength(1);
    expect(geometry.groups[0].positions_in).toEqual(elements.map((e) => [e.x, e.y, e.z]));
    expect(geometry.groups[0].size_in).toEqual([6, 2, 0.375]);
  });
  it("rejects irreducibly long unique source notes before any image API call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    const fetcher = vi.fn();
    const tooLarge = {
      ...review,
      issues: Array.from(
        { length: 100 },
        (_, i) => `Unique source requirement ${i}: ${"x".repeat(1900)}`,
      ),
    };
    await expect(generateMeasuredPhotoreal(elevation, tooLarge, inputs, fetcher)).rejects.toThrow(
      "no image request was sent",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
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
      expect(String(form.get("prompt")).length).toBeLessThanOrEqual(MEASURED_IMAGE_PROMPT_LIMIT);
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
