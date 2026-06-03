import { createFileRoute } from "@tanstack/react-router";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/image-data-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { imageUrl } = (await request.json()) as { imageUrl?: string };
          if (!imageUrl) return json({ error: "Missing image." }, 400);
          if (imageUrl.startsWith("data:image/")) return json({ image: imageUrl });
          if (!/^https?:\/\//i.test(imageUrl)) return json({ error: "Image must be an uploaded image or a public URL." }, 400);

          const res = await fetch(imageUrl);
          if (!res.ok) return json({ error: "Could not download image." }, 500);
          const contentType = res.headers.get("content-type") ?? "";
          if (!contentType.startsWith("image/")) return json({ error: "URL did not return an image." }, 400);

          const buffer = Buffer.from(await res.arrayBuffer());
          return json({ image: `data:${contentType};base64,${buffer.toString("base64")}` });
        } catch (error: any) {
          return json({ error: error?.message || "Could not prepare image." }, 500);
        }
      },
    },
  },
});
