import { createFileRoute } from "@tanstack/react-router";
import { designAccuracyApi } from "@/lib/designAccuracy.server";
export const Route = createFileRoute("/api/design-accuracy")({
  server: {
    handlers: {
      GET: ({ request }) => designAccuracyApi(request),
      POST: ({ request }) => designAccuracyApi(request),
    },
  },
});
