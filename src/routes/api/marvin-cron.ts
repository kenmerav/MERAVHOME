import { createFileRoute } from "@tanstack/react-router";
import { json, runMorningBriefings } from "@/lib/marvin.server";

export const Route = createFileRoute("/api/marvin-cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
          return json({ error: "Unauthorized." }, 401);
        }
        try {
          return json(await runMorningBriefings(false));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Morning briefing failed.";
          console.error("Marvin morning briefing failed", message);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
