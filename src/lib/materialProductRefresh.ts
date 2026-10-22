import { cleanUuid } from "@/lib/ids";
import { createStudioSessionRequest, type StudioSessionRequest } from "@/lib/studioSessionRequest";

type ScrapedRow = {
  material_item_id: string;
  url: string;
  existing_product_id?: string | null;
  scraped: Record<string, unknown> & { error?: string };
  finish_check_token?: string;
};
type ScrapeBatch = {
  status: "started" | "processing" | "completed" | "failed";
  batch_id?: string;
  candidates?: Array<{ material_item_id: string; url: string; existing_product_id?: string | null }>;
  prefetched_rows?: ScrapedRow[];
  rows?: ScrapedRow[];
  completed_count?: number;
  total_count?: number;
  remaining_count?: number;
};
export type MaterialProductRefresh = { saved: number; failed: number; priceMissing: number; finishChecks?: string[] };

async function scrapeRequest<T>(method: "POST" | "PUT", body: unknown, request: StudioSessionRequest): Promise<T> {
  const response = await request("/api/scrape-materials", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let result: any;
  try { result = await response.json(); }
  catch { throw new Error("Product info refresh was interrupted. Run the check again to finish; saved product details are kept."); }
  if (!response.ok) throw new Error(result?.error || "Could not refresh product info. The completion review has not started.");
  return result;
}

// Use the same start/poll/save workflow as Materials. Save every batch before
// moving on; the completion check must never race ahead of the product writes.
export async function refreshMaterialProductInfo(projectId: string, materialItemIds: string[], options: {
  /** Existing callers may pass this; requests always use the current session. */
  authorization?: string;
  onProgress?: (message: string) => void;
  force?: boolean;
  verifySelectedFinishes?: boolean;
  request?: StudioSessionRequest;
}): Promise<MaterialProductRefresh> {
  const scope = [...new Set(materialItemIds.map(cleanUuid).filter((id): id is string => !!id))];
  if (!cleanUuid(projectId) || scope.length !== new Set(materialItemIds).size)
    throw new Error("Could not confirm the current project selections. Refresh the page and try again.");
  const summary: MaterialProductRefresh = { saved: 0, failed: 0, priceMissing: 0 };
  if (!scope.length) return summary;
  const request = options.request ?? await createStudioSessionRequest();
  const scopeIds = new Set(scope);
  const processed = new Set<string>();
  for (let batchNumber = 1; batchNumber <= 100; batchNumber++) {
    options.onProgress?.(`Refreshing product info · batch ${batchNumber}…`);
    const batch = await scrapeRequest<ScrapeBatch>("POST", {
      action: "start", project_id: projectId, material_item_ids: scope,
      exclude_material_item_ids: [...processed],
      ...(options.force ? { force: true } : {}),
      ...(options.verifySelectedFinishes ? { verify_selected_finishes: true } : {}),
    }, request);
    let completed = batch;
    if (batch.status === "started") {
      if (!batch.batch_id || !batch.candidates?.length) throw new Error("Product info refresh could not start. Please retry.");
      for (let poll = 1; poll <= 100; poll++) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        const fallback = poll === 100;
        const result = await scrapeRequest<ScrapeBatch>("POST", {
          action: fallback ? "fallback" : "poll", project_id: projectId,
          ...(!fallback ? { batch_id: batch.batch_id } : {}), candidates: batch.candidates,
          ...(options.verifySelectedFinishes ? { verify_selected_finishes: true } : {}),
        }, request);
        if (result.status === "processing" && !fallback) {
          options.onProgress?.(`Refreshing product info · batch ${batchNumber} (${result.completed_count ?? 0} of ${result.total_count ?? batch.candidates.length})…`);
          continue;
        }
        completed = { ...batch, ...result, rows: [...(batch.prefetched_rows ?? []), ...(result.rows ?? [])] };
        break;
      }
    }
    if (!["completed", "failed"].includes(completed.status) || !Array.isArray(completed.rows))
      throw new Error("Product info refresh did not finish. The completion review has not started; please retry.");
    const rows = completed.rows.filter(row => scopeIds.has(row.material_item_id) && !processed.has(row.material_item_id));
    const uniqueRows = [...new Map(rows.map(row => [row.material_item_id, row])).values()];
    uniqueRows.forEach(row => processed.add(row.material_item_id));
    if (options.verifySelectedFinishes) {
      const tokens = uniqueRows.map(row => row.finish_check_token).filter((token): token is string => typeof token === "string" && token.length <= 8000);
      if (tokens.length) summary.finishChecks = [...(summary.finishChecks ?? []), ...tokens];
    }
    const successful = uniqueRows.filter(row => row.scraped && !row.scraped.error);
    summary.failed += uniqueRows.length - successful.length;
    if (successful.length) {
      options.onProgress?.(`Saving product info · ${summary.saved + successful.length} products…`);
      const saved = await scrapeRequest<{ ok?: boolean; price_missing_count?: number }>("PUT", { project_id: projectId, rows: successful.map(row => ({
        ...row, existing_product_id: cleanUuid(row.existing_product_id),
      })) }, request);
      if (saved.ok !== true) throw new Error("Product info could not be saved. The completion review has not started; please retry.");
      summary.saved += successful.length;
      summary.priceMissing += saved.price_missing_count ?? 0;
    }
    if (completed.status === "failed" && !uniqueRows.length)
      throw new Error("Product info refresh failed. The completion review has not started; please retry.");
    if (!completed.remaining_count) return summary;
    if (!uniqueRows.length) throw new Error("Product info refresh stopped making progress. Run the check again to continue.");
  }
  throw new Error("Product info refresh reached its batch limit. Run the check again to continue; saved product details are kept.");
}
