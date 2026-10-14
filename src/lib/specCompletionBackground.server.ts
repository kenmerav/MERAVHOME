import { start } from "workflow/api";
import { saveSpecCompletionInBackground } from "@/workflows/specCompletionSave";
import { cleanUuid } from "@/lib/ids";

// Call only after staff/project authorization and saving the matching job.
export async function startCompletionSaveWorker(projectId: string, requestId: string) {
  if (!cleanUuid(projectId) || !cleanUuid(requestId)) throw new Error("Invalid completion job.");
  const run = await start(saveSpecCompletionInBackground, [projectId, requestId]);
  return run.runId;
}
