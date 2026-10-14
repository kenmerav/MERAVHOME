export async function measuredRenderingWorkflow(projectId: string, roomId: string, jobId: string) {
  "use workflow";
  try {
    return await runMeasuredRenderingStep(projectId, roomId, jobId);
  } catch {
    await markMeasuredRenderingFailed(projectId, roomId, jobId);
    return "failed";
  }
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
