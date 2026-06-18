import type { UserProfile } from "@/lib/db";

const FINANCIAL_EMAILS = new Set([
  "ken@meravinteriors.com",
  "katie@meravinteriors.com",
]);

export const OVERALL_ADMIN_EMAILS = FINANCIAL_EMAILS;

export function canViewFinancials(profile?: Pick<UserProfile, "email" | "is_active"> | null) {
  return !!profile?.is_active && FINANCIAL_EMAILS.has(profile.email.toLowerCase());
}

export const canViewProcurement = canViewFinancials;
export const canManageHours = canViewFinancials;

export function canManageStudio(
  profile?: Pick<UserProfile, "email" | "is_active" | "role" | "is_owner"> | null,
) {
  return (
    !!profile?.is_active &&
    profile.role === "Admin" &&
    (profile.is_owner || OVERALL_ADMIN_EMAILS.has(profile.email.toLowerCase()))
  );
}

export function canLogHours(profile?: Pick<UserProfile, "is_active" | "role"> | null) {
  return !!profile?.is_active && profile.role !== "Client";
}
