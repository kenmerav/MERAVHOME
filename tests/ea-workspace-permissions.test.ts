import { describe, expect, it } from "vitest";
import {
  canChatWithConstructionDocuments,
  canReconnectMarvinInbox,
  canUseEaWorkspace,
  canUseMarvin,
  isEaWorkspaceEmail,
} from "../src/lib/permissions";

const allowedEmails = [
  "ken@meravinteriors.com",
  "katie@meravinteriors.com",
  "brynn@meravinteriors.com",
];

describe("EA Desk account access", () => {
  it.each(allowedEmails)("allows the named active Studio account %s", (email) => {
    expect(
      canUseEaWorkspace({
        email,
        is_active: true,
        role: email.startsWith("brynn") ? "Employee" : "Admin",
      }),
    ).toBe(true);
    expect(canUseMarvin({ email, is_active: true })).toBe(true);
    expect(isEaWorkspaceEmail(email)).toBe(true);
  });

  it("rejects every other active employee", () => {
    expect(
      canUseEaWorkspace({
        email: "another.employee@meravinteriors.com",
        is_active: true,
        role: "Employee",
      }),
    ).toBe(false);
  });

  it("rejects inactive or external accounts even when the email is named", () => {
    expect(
      canUseEaWorkspace({
        email: "brynn@meravinteriors.com",
        is_active: false,
        role: "Employee",
      }),
    ).toBe(false);
    expect(
      canUseEaWorkspace({
        email: "brynn@meravinteriors.com",
        is_active: true,
        role: "Client",
      }),
    ).toBe(false);
  });

  it("allows only Ken to reconnect the shared Marvin inbox", () => {
    expect(canReconnectMarvinInbox("ken@meravinteriors.com")).toBe(true);
    expect(canReconnectMarvinInbox(" KEN@MERAVINTERIORS.COM ")).toBe(true);
    expect(canReconnectMarvinInbox("katie@meravinteriors.com")).toBe(false);
    expect(canReconnectMarvinInbox("brynn@meravinteriors.com")).toBe(false);
    expect(canReconnectMarvinInbox(null)).toBe(false);
  });

  it("allows construction-document chat only for active Ken and Katie Studio accounts", () => {
    for (const email of ["ken@meravinteriors.com", "katie@meravinteriors.com"]) {
      expect(canChatWithConstructionDocuments({ email, is_active: true, role: "Admin" })).toBe(
        true,
      );
    }
    expect(
      canChatWithConstructionDocuments({
        email: "brynn@meravinteriors.com",
        is_active: true,
        role: "Employee",
      }),
    ).toBe(false);
    expect(
      canChatWithConstructionDocuments({
        email: "ken@meravinteriors.com",
        is_active: false,
        role: "Admin",
      }),
    ).toBe(false);
    expect(
      canChatWithConstructionDocuments({
        email: "katie@meravinteriors.com",
        is_active: true,
        role: "Client",
      }),
    ).toBe(false);
  });
});
