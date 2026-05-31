import type { UserProfile } from "@/lib/db";

const PROCUREMENT_EMAILS = new Set([
  "ken@meravinteriors.com",
  "katie@meravinteriors.com",
]);

export function canViewProcurement(profile?: Pick<UserProfile, "email" | "is_active"> | null) {
  return !!profile?.is_active && PROCUREMENT_EMAILS.has(profile.email.toLowerCase());
}
