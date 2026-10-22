import { createHmac, timingSafeEqual } from "node:crypto";
import type { FinishObservation, SelectedFinishEvidence } from "./selectedFinish";

// Domain-separated signatures carry server-read evidence through the existing
// browser start/poll/save flow. Caller-edited scrape fields cannot verify a finish.
const mac = (text: string, secret: string) =>
  createHmac("sha256", secret).update(`merav-selected-finish-v1:${text}`).digest();
export function signFinishObservation(
  projectId: string,
  itemId: string,
  url: string,
  evidence?: SelectedFinishEvidence,
  secret = process.env.SUPABASE_SERVICE_ROLE_KEY,
) {
  if (!secret) return undefined;
  const observation: FinishObservation = {
    ...(evidence ?? {
      status: "unverified",
      color: "",
      finish: "",
      basis: "unconfirmed",
      evidence: "The product page could not confirm the selected color / finish.",
    }),
    item_id: itemId,
    source_url: url,
    checked_at: new Date().toISOString(),
  };
  const payload = Buffer.from(JSON.stringify({ project_id: projectId, observation })).toString(
    "base64url",
  );
  return `${payload}.${mac(payload, secret).toString("base64url")}`;
}
export function readFinishObservations(
  tokens: unknown,
  projectId: string,
  secret = process.env.SUPABASE_SERVICE_ROLE_KEY,
): FinishObservation[] {
  if (!secret || !Array.isArray(tokens)) return [];
  const observations = new Map<string, FinishObservation>();
  for (const token of tokens.slice(0, 2000)) {
    try {
      if (typeof token !== "string" || token.length > 8000) continue;
      const [payload, signature, extra] = token.split(".");
      if (!payload || !signature || extra) continue;
      const expected = mac(payload, secret),
        received = Buffer.from(signature, "base64url");
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) continue;
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
      const row: FinishObservation = parsed.observation;
      const age = Date.now() - Date.parse(row.checked_at);
      if (
        parsed.project_id !== projectId ||
        !Number.isFinite(age) ||
        age < -60000 ||
        age > 24 * 60 * 60 * 1000
      )
        continue;
      observations.set(row.item_id, row);
    } catch {
      /* Incomplete/altered/expired evidence remains unverified. */
    }
  }
  return [...observations.values()];
}
