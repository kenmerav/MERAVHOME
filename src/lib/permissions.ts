import type { Project, UserProfile } from "@/lib/db";

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

export type ProjectSurface = "specBook" | "presentations" | "designBoards";

export function canViewProjectSurface(
  profile: Pick<UserProfile, "is_active" | "role"> | null | undefined,
  project: Pick<
    Project,
    | "client_can_view_spec_book"
    | "client_can_view_presentations"
    | "client_can_view_design_boards"
    | "contractor_can_view_spec_book"
    | "contractor_can_view_presentations"
    | "contractor_can_view_design_boards"
  > | null | undefined,
  surface: ProjectSurface,
) {
  if (!profile?.is_active || !project) return false;
  if (profile.role === "Admin" || profile.role === "Employee") return true;
  if (profile.role === "Client") {
    if (surface === "specBook") return project.client_can_view_spec_book;
    if (surface === "presentations") return project.client_can_view_presentations;
    return project.client_can_view_design_boards;
  }
  if (profile.role === "Contractor") {
    if (surface === "specBook") return project.contractor_can_view_spec_book;
    if (surface === "presentations") return project.contractor_can_view_presentations;
    return project.contractor_can_view_design_boards;
  }
  return false;
}

export function specBookVisibilityForRole(
  profile: Pick<UserProfile, "is_active" | "role"> | null | undefined,
  project: Pick<
    Project,
    | "client_spec_show_pricing"
    | "client_spec_show_links"
    | "contractor_spec_show_pricing"
    | "contractor_spec_show_links"
  > | null | undefined,
) {
  if (!profile?.is_active || !project) return { showPricing: false, showLinks: false };
  if (profile.role === "Admin" || profile.role === "Employee") {
    return { showPricing: true, showLinks: true };
  }
  if (profile.role === "Contractor") {
    return {
      showPricing: project.contractor_spec_show_pricing !== false,
      showLinks: project.contractor_spec_show_links !== false,
    };
  }
  return {
    showPricing: project.client_spec_show_pricing === true,
    showLinks: project.client_spec_show_links === true,
  };
}
