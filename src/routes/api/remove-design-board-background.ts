import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dataUrlToBuffer } from "@/lib/roomImageStorage.server";

const DESIGN_BOARD_IMAGE_BUCKET = "design-board-images";
const DESIGN_BOARD_IMAGE_LIMIT = 20 * 1024 * 1024;

const BACKGROUND_REMOVAL_PROMPT = `Remove only the background from this product image.

Return the exact same product as a transparent PNG.
Do not regenerate, redraw, enhance, restyle, or alter the subject.
Preserve fabric texture, stitching, wood grain, shadows on the product, thin arms, legs, chains, lamp shades, rug edges, plumbing fixture details, and decor details.
Only the background should become transparent.`;

function extensionForContentType(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

function safeFileName(fileName?: string) {
  return (
    (fileName || "ai-cutout")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "ai-cutout"
  );
}

async function ensureDesignBoardImageBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(DESIGN_BOARD_IMAGE_BUCKET);
  if (data) {
    const { error } = await supabaseAdmin.storage.updateBucket(DESIGN_BOARD_IMAGE_BUCKET, {
      public: true,
      fileSizeLimit: DESIGN_BOARD_IMAGE_LIMIT,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    if (error) throw error;
    return;
  }

  const { error } = await supabaseAdmin.storage.createBucket(DESIGN_BOARD_IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: DESIGN_BOARD_IMAGE_LIMIT,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function imageUrlToFile(imageUrl: string, origin: string) {
  if (imageUrl.startsWith("data:image/")) {
    const { buffer, contentType } = dataUrlToBuffer(imageUrl);
    return new File([buffer], `source.${extensionForContentType(contentType)}`, { type: contentType });
  }

  const url = new URL(imageUrl, origin);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load source image (${response.status}).`);
  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return new File([buffer], `source.${extensionForContentType(contentType)}`, { type: contentType });
}

async function uploadCutout(projectId: string, fileName: string, buffer: Buffer) {
  await ensureDesignBoardImageBucket();
  const path = `${projectId}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(fileName)}.png`;
  const { error } = await supabaseAdmin.storage
    .from(DESIGN_BOARD_IMAGE_BUCKET)
    .upload(path, buffer, {
      contentType: "image/png",
      cacheControl: "31536000",
      upsert: false,
    });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(DESIGN_BOARD_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openAIImageEditWithRetry(form: FormData, apiKey: string) {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (response.ok) return response;

    lastResponse = response;
    if (![502, 503, 504].includes(response.status)) return response;
    await wait(750 * (attempt + 1));
  }

  return lastResponse;
}

async function openAIErrorMessage(response: Response | null) {
  if (!response) {
    return "AI background removal failed because OpenAI did not respond. Please try again.";
  }

  if ([502, 503, 504].includes(response.status)) {
    return "OpenAI is temporarily unavailable for AI background removal. Please try again in a minute, or use the fast remover.";
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      const message = body?.error?.message;
      if (message) return `AI background removal failed: ${message}`;
    } catch {
      // Fall through to a generic message so raw provider responses never hit the UI.
    }
  }

  return `AI background removal failed with OpenAI status ${response.status}. You can still use the fast remover.`;
}

export const Route = createFileRoute("/api/remove-design-board-background")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            return Response.json(
              { error: "OPENAI_API_KEY is not configured for AI background removal." },
              { status: 500 },
            );
          }

          const { imageUrl, projectId, fileName } = (await request.json()) as {
            imageUrl?: string;
            projectId?: string;
            fileName?: string;
          };

          if (!imageUrl || !projectId) {
            return Response.json({ error: "imageUrl and projectId are required." }, { status: 400 });
          }

          const origin = new URL(request.url).origin;
          const image = await imageUrlToFile(imageUrl, origin);
          const form = new FormData();
          form.append("model", process.env.OPENAI_BACKGROUND_REMOVAL_MODEL || "gpt-image-1");
          form.append("image", image);
          form.append("prompt", BACKGROUND_REMOVAL_PROMPT);
          form.append("background", "transparent");
          form.append("quality", "high");
          form.append("size", "auto");

          const imageRes = await openAIImageEditWithRetry(form, apiKey);

          if (!imageRes || !imageRes.ok) {
            return Response.json({ error: await openAIErrorMessage(imageRes) }, { status: 502 });
          }

          const json = (await imageRes.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
          let outputBuffer: Buffer | null = null;
          const b64 = json.data?.[0]?.b64_json;
          const outputUrl = json.data?.[0]?.url;

          if (b64) {
            outputBuffer = Buffer.from(b64, "base64");
          } else if (outputUrl) {
            const outputRes = await fetch(outputUrl);
            if (!outputRes.ok) throw new Error("Could not download AI background removal result.");
            outputBuffer = Buffer.from(await outputRes.arrayBuffer());
          }

          if (!outputBuffer) throw new Error("No image returned by OpenAI.");

          const url = await uploadCutout(projectId, fileName || "ai-cutout", outputBuffer);
          return Response.json({ url });
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI background removal failed.";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
