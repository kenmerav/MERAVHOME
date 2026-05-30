import { createFileRoute } from "@tanstack/react-router";

const RENDERING_PROMPT = `Use the uploaded SketchUp rendering as the exact architectural and design reference.

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

function extensionForContentType(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

function dataUrlToImageFile(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/);
  if (!match) {
    throw new ImageInputError("SketchUp source must be a PNG, JPG, or WebP image.");
  }

  const contentType = match[1];
  const bytes = Buffer.from(match[2], "base64");
  return new File([bytes], `sketchup.${extensionForContentType(contentType)}`, {
    type: contentType,
  });
}

async function urlToImageFile(url: string, origin: string): Promise<File> {
  if (url.startsWith("data:")) return dataUrlToImageFile(url);
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
  return new File([buf], `sketchup.${extensionForContentType(contentType)}`, { type: contentType });
}

export const Route = createFileRoute("/api/generate-rendering")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { sketchupUrl, extraContext } = (await request.json()) as {
            sketchupUrl: string;
            extraContext?: string;
          };
          if (!sketchupUrl) return new Response("sketchupUrl is required", { status: 400 });

          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) return new Response("OPENAI_API_KEY not configured", { status: 500 });

          const origin = new URL(request.url).origin;
          const image = await urlToImageFile(sketchupUrl, origin);
          const userText = extraContext
            ? `${RENDERING_PROMPT}\n\nAdditional design context:\n${extraContext}`
            : RENDERING_PROMPT;

          const form = new FormData();
          form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
          form.append("image", image);
          form.append("prompt", userText);
          form.append("size", "1536x1024");
          form.append("quality", "high");

          const imageRes = await fetch("https://api.openai.com/v1/images/edits", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            body: form,
          });

          if (!imageRes.ok) {
            const errText = await imageRes.text();
            return new Response(`OpenAI image error: ${errText}`, { status: imageRes.status });
          }

          const json = (await imageRes.json()) as { data?: Array<{ b64_json?: string }> };
          const b64 = json.data?.[0]?.b64_json;
          if (!b64) return new Response("No image returned by model", { status: 502 });

          return Response.json({ imageDataUrl: `data:image/png;base64,${b64}` });
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
