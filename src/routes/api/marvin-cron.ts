import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/marvin.server";
import { runMarvinCronStage } from "@/lib/marvinCron.server";

export const Route = createFileRoute("/api/marvin-cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
          return json({ error: "Unauthorized." }, 401);
        }
        try {
          return json(await runMarvinCronStage("inbox"));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Scheduled inbox sync failed.";
          console.error("Marvin scheduled inbox sync failed", message);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
