import { expect, it } from "vitest";
import { canRunPaidSpecCheck } from "@/lib/specCheckAccess";

const user = { email: "ken@meravinteriors.com" };
const profile = { email: "ken@meravinteriors.com", is_active: true, role: "Admin" };
it("allows Ken's verified active staff account", () => {
  expect(canRunPaidSpecCheck(user, profile)).toBe(true);
  expect(canRunPaidSpecCheck({ email: " KEN@MERAVINTERIORS.COM " }, profile)).toBe(true);
});
it("rejects an anonymous, inactive, non-staff, missing or different authenticated account", () => {
  expect(canRunPaidSpecCheck({ ...user, is_anonymous: true }, profile)).toBe(false);
  expect(canRunPaidSpecCheck(user, { ...profile, is_active: false })).toBe(false);
  expect(canRunPaidSpecCheck(user, { ...profile, role: "Client" })).toBe(false);
  expect(canRunPaidSpecCheck(null, profile)).toBe(false);
  expect(canRunPaidSpecCheck({ email: "other@meravinteriors.com" }, profile)).toBe(false);
  expect(canRunPaidSpecCheck(user, { ...profile, email: "other@meravinteriors.com" })).toBe(false);
});
