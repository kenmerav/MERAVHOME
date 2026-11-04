import { describe, expect, it } from "vitest";
import { requireSavedSpecMaterial } from "../src/lib/specMaterialWrite";

describe("Spec Book material save verification", () => {
  it("accepts a confirmed Materials row", () => {
    expect(requireSavedSpecMaterial({ data: { id: "item-1" }, error: null })).toEqual({ id: "item-1" });
  });

  it("reports rejected saves instead of showing success", () => {
    expect(() => requireSavedSpecMaterial({ data: null, error: { message: "This selection is connected to Room Design." } }))
      .toThrow("This selection is connected to Room Design.");
  });

  it("rejects saves that update no row", () => {
    expect(() => requireSavedSpecMaterial({ data: null, error: null })).toThrow("could not be updated");
  });
});
