export async function completionResponse<T>(response: Response, fallback: string): Promise<T> {
  let result: any;
  try { result = await response.json(); }
  catch {
    if ([502, 503, 504].includes(response.status)) throw new Error("The check was interrupted by a server timeout or temporary outage. Open the saved review to see any results already saved. No automatic retry was made.");
    throw new Error(`${fallback} The server returned an unreadable response. Open the saved review before running another check.`);
  }
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : fallback);
  return result;
}
