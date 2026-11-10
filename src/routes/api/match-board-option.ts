import { createFileRoute } from "@tanstack/react-router";
import { matchBoardOption } from "@/lib/boardOptionMatch.server";

export const Route = createFileRoute("/api/match-board-option")({ server: { handlers: {
  POST: async ({ request }) => {
    try { return await matchBoardOption(request); }
    catch { return Response.json({ error: "Could not compare these options. Please retry or check them manually." }, { status: 500 }); }
  },
} } });
