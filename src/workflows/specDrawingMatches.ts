import { sleep } from "workflow";
export async function specDrawingMatchesWorkflow(projectId: string, key: string) {
  "use workflow";
  try {
    const count = await prepareDrawingMatches(projectId, key);
    for (let offset = 0; offset < count; offset += 3) {
      const statuses = await Promise.all(
        Array.from({ length: Math.min(3, count - offset) }, async (_, within) => {
          try {
            const index = offset + within;
            let status = await beginDrawingMatchGroup(projectId, key, index);
            for (let poll = 0; status === "checking" && poll < 120; poll++) {
              await sleep("15s");
              status = await collectDrawingMatchGroup(projectId, key, index);
            }
            return status;
          } catch {
            return "failed";
          }
        }),
      );
      if (statuses.some((status) => status !== "complete")) {
        await stopDrawingMatches(projectId, key);
        return "partial";
      }
    }
    return "complete";
  } catch {
    await stopDrawingMatches(projectId, key);
    return "failed";
  }
}
export async function prepareDrawingMatches(projectId: string, key: string) {
  "use step";
  const { productionDrawingMatchStore } = await import("../lib/specDrawingMatchStore.server");
  const { prepareDrawingMatchScan } = await import("../lib/specDrawingMatchEngine.server");
  return prepareDrawingMatchScan(productionDrawingMatchStore(projectId), key);
}
export async function beginDrawingMatchGroup(projectId: string, key: string, index: number) {
  "use step";
  const { productionDrawingMatchStore } = await import("../lib/specDrawingMatchStore.server");
  const { startDrawingMatchChunk } = await import("../lib/specDrawingMatchEngine.server");
  return startDrawingMatchChunk(productionDrawingMatchStore(projectId), key, index);
}
beginDrawingMatchGroup.maxRetries = 0;
export async function collectDrawingMatchGroup(projectId: string, key: string, index: number) {
  "use step";
  const { productionDrawingMatchStore } = await import("../lib/specDrawingMatchStore.server");
  const { collectDrawingMatchChunk } = await import("../lib/specDrawingMatchEngine.server");
  return collectDrawingMatchChunk(productionDrawingMatchStore(projectId), key, index);
}
export async function stopDrawingMatches(projectId: string, key: string) {
  "use step";
  const { productionDrawingMatchStore } = await import("../lib/specDrawingMatchStore.server");
  const { failDrawingMatchJob } = await import("../lib/specDrawingMatchEngine.server");
  await failDrawingMatchJob(productionDrawingMatchStore(projectId), key);
}
