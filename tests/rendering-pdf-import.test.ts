import { describe, expect, it } from "vitest";
import {
  renderingImportPagePath,
  renderingImportPageText,
  suggestRenderingImportRoom,
} from "../src/lib/renderingPdfImport";

describe("rendering PDF import helpers", () => {
  it("extracts an elevation id and caption", () => {
    expect(
      renderingImportPageText("ID2.0-1 - Kitchen Sink Wall", "Final Renderings.pdf", 1),
    ).toEqual({
      elevationId: "ID2.0-1",
      caption: "Kitchen Sink Wall",
    });
  });

  it("uses a stable page path for duplicate detection", () => {
    expect(renderingImportPagePath("project-1", "abc123", 7)).toBe(
      "rendering-imports/project-1/abc123/page-0007.png",
    );
  });

  it("prefers the most specific exact room name", () => {
    expect(
      suggestRenderingImportRoom("Office Option 2 - Built-ins", [
        { id: "office", name: "Office" },
        { id: "option", name: "Office - Option 2" },
      ]),
    ).toMatchObject({ roomId: "option" });
  });

  it("does not guess a room without an exact room-name match", () => {
    expect(
      suggestRenderingImportRoom("Guest vanity elevation", [
        { id: "primary", name: "Primary Bathroom" },
        { id: "powder", name: "Powder Bathroom" },
      ]),
    ).toBeNull();
  });
});
