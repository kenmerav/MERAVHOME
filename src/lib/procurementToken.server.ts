import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PROCUREMENT_RUN_TTL_MINUTES } from "@/lib/procurementCart";

export function generateRunAuthorization() {
  return randomBytes(32).toString("base64url");
}

export function hashRunAuthorization(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function runAuthorizationMatches(value: string, expectedHash: string) {
  const actual = Buffer.from(hashRunAuthorization(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function procurementRunExpiry(now = new Date()) {
  return new Date(now.getTime() + PROCUREMENT_RUN_TTL_MINUTES * 60_000).toISOString();
}

export function isRunAuthorizationUsable(input: {
  expiresAt: string;
  revokedAt?: string | null;
  now?: Date;
}) {
  if (input.revokedAt) return false;
  const expiresAt = new Date(input.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > (input.now ?? new Date()).getTime();
}
