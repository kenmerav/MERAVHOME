import { isStudioTeamRole } from "./permissions";

// The authentication service must have verified `user`; the profile alone is
// not proof of identity. This temporary pilot gate applies only to starting
// paid full-check work, not reading saved reports or approving saved changes.
export function canRunPaidSpecCheck(user: { email?: string | null; is_anonymous?: boolean } | null | undefined,
  profile: { email?: string | null; is_active?: boolean | null; role?: string | null } | null | undefined) {
  const email = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();
  return !!user && user.is_anonymous !== true && !!profile?.is_active && isStudioTeamRole(profile.role) &&
    email(user.email) === "ken@meravinteriors.com" && email(profile.email) === "ken@meravinteriors.com";
}
