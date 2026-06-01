import type { UserProfile } from "@/lib/db";

const FINANCIAL_EMAILS = new Set([
  "ken@meravinteriors.com",
  "katie@meravinteriors.com",
]);

export function canViewFinancials(profile?: Pick<UserProfile, "email" | "is_active"> | null) {
  return !!profile?.is_active && FINANCIAL_EMAILS.has(profile.email.toLowerCase());
}

export const canViewProcurement = canViewFinancials;
export const canManageHours = canViewFinancials;

export function canLogHours(profile?: Pick<UserProfile, "is_active" | "role"> | null) {
  return !!profile?.is_active && profile.role !== "Client";
}
