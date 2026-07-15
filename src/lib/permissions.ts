import type { Project, UserProfile } from "@/lib/db";

const FINANCIAL_EMAILS = new Set([
  "ken@meravinteriors.com",
  "katie@meravinteriors.com",
]);
const SPEC_BOOK_EDITOR_EMAILS = new Set(["homebycastellani@gmail.com"]);

export const OVERALL_ADMIN_EMAILS = FINANCIAL_EMAILS;

export function canViewFinancials(profile?: Pick<UserProfile, "email" | "is_active"> | null) {
  return !!profile?.is_active && FINANCIAL_EMAILS.has(profile.email.toLowerCase());
}

export const canViewProcurement = canViewFinancials;
export const canManageHours = canViewFinancials;

export function isContractorRole(role?: string | null) {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "contractor" || normalized === "builder" || normalized === "gc";
}

export function isClientRole(role?: string | null) {
  return String(role ?? "").trim().toLowerCase() === "client";
}

export function isSharedProjectRole(role?: string | null) {
  return isClientRole(role) || isContractorRole(role);
}

export function isStudioTeamRole(role?: string | null) {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "admin" || normalized === "employee";
}

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
  return !!profile?.is_active && isStudioTeamRole(profile.role);
}

export function canViewProductCatalog(profile?: Pick<UserProfile, "is_active" | "role"> | null) {
  return !!profile?.is_active && isStudioTeamRole(profile.role);
}

export function canEditSpecBook(
  profile?: Pick<UserProfile, "email" | "is_active" | "role"> | null,
) {
  return (
    !!profile?.is_active &&
    (isStudioTeamRole(profile.role) ||
      isContractorRole(profile.role) ||
      SPEC_BOOK_EDITOR_EMAILS.has(profile.email.toLowerCase()))
  );
}

export function canDownloadSpecBookPdf(
  profile: Pick<UserProfile, "is_active" | "role"> | null | undefined,
  project: Pick<
    Project,
    "client_can_download_spec_book_pdf" | "contractor_can_download_spec_book_pdf"
  > | null | undefined,
) {
  if (!profile?.is_active || !project) return false;
  if (isStudioTeamRole(profile.role)) return true;
  if (isContractorRole(profile.role)) return project.contractor_can_download_spec_book_pdf === true;
  if (isClientRole(profile.role)) return project.client_can_download_spec_book_pdf === true;
  return false;
}

export function canDownloadConstructionDocs(
  profile: Pick<UserProfile, "is_active" | "role"> | null | undefined,
  project: Pick<Project, "client_can_download_construction_docs"> | null | undefined,
) {
  if (!profile?.is_active || !project) return false;
  if (isStudioTeamRole(profile.role) || isContractorRole(profile.role)) return true;
  return isClientRole(profile.role) && project.client_can_download_construction_docs === true;
}

export type ProjectSurface = "specBook" | "presentations" | "designBoards" | "constructionDocs";

export function canViewProjectSurface(
  profile: Pick<UserProfile, "is_active" | "role"> | null | undefined,
  project: Pick<
    Project,
    | "client_can_view_spec_book"
    | "client_can_view_presentations"
    | "client_can_view_design_boards"
    | "client_can_view_construction_docs"
    | "contractor_can_view_spec_book"
    | "contractor_can_view_presentations"
    | "contractor_can_view_design_boards"
    | "contractor_can_view_construction_docs"
  > | null | undefined,
  surface: ProjectSurface,
) {
  if (!profile?.is_active || !project) return false;
  if (isStudioTeamRole(profile.role)) return true;
  if (isClientRole(profile.role)) {
    if (surface === "specBook") return project.client_can_view_spec_book;
    if (surface === "presentations") return project.client_can_view_presentations;
    if (surface === "constructionDocs") return project.client_can_view_construction_docs;
    return project.client_can_view_design_boards;
  }
  if (isContractorRole(profile.role)) {
    if (surface === "specBook") return project.contractor_can_view_spec_book;
    if (surface === "presentations") return project.contractor_can_view_presentations;
    if (surface === "constructionDocs") return project.contractor_can_view_construction_docs;
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
    | "client_spec_show_ordering"
    | "contractor_spec_show_pricing"
    | "contractor_spec_show_links"
    | "contractor_spec_show_ordering"
    | "contractor_spec_can_update_ordering"
  > | null | undefined,
) {
  if (!profile?.is_active || !project) return { showPricing: false, showLinks: false, showOrdering: false };
  if (isStudioTeamRole(profile.role)) {
    return { showPricing: true, showLinks: true, showOrdering: true };
  }
  if (isContractorRole(profile.role)) {
    return {
      showPricing: project.contractor_spec_show_pricing !== false,
      showLinks: project.contractor_spec_show_links !== false,
      showOrdering: project.contractor_spec_show_ordering !== false,
    };
  }
  return {
    showPricing: project.client_spec_show_pricing === true,
    showLinks: project.client_spec_show_links === true,
    showOrdering: project.client_spec_show_ordering === true,
  };
}

export function canUpdateSpecOrderingForRole(
  profile: Pick<UserProfile, "is_active" | "role"> | null | undefined,
  project: Pick<Project, "contractor_spec_can_update_ordering"> | null | undefined,
) {
  if (!profile?.is_active || !project) return false;
  if (isStudioTeamRole(profile.role)) return true;
  return isContractorRole(profile.role) && project.contractor_spec_can_update_ordering === true;
}
