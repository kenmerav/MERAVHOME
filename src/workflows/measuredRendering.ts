import { sleep } from "workflow";
export async function measuredRenderingWorkflow(projectId: string, roomId: string, jobId: string) {
  "use workflow";
  try {
    let status = await runMeasuredRenderingStep(projectId, roomId, jobId);
    for (let attempt = 0; status === "processing" && attempt < 120; attempt++) {
      await sleep("15s");
      status = await collectMeasuredDrawing(projectId, roomId, jobId);
    }
    if (status !== "processing") return status;
  } catch {}
  await markMeasuredRenderingFailed(projectId, roomId, jobId);
  return "failed";
}
export async function collectMeasuredDrawing(projectId: string, roomId: string, jobId: string) {
  "use step";
  const { collectCloudInterpretation } = await import("../lib/measuredCloud.server");
  return collectCloudInterpretation(projectId, roomId, jobId);
}
export async function runMeasuredRenderingStep(projectId: string, roomId: string, jobId: string) {
  "use step";
  const { processCloudJob } = await import("../lib/measuredCloud.server");
  return processCloudJob(projectId, roomId, jobId);
}
runMeasuredRenderingStep.maxRetries = 0;
export async function markMeasuredRenderingFailed(
  projectId: string,
  roomId: string,
  jobId: string,
) {
  "use step";
  const { failCloudJob } = await import("../lib/measuredCloud.server");
  await failCloudJob(
    projectId,
    roomId,
    jobId,
    "The rendering worker stopped. Reopen this job before starting another attempt.",
  );
}
