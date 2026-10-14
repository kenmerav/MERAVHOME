import { createFileRoute } from "@tanstack/react-router";
import { measuredApi } from "@/lib/measuredRendering.server";
export const Route = createFileRoute("/api/measured-rendering")({
  server: {
    handlers: {
      GET: ({ request }) => measuredApi(request),
      POST: ({ request }) => measuredApi(request),
    },
  },
});
