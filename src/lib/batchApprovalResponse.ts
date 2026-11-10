export class BatchApprovalError extends Error {
  constructor(message: string, readonly unknownOutcome: boolean) { super(message); }
}

const UNCERTAIN = "The approval was interrupted and some changes may have saved. Refresh and check the Spec Book before retrying.";

// A lost response or server-side failure can occur after some writes. Only a
// readable 4xx rejection is certain enough to show the server message alone.
export async function batchApprovalResponse<T>(request: () => Promise<Response>, isResult: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try { response = await request(); }
  catch { throw new BatchApprovalError(UNCERTAIN, true); }
  let result: unknown;
  try { result = await response.json(); }
  catch {
    if (response.status >= 400 && response.status < 500) throw new BatchApprovalError("The approval was rejected. Refresh the review and try again.", false);
    throw new BatchApprovalError(UNCERTAIN, true);
  }
  if (response.status >= 400 && response.status < 500) {
    const error = result && typeof result === "object" && "error" in result ? (result as { error: unknown }).error : undefined;
    throw new BatchApprovalError(typeof error === "string" && error ? error : "The approval was rejected. Refresh the review and try again.", false);
  }
  if (!response.ok || !isResult(result)) throw new BatchApprovalError(UNCERTAIN, true);
  return result;
}

export function batchResultsComplete(value: unknown, ids: string[], key: "issue_key" | "itemId", statuses: readonly string[]): boolean {
  if (!value || typeof value !== "object" || !("results" in value) || !Array.isArray((value as { results: unknown }).results)) return false;
  const results = (value as { results: unknown[] }).results;
  if (results.length !== ids.length || new Set(ids).size !== ids.length) return false;
  const remaining = new Set(ids);
  for (const row of results) {
    if (!row || typeof row !== "object") return false;
    const record = row as Record<string, unknown>;
    if (typeof record[key] !== "string" || !remaining.delete(record[key] as string) || typeof record.status !== "string" || !statuses.includes(record.status)) return false;
  }
  return remaining.size === 0;
}
