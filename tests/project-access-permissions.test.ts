import { describe, expect, it } from "vitest";
import { canManageProjectAccess } from "../src/lib/permissions";
import { parseProjectAccessSettings, PROJECT_ACCESS_FIELDS } from "../src/lib/projectAccess";

describe("project access management", () => {
  it("allows Brynn and existing Studio managers", () => {
    expect(
      canManageProjectAccess({
        email: "brynn@meravinteriors.com",
        role: "Employee",
        is_active: true,
        is_owner: false,
      }),
    ).toBe(true);
    expect(
      canManageProjectAccess({
        email: "ken@meravinteriors.com",
        role: "Admin",
        is_active: true,
        is_owner: true,
      }),
    ).toBe(true);
    expect(
      canManageProjectAccess({
        email: "katie@meravinteriors.com",
        role: "Admin",
        is_active: true,
        is_owner: false,
      }),
    ).toBe(true);
  });

  it("does not grant other employees, external users, or inactive Brynn", () => {
    expect(
      canManageProjectAccess({
        email: "another@meravinteriors.com",
        role: "Employee",
        is_active: true,
        is_owner: false,
      }),
    ).toBe(false);
    expect(
      canManageProjectAccess({
        email: "brynn@meravinteriors.com",
        role: "Client",
        is_active: true,
        is_owner: false,
      }),
    ).toBe(false);
    expect(
      canManageProjectAccess({
        email: "brynn@meravinteriors.com",
        role: "Employee",
        is_active: false,
        is_owner: false,
      }),
    ).toBe(false);
  });

  it("accepts only the exact set of boolean access switches", () => {
    const settings = Object.fromEntries(PROJECT_ACCESS_FIELDS.map((field) => [field, false]));
    expect(parseProjectAccessSettings(settings)).toEqual(settings);
    expect(parseProjectAccessSettings({ ...settings, status: "Complete" })).toBeNull();
    expect(
      parseProjectAccessSettings({ ...settings, client_can_view_spec_book: "true" }),
    ).toBeNull();
  });
});
