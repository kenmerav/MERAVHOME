import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/marvin.server";
import { isMarvinCronStage, runMarvinCronStage } from "@/lib/marvinCron.server";

export const Route = createFileRoute("/api/marvin-cron/$stage")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
          return json({ error: "Unauthorized." }, 401);
        }
        const stage = String(params.stage || "");
        if (!isMarvinCronStage(stage) || stage === "inbox") {
          return json({ error: "Unknown scheduled stage." }, 404);
        }
        try {
          return json(await runMarvinCronStage(stage));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Scheduled Marvin stage failed.";
          console.error(`Marvin scheduled ${stage} stage failed`, message);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
