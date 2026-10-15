import { describe, expect, it } from "vitest";
import { canUseRenderingStudio } from "../src/lib/permissions";

describe("temporary Rendering Studio access", () => {
  it("allows Ken's active team account", () => {
    expect(
      canUseRenderingStudio({ email: "ken@meravinteriors.com", role: "Admin", is_active: true }),
    ).toBe(true);
    expect(
      canUseRenderingStudio({ email: "KEN@MERAVINTERIORS.COM", role: "Admin", is_active: true }),
    ).toBe(true);
  });
  it("denies other admins, employees, external users, inactive accounts and missing profiles", () => {
    for (const role of ["Admin", "Employee", "Client", "Contractor"] as const) {
      expect(
        canUseRenderingStudio({ email: "katie@meravinteriors.com", role, is_active: true }),
      ).toBe(false);
    }
    expect(
      canUseRenderingStudio({ email: "ken@meravinteriors.com", role: "Admin", is_active: false }),
    ).toBe(false);
    expect(
      canUseRenderingStudio({ email: "ken@meravinteriors.com", role: "Client", is_active: true }),
    ).toBe(false);
    expect(canUseRenderingStudio(null)).toBe(false);
    expect(canUseRenderingStudio()).toBe(false);
  });
});
