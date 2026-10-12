import { createFileRoute } from "@tanstack/react-router";
import { checkSpecCompletion } from "@/lib/specCompletion.server";
import { CompletionStorageUnavailable } from "@/lib/savedSpecCompletion.server";

export const Route = createFileRoute("/api/check-spec-completion")({
  server: { handlers: { POST: async ({ request }) => {
    try { return await checkSpecCompletion(request); }
    catch (error) { return Response.json({ error: error instanceof CompletionStorageUnavailable ? error.message :
      "Could not finish and save the review. Please retry or reopen the saved review." }, {
      status: error instanceof CompletionStorageUnavailable ? 503 : 500, headers: { "Cache-Control": "no-store" },
    }); }
  } } },
});
