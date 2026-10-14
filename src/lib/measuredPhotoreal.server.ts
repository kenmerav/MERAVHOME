import type { MeasuredElevation, RenderReview } from "./measuredRendering";
import { measuredPhotorealPrompt } from "./measuredPhotoreal";

export type PhotorealInput = { name: string; mime: string; bytes: Uint8Array; role: string };
export function inlinePhotorealInput(data: string, name: string, role: string): PhotorealInput {
  const m =
    typeof data === "string" &&
    data.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!m || data.length > 20 * 1024 * 1024)
    throw new Error("Use an inline PNG, JPEG or WebP reference under 15 MB.");
  return { name, mime: m[1], bytes: Buffer.from(m[2], "base64"), role };
}
export async function generateMeasuredPhotoreal(
  elevation: MeasuredElevation,
  review: RenderReview,
  inputs: PhotorealInput[],
  fetcher: typeof fetch = fetch,
) {
  if (!process.env.OPENAI_API_KEY)
    throw new Error("Photorealistic rendering needs the server's OpenAI connection.");
  if (
    inputs.length < 2 ||
    inputs.length > 16 ||
    inputs.reduce((n, input) => n + input.bytes.byteLength, 0) > 45 * 1024 * 1024
  )
    throw new Error(
      "Supply the measured view and drawing, with at most sixteen reference images totaling 45 MB.",
    );
  const prompt = measuredPhotorealPrompt(
    elevation,
    review,
    inputs.map((input) => input.role),
  );
  const model = process.env.OPENAI_MEASURED_PHOTOREAL_MODEL || "gpt-image-2.5-sunburst";
  const form = new FormData();
  form.set("model", model);
  form.set("quality", model.startsWith("gpt-image-2.5") ? "max" : "high");
  form.set("size", "auto");
  form.set("output_format", "png");
  form.set("prompt", prompt);
  for (const input of inputs)
    form.append(
      "image[]",
      new Blob([new Uint8Array(input.bytes)], { type: input.mime }),
      input.name,
    );
  const response = await fetcher("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(240000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Photorealistic rendering failed.");
  const base64 = data.data?.[0]?.b64_json;
  if (!base64 || !/^[a-zA-Z0-9+/=]+$/.test(base64))
    throw new Error("No image was returned by the rendering service.");
  return {
    bytes: Buffer.from(base64, "base64"),
    prompt,
    model,
    revisedPrompt: data.data[0].revised_prompt || null,
    usage: data.usage || null,
  };
}
