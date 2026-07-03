import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { uploadRoomImageFromDataUrl } from "@/lib/roomImageStorage.server";

const RENDERING_PROMPT = `Use the uploaded SketchUp rendering as the exact architectural and design reference.

CRITICAL SOURCE-OF-TRUTH RULE:
The uploaded SketchUp rendering is not inspiration. It is the measured architectural source of truth.
Before making the image photorealistic, mentally trace the uploaded image from left to right and preserve every visible architectural element in the same location.

Do not crop in tighter than the SketchUp view.
Do not zoom in unless explicitly requested.
Do not zoom out by inventing new architecture.
Do not remove, relocate, resize, simplify, or replace any cabinetry, island, wall opening, arch, doorway, window, fireplace, ceiling beam, appliance wall, niche, shelving, or built-in.
Do not add matching cabinets, balanced decor, chandeliers, or architectural symmetry unless those elements already exist in the SketchUp reference.
If a cabinet or architectural feature appears partially at the left or right edge, preserve it at that edge instead of replacing or omitting it.
If a requested revision says to zoom out, keep all existing architectural elements and reveal only plausible continuation of the same room without changing the layout.

The final image must preserve:

* exact room proportions
* exact cabinetry layout
* exact ceiling heights
* exact window and door placement
* exact furniture scale and spacing
* exact camera angle and perspective
* exact material placement
* exact architectural details

Do not redesign, reinterpret, or add random decor elements.
Do not change the floorplan or styling direction.

This should look like a professionally photographed completed luxury residential project by a top-tier interior design studio in a real home — not CGI and not AI-generated.

STYLE + QUALITY:

* ultra photorealistic
* luxury editorial interior photography
* natural lighting
* physically accurate materials
* realistic shadows and reflections
* true-to-life textures
* subtle imperfections for realism
* soft dynamic range
* architectural digest quality
* warm, elevated, timeless aesthetic
* refined styling
* high-end residential interior design
* premium finish quality
* realistic depth of field
* professional full-frame camera look
* shot on 35mm lens
* accurate white balance
* realistic exposure

MATERIAL ACCURACY:
All finishes must match the rendering exactly:

* cabinetry colors
* paint colors
* flooring tones
* countertop materials
* backsplash materials
* plumbing finishes
* lighting finishes
* wood species and stain tones
* upholstery colors
* stone veining
* hardware finishes

Do not oversaturate colors.
Do not stylize materials.
Keep tones sophisticated, warm, and believable.

LIGHTING:

* natural sunlight entering realistically through windows
* soft indirect bounce lighting
* practical lighting fixtures glowing naturally
* no blown highlights
* no overly dark shadows
* cinematic but realistic brightness

STYLING:

* minimal but intentional styling
* luxury lived-in feel
* tasteful accessories only
* high-end designer aesthetic
* clean surfaces
* realistic fabric folds
* realistic pillows and bedding
* believable organic textures

REALISM REQUIREMENTS:

* perfectly straight architectural lines
* no warped geometry
* no floating objects
* no distorted furniture
* no incorrect scale
* no fake AI artifacts
* no surreal styling
* no exaggerated lighting
* no plastic-looking textures

The image should convince a client this is a real completed project photograph.

OUTPUT:

* ultra high resolution
* photorealistic luxury interior photography
* client presentation quality
* magazine-quality realism
* true-to-scale architectural visualization`;

class ImageInputError extends Error {}

type RenderingFidelityMode = "standard" | "high_fidelity";

type ReferenceMetadata = {
  mode?: RenderingFidelityMode;
  references?: Array<{
    index: number;
    compressed: boolean;
    width?: number;
    height?: number;
    originalBytes?: number;
    preparedBytes?: number;
  }>;
};

type EnqueueRenderingPayload = {
  mode?: "enqueue" | "sync";
  roomId?: string;
  sketchupId?: string;
  sketchupCaption?: string | null;
  placeholderUrl?: string;
  sketchupUrl: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  extraContext?: string;
  renderingMode?: RenderingFidelityMode;
  referenceMetadata?: ReferenceMetadata;
  revisionParentId?: string | null;
  revisionNumber?: number;
  revisionNotes?: string | null;
};

const MAX_OPENAI_REFERENCE_BYTES = 50 * 1024 * 1024;

function extensionForContentType(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

function dataUrlToImageFile(dataUrl: string, fallbackName = "sketchup") {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/);
  if (!match) {
    throw new ImageInputError("SketchUp source must be a PNG, JPG, or WebP image.");
  }

  const contentType = match[1];
  const bytes = Buffer.from(match[2], "base64");
  assertReferenceSize(bytes.byteLength);
  return new File([bytes], `${fallbackName}.${extensionForContentType(contentType)}`, {
    type: contentType,
  });
}

function assertReferenceSize(size: number) {
  if (size > MAX_OPENAI_REFERENCE_BYTES) {
    throw new ImageInputError("Reference image is too large for AI rendering. Use a smaller image or Standard mode.");
  }
}

async function urlToImageFile(url: string, origin: string, fallbackName = "sketchup"): Promise<File> {
  if (url.startsWith("data:")) return dataUrlToImageFile(url, fallbackName);
  const absoluteUrl =
    url.startsWith("http://") || url.startsWith("https://") ? url : new URL(url, origin).toString();
  let res: Response;
  try {
    res = await fetch(absoluteUrl, { headers: { Accept: "image/*" } });
  } catch {
    throw new ImageInputError(
      "SketchUp image could not be reached. Please replace it with a working direct image URL or re-add the image.",
    );
  }
  if (!res.ok) {
    throw new ImageInputError(
      `SketchUp image could not be reached (${res.status}). Please replace it with a working direct image URL or re-add the image.`,
    );
  }
  const contentType = res.headers.get("content-type") || "image/png";
  if (!contentType.startsWith("image/")) {
    throw new ImageInputError("SketchUp source must be a direct image file URL.");
  }
  if (!/^image\/(?:png|jpe?g|webp)/.test(contentType)) {
    throw new ImageInputError("SketchUp source must be a PNG, JPG, or WebP image.");
  }
  const buf = await res.arrayBuffer();
  assertReferenceSize(buf.byteLength);
  return new File([buf], `${fallbackName}.${extensionForContentType(contentType)}`, { type: contentType });
}

async function generateRenderingImage({
  origin,
  sketchupUrl,
  referenceImageUrl,
  referenceImageUrls,
  extraContext,
  renderingMode = "standard",
  referenceMetadata,
}: {
  origin: string;
  sketchupUrl: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  extraContext?: string;
  renderingMode?: RenderingFidelityMode;
  referenceMetadata?: ReferenceMetadata;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const size = process.env.OPENAI_RENDERING_IMAGE_SIZE || "auto";
  const quality = "high";

  const image = await urlToImageFile(sketchupUrl, origin, "sketchup-reference");
  const referenceImage = referenceImageUrl
    ? await urlToImageFile(referenceImageUrl, origin, "previous-rendering")
    : null;
  const additionalReferenceImages = await Promise.all(
    (referenceImageUrls ?? []).slice(0, 3).map((url, index) =>
      urlToImageFile(url, origin, `revision-reference-${index + 1}`),
    ),
  );
  const userText = extraContext
    ? `${RENDERING_PROMPT}\n\nIf additional images are included, use them only as references for the requested revision details such as tile, wallpaper, fabric, color, finish, or styling direction. The first uploaded SketchUp image remains the exact architectural source of truth.\n\nAdditional design context:\n${extraContext}`
    : RENDERING_PROMPT;

  const form = new FormData();
  form.append("model", model);
  const imageInputs = [image, referenceImage, ...additionalReferenceImages].filter(Boolean) as File[];
  const imageField = imageInputs.length > 1 ? "image[]" : "image";
  for (const img of imageInputs) form.append(imageField, img);
  form.append("prompt", userText);
  form.append("size", size);
  form.append("quality", quality);
  console.info("[rendering] OpenAI image edit request", {
    model,
    quality,
    size,
    renderingMode,
    imageCount: imageInputs.length,
    referenceMetadata,
  });

  const imageRes = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!imageRes.ok) {
    const errText = await imageRes.text();
    throw new Error(`OpenAI image error: ${errText}`);
  }

  const json = (await imageRes.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned by model");
  return `data:image/png;base64,${b64}`;
}

async function processQueuedRendering(payload: Required<Pick<EnqueueRenderingPayload, "roomId" | "sketchupId" | "sketchupUrl">> & EnqueueRenderingPayload & { placeholderId: string; origin: string }) {
  const { placeholderId, origin, roomId, sketchupCaption, sketchupUrl, referenceImageUrl, referenceImageUrls, extraContext, renderingMode, referenceMetadata } = payload;
  const startedAt = Date.now();
  try {
    console.info(`[rendering:${placeholderId}] started`);
    const { data: currentPlaceholder } = await supabaseAdmin
      .from("room_images")
      .select("id, status")
      .eq("id", placeholderId)
      .maybeSingle();

    if (!currentPlaceholder || (currentPlaceholder.status !== "queued" && currentPlaceholder.status !== "processing")) {
      return;
    }

    await supabaseAdmin
      .from("room_images")
      .update({ status: "processing", error_message: null })
      .eq("id", placeholderId);

    const imageDataUrl = await generateRenderingImage({
      origin,
      sketchupUrl,
      referenceImageUrl,
      referenceImageUrls,
      extraContext,
      renderingMode,
      referenceMetadata,
    });

    const uploaded = await uploadRoomImageFromDataUrl({
      dataUrl: imageDataUrl,
      roomId,
      kind: "rendering",
      preferredName: sketchupCaption || "rendering",
    });

    const { data: latestPlaceholder } = await supabaseAdmin
      .from("room_images")
      .select("id, status")
      .eq("id", placeholderId)
      .maybeSingle();

    if (!latestPlaceholder || latestPlaceholder.status !== "processing") {
      return;
    }

    await supabaseAdmin
      .from("room_images")
      .update({
        url: uploaded.publicUrl,
        status: "complete",
        is_approved: false,
        review_status: "draft",
        error_message: null,
      })
      .eq("id", placeholderId);
    console.info(`[rendering:${placeholderId}] completed in ${Date.now() - startedAt}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    console.error(`[rendering:${placeholderId}] failed after ${Date.now() - startedAt}ms`, error);
    const { data: latestPlaceholder } = await supabaseAdmin
      .from("room_images")
      .select("id")
      .eq("id", placeholderId)
      .maybeSingle();

    if (!latestPlaceholder) {
      return;
    }

    await supabaseAdmin
      .from("room_images")
      .update({ status: "failed", error_message: message })
      .eq("id", placeholderId);
  }
}

export const Route = createFileRoute("/api/generate-rendering")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const {
            mode = "sync",
            roomId,
            sketchupId,
            sketchupCaption,
            placeholderUrl,
            sketchupUrl,
            referenceImageUrl,
            referenceImageUrls,
            extraContext,
            renderingMode,
            referenceMetadata,
            revisionParentId,
            revisionNumber,
            revisionNotes,
          } = (await request.json()) as EnqueueRenderingPayload;
          if (!sketchupUrl) return new Response("sketchupUrl is required", { status: 400 });

          const origin = new URL(request.url).origin;
          if (mode === "enqueue") {
            if (!roomId || !sketchupId) {
              return Response.json({ error: "roomId and sketchupId are required for queued rendering." }, { status: 400 });
            }

            const { data: placeholder, error } = await supabaseAdmin
              .from("room_images")
              .insert({
                room_id: roomId,
                kind: "rendering",
                url: placeholderUrl || sketchupUrl,
                caption: revisionParentId
                  ? `Revision ${revisionNumber || 2} from ${sketchupCaption || "SketchUp"}`
                  : `Rendering from ${sketchupCaption || "SketchUp"}`,
                linked_sketchup_id: sketchupId,
                status: "queued",
                is_approved: false,
                review_status: "draft",
                revision_parent_id: revisionParentId ?? null,
                revision_number: revisionNumber || 1,
                revision_notes: revisionNotes || null,
                error_message: null,
              })
              .select()
              .single();

            if (error || !placeholder) {
              return Response.json({ error: error?.message || "Could not create rendering job." }, { status: 500 });
            }

            waitUntil(
              processQueuedRendering({
                placeholderId: placeholder.id,
                origin,
                roomId,
                sketchupId,
                sketchupCaption,
                sketchupUrl,
                referenceImageUrl,
                referenceImageUrls,
                extraContext,
                renderingMode,
                referenceMetadata,
              }),
            );

            return Response.json({ queued: true, placeholder });
          }

          const imageDataUrl = await generateRenderingImage({
            origin,
            sketchupUrl,
            referenceImageUrl,
            referenceImageUrls,
            extraContext,
            renderingMode,
            referenceMetadata,
          });

          return Response.json({ imageDataUrl });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json(
            { error: msg },
            { status: e instanceof ImageInputError ? 400 : 500 },
          );
        }
      },
    },
  },
});
