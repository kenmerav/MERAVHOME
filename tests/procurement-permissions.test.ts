import { describe, expect, it } from "vitest";
import { canUseProcurementCartBuilder } from "@/lib/permissions";

describe("Cart Builder permissions", () => {
  it("allows only Ken's active Studio profile", () => {
    expect(
      canUseProcurementCartBuilder({
        email: "ken@meravinteriors.com",
        is_active: true,
      }),
    ).toBe(true);
    expect(
      canUseProcurementCartBuilder({
        email: "katie@meravinteriors.com",
        is_active: true,
      }),
    ).toBe(false);
    expect(
      canUseProcurementCartBuilder({
        email: "ken@meravinteriors.com",
        is_active: false,
      }),
    ).toBe(false);
  });

  it("matches Ken's email without case sensitivity", () => {
    expect(
      canUseProcurementCartBuilder({
        email: "KEN@MERAVINTERIORS.COM",
        is_active: true,
      }),
    ).toBe(true);
  });
});
