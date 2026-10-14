import { sleep } from "workflow";

// Only project/job IDs and small status values enter workflow persistence.
// PDFs, selection details and AI output stay in the existing services/table.
export async function saveSpecCompletionInBackground(projectId: string, requestId: string) {
  "use workflow";
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      const status = await collectCompletionResult(projectId, requestId);
      if (status !== "checking") return status;
      await sleep("15s");
    }
  } catch {
    // Step retries only collect the existing result; they never generate AI.
  }
  await recordCompletionSaveFailure(projectId, requestId);
  return "unavailable";
}

export async function collectCompletionResult(projectId: string, requestId: string) {
  "use step";
  const { pollCompletionSave } = await import("../lib/savedSpecCompletion.server");
  return pollCompletionSave(projectId, requestId);
}

export async function recordCompletionSaveFailure(projectId: string, requestId: string) {
  "use step";
  const { failCompletionSave } = await import("../lib/savedSpecCompletion.server");
  await failCompletionSave(projectId, requestId);
}
