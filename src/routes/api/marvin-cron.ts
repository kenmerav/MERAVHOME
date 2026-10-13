import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/marvin.server";
import { eaRetiredResponse } from "@/lib/eaAvailability";

export const Route = createFileRoute("/api/marvin-cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
          return json({ error: "Unauthorized." }, 401);
        }
        return eaRetiredResponse();
      },
    },
  },
});
