import { describe, expect, it } from "vitest";
import { cleanSafeImportRows, parseVendorDirectoryCsv } from "../src/lib/eaWorkspace";

describe("EA vendor directory import", () => {
  it("keeps only the approved non-secret fields", () => {
    const csv = [
      "HARD SCAPE VENDORS,Username/Email,Password,Account Created,Rep Name,Rep Email,Notes,Discount",
      'Bedrosians,account-user,super-secret,,Renee Pomatto,renee@example.com,"Call first, token: hidden",20%',
      "LIGHTING,Username/Email,Password,Account Created,Rep Name,Rep Email,Notes,Discount",
      'Visual Comfort,katie@example.com,another-secret,,Kelly,kelly@example.com,"Multiline note\nwith password-like text",Username: 123 PW: hidden',
    ].join("\n");

    const rows = parseVendorDirectoryCsv(csv);
    expect(rows).toEqual([
      {
        source_row_number: 2,
        vendor: "Bedrosians",
        category: "Hard Scape",
        rep_name: "Renee Pomatto",
        rep_email: "renee@example.com",
      },
      {
        source_row_number: 4,
        vendor: "Visual Comfort",
        category: "Lighting",
        rep_name: "Kelly",
        rep_email: "kelly@example.com",
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("super-secret");
    expect(JSON.stringify(rows)).not.toContain("another-secret");
    expect(JSON.stringify(rows)).not.toContain("password-like");
    expect(JSON.stringify(rows)).not.toContain("account-user");
  });

  it("drops category headers, malformed email values, and unknown fields", () => {
    expect(
      cleanSafeImportRows([
        {
          source_row_number: 32,
          vendor: "LIGHTING",
          rep_email: "not-an-email",
          password: "hidden",
        },
        { source_row_number: 33, vendor: "Hinkleys", rep_email: "not-an-email", notes: "secret" },
      ]),
    ).toEqual([
      {
        source_row_number: 33,
        vendor: "Hinkleys",
        category: null,
        rep_name: null,
        rep_email: null,
      },
    ]);
  });
});
