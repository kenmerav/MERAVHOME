import { createFileRoute } from "@tanstack/react-router";

const RENDERING_PROMPT = `Use the uploaded SketchUp rendering as the exact architectural and design reference.

The final image must preserve: exact room proportions, exact cabinetry layout, exact ceiling heights, exact window placement, exact door placement, exact furniture scale and spacing, exact camera angle, exact camera height, exact perspective, exact material placement, exact architectural details, exact millwork details, exact trim details, exact appliance locations, and exact lighting locations.

Do not redesign. Do not reinterpret. Do not change the floorplan. Do not move walls. Do not modify architecture. Do not change cabinetry design. Do not introduce new architectural features. Do not replace specified products. Do not add random decor.

The purpose is not to create a new design. The purpose is to transform the SketchUp image into a believable completed luxury residential photograph. The final image should look like a professionally photographed completed project by a top-tier residential interior design firm. It should not look like CGI. It should not look AI-generated. It should look like a real completed home.

STYLE + QUALITY: ultra photorealistic luxury interior photography, Architectural Digest quality, luxury residential editorial photography, natural daylight, physically accurate materials, realistic shadows and reflections, realistic ambient lighting, subtle imperfections, believable lived-in realism, premium finish quality, warm elevated aesthetic, refined styling, timeless design, realistic depth of field, professional full-frame camera look, shot on a 35mm architectural photography lens, accurate white balance, accurate exposure, soft dynamic range, magazine-quality realism.

MATERIAL ACCURACY: All finishes must match the actual project selections — cabinet color, cabinet finish, wood species, stain tone, paint color, countertop material, countertop edge profile, backsplash material, backsplash pattern, flooring material, flooring stain, plumbing finish, lighting finish, appliance finish, hardware finish, stone veining, upholstery colors, fabric textures. Do not oversaturate colors. Do not stylize materials. Keep materials sophisticated, warm, and believable. Avoid exaggerated contrast and unrealistic luxury staging.

PRODUCT ACCURACY: When products are provided, use them as the design reference — match fixture shape, fixture scale, fixture finish, hardware profile and finish, plumbing silhouette and finish, and appliance appearance. When product images are referenced, treat them as visual reference. Do not substitute or invent alternative products. Use the actual selected products wherever visible.

LIGHTING: natural sunlight entering through the actual windows with realistic direction, soft indirect bounce lighting, practical fixtures glowing naturally, subtle ambient shadows, realistic brightness and interior exposure. Avoid blown highlights, muddy shadows, HDR effects, dramatic artificial lighting, or cinematic exaggeration. The image should feel naturally photographed.

STYLING: minimal intentional styling, luxury lived-in realism, clean surfaces, tasteful restrained accessories, believable organic materials, realistic fabric folds, cushions, bedding, books and accessories. Styling supports the design and never overpowers the architecture.

REALISM REQUIREMENTS: perfectly straight architectural and cabinetry lines, accurate geometry, accurate scale, realistic proportions. Avoid warped walls or cabinetry, distorted windows or furniture, floating objects, AI artifacts, incorrect scale, surreal styling, exaggerated luxury, plastic-looking materials, fake reflections, or fake shadows. Every object should appear physically believable.

OUTPUT: ultra high resolution, client presentation quality, photorealistic luxury interior photography, magazine-quality realism, true-to-scale architectural visualization, presentation board quality. The final image should convince a homeowner that this is a real completed project photograph.`;

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
          form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
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
