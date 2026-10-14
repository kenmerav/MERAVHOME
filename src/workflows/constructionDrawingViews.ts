import { sleep } from "workflow";
export async function constructionDrawingViewsWorkflow(
  projectId: string,
  roomId: string,
  jobId: string,
) {
  "use workflow";
  try {
    let status = await beginDrawingViews(projectId, roomId, jobId);
    for (let attempt = 0; status === "processing" && attempt < 120; attempt++) {
      await sleep("15s");
      status = await collectDrawingViews(projectId, roomId, jobId);
    }
    if (status === "complete") return status;
  } catch {}
  await failDrawingViews(projectId, roomId, jobId);
  return "failed";
}
export async function beginDrawingViews(projectId: string, roomId: string, jobId: string) {
  "use step";
  const { startConstructionScan } = await import("../lib/constructionDrawingViews.server");
  return startConstructionScan(projectId, roomId, jobId);
}
beginDrawingViews.maxRetries = 0;
export async function collectDrawingViews(projectId: string, roomId: string, jobId: string) {
  "use step";
  const { collectConstructionScan } = await import("../lib/constructionDrawingViews.server");
  return collectConstructionScan(projectId, roomId, jobId);
}
export async function failDrawingViews(projectId: string, roomId: string, jobId: string) {
  "use step";
  const { failConstructionScan } = await import("../lib/constructionDrawingViews.server");
  return failConstructionScan(projectId, roomId, jobId);
}
