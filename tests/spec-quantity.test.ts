import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpecQuantityEditor } from "../src/components/SpecQuantityEditor";
import { formatSpecQuantity, invoiceQuantityInput, invoiceQuantityNumber, invoiceQuantityReady, parseSpecQuantity, specQuantityInput, specQuantityUnit, validateSpecQuantityPatch } from "../src/lib/specQuantity";

describe("Spec Book Count / Sq Ft / TBD", () => {
  it("preserves legacy quantities as Count and does not invent TBD for blanks", () => {
    expect(specQuantityUnit({ quantity: 14 })).toBe("count");
    expect(formatSpecQuantity({ quantity: 14 })).toBe("14");
    expect(specQuantityInput({ quantity: null })).toBe("");
    expect(parseSpecQuantity("", "count")).toEqual({ quantity: null, quantity_tbd: false, quantity_unit: "count" });
  });
  it.each(["TBD", "tbd", " Tbd "])("accepts %s without a numeric quantity", (value) => {
    expect(parseSpecQuantity(value, "square_feet")).toEqual({ quantity: null, quantity_tbd: true, quantity_unit: "square_feet" });
    expect(formatSpecQuantity({ quantity: null, quantity_tbd: true, quantity_unit: "square_feet" })).toBe("TBD Sq Ft");
  });
  it("accepts decimal areas and whole-number counts, including explicit zero", () => {
    expect(parseSpecQuantity("12.75", "square_feet").quantity).toBe(12.75);
    expect(parseSpecQuantity("3", "count").quantity).toBe(3);
    expect(parseSpecQuantity("0", "count").quantity).toBe(0);
    expect(formatSpecQuantity({ quantity: 12.75, quantity_unit: "square_feet" })).toBe("12.75 Sq Ft");
  });
  it.each(["-1", "Infinity", "NaN", "1e2", "12 feet", "12.34567", "1000000000001"])("rejects invalid quantities: %s", (value) => {
    expect(() => parseSpecQuantity(value, "square_feet")).toThrow();
  });
  it("does not silently round a decimal Count or convert units", () => {
    expect(() => parseSpecQuantity("12.5", "count")).toThrow("whole number");
    expect(parseSpecQuantity("12", "square_feet").quantity).toBe(12);
  });
  it("clears TBD when a known quantity is entered", () => {
    expect(parseSpecQuantity("2", "count")).toEqual({ quantity: 2, quantity_tbd: false, quantity_unit: "count" });
  });
  it("rejects forged units, wrong types, and contradictory TBD states", () => {
    expect(() => validateSpecQuantityPatch({ quantity: 4, quantity_tbd: true, quantity_unit: "count" })).toThrow();
    expect(() => validateSpecQuantityPatch({ quantity: "4", quantity_tbd: false, quantity_unit: "count" })).toThrow();
    expect(() => validateSpecQuantityPatch({ quantity: 4, quantity_tbd: false, quantity_unit: "boxes" })).toThrow();
    expect(() => validateSpecQuantityPatch({ quantity: 4, quantity_unit: "count" })).toThrow();
  });
  it("never turns an explicit TBD into an invoice quantity of one", () => {
    expect(invoiceQuantityInput({ quantity: null, quantity_tbd: true })).toBe("TBD");
    expect(invoiceQuantityReady("TBD")).toBe(false);
    expect(invoiceQuantityNumber("TBD")).toBe(0);
    expect(invoiceQuantityReady("12.5", "square_feet")).toBe(true);
    expect(invoiceQuantityReady("12.5", "count")).toBe(false);
    expect(invoiceQuantityReady("")).toBe(false);
    expect(invoiceQuantityInput({ quantity: 2 })).toBe("2");
    expect(invoiceQuantityInput({ quantity: null })).toBe("1"); // Existing blank legacy behavior.
  });
  it("keeps public quantity display read-only with no dialog or edit control", () => {
    const html = renderToStaticMarkup(createElement(SpecQuantityEditor, {
      item: { quantity: null, quantity_tbd: true, quantity_unit: "square_feet" },
      label: "Flooring", disabled: true, onSave: async () => {},
    }));
    expect(html).toContain("TBD Sq Ft");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<dialog");
  });
});
