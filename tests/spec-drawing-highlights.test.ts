import { describe, expect, it } from "vitest";
import {
  drawingCalloutHighlights,
  drawingTextRuns,
  type DrawingTextRun,
} from "@/lib/specDrawingHighlights";
const item = {
  id: "tile",
  ref: "S1",
  roomId: "bath2",
  room: "Bathroom Two",
  label: "Shower Wall",
  name: "Tierra Linear Nieve Punto",
  sku: "EZTIER0520",
  vendor: "Tiles of Ezra",
  finish: "Glazed",
  dimensions: "2 x 8",
  cad: "",
};
const run = (
  text: string,
  left = 0.6,
  top = 0.2,
  right = 0.9,
  bottom = top + 0.012,
): DrawingTextRun => ({ text, bounds: { left, top, right, bottom } });
describe("grounded drawing callout highlights", () => {
  it("does not box a different finish's shower-wall callout when the selected tile has a SKU reference", () => {
    const marks = drawingCalloutHighlights(
      [run("SKU: EZTIER0520 NIEVE PUNTO"), run("DECORATIVE BAND ON ALL SHOWER WALLS", 0.6, 0.5)],
      item,
      [item],
      true,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].basis).toBe("sku");
    expect(
      drawingCalloutHighlights([run("DECORATIVE BAND ON ALL SHOWER WALLS")], item, [item], true),
    ).toEqual([]);
  });
  it("maps PDF text baselines into upright normalized page coordinates", () => {
    const [text] = drawingTextRuns(
      [{ str: "NIEVE PUNTO", transform: [10, 0, 0, 10, 100, 800], width: 100, height: 10 }],
      { transform: [1, 0, 0, -1, 0, 1000], width: 1000, height: 1000, scale: 1 },
    );
    expect(text.bounds.left).toBeCloseTo(0.1);
    expect(text.bounds.right).toBeCloseTo(0.2);
    expect(text.bounds.top).toBeCloseTo(0.1915);
    expect(text.bounds.bottom).toBeCloseTo(0.202);
  });
  it("honors rotated viewports rather than mirroring/offsetting the box", () => {
    const [text] = drawingTextRuns(
      [{ str: "Callout", transform: [10, 0, 0, 10, 100, 800], width: 100, height: 10 }],
      { transform: [0, 1, 1, 0, 0, 0], width: 1000, height: 1000, scale: 1 },
    );
    expect(text.bounds.left).toBeCloseTo(0.798);
    expect(text.bounds.right).toBeCloseTo(0.8085);
    expect(text.bounds.top).toBeCloseTo(0.1);
    expect(text.bounds.bottom).toBeCloseTo(0.2);
  });
  it("boxes an exact SKU, with separate repeated callouts and no whole-page box", () => {
    const highlights = drawingCalloutHighlights(
      [
        run("BATH 2 ELEVATION", 0.05, 0.04),
        run("SKU: EZTIER0520"),
        run("SKU: EZTIER0520", 0.6, 0.65),
      ],
      item,
      [item],
      true,
    );
    expect(highlights).toHaveLength(2);
    expect(
      highlights.every(
        (h) => h.basis === "sku" && h.bounds.left > 0.5 && h.bounds.bottom - h.bounds.top < 0.03,
      ),
    ).toBe(true);
  });
  it("finds a punctuation-normalized SKU even when the catalog and PDF differ", () => {
    const valve = { ...item, name: "Rough-in Valve", sku: "SH-4001" };
    expect(drawingCalloutHighlights([run("SKU: SH4001")], valve, [valve], true)[0]).toMatchObject({
      basis: "sku",
      text: "SKU: SH4001",
    });
    expect(drawingCalloutHighlights([run("SKU: SH40012")], valve, [valve], true)).toEqual([]);
  });
  it("groups product names across nearby lines, excluding unrelated dimension notes", () => {
    const marks = drawingCalloutHighlights(
      [
        run("TIERRA BASICS", 0.6, 0.2),
        run("NIEVE PUNTO", 0.6, 0.222),
        run("SIZE: 2 X 8", 0.6, 0.244),
      ],
      { ...item, sku: "" },
      [item],
      true,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].basis).toBe("product_name");
    expect(marks[0].bounds.bottom).toBeLessThan(0.244);
    expect(marks[0].bounds.top).toBeLessThan(0.2);
  });
  it("does not assemble a product name from different drawing columns", () => {
    expect(
      drawingCalloutHighlights(
        [run("TIERRA BASICS", 0.1, 0.2, 0.3), run("NIEVE PUNTO", 0.65, 0.22)],
        { ...item, sku: "" },
        [item],
        true,
      ),
    ).toEqual([]);
  });
  it("boxes only a unique room-specific fixture callout, never an ambiguous fixture", () => {
    const faucet = { ...item, id: "faucet", label: "Faucet", name: "Faucet", sku: "" };
    expect(drawingCalloutHighlights([run("FAUCET")], faucet, [faucet], true)[0].basis).toBe(
      "room_item",
    );
    expect(drawingCalloutHighlights([run("FAUCET")], faucet, [faucet], false)).toEqual([]);
    expect(
      drawingCalloutHighlights(
        [run("FAUCET")],
        faucet,
        [faucet, { ...faucet, id: "second" }],
        true,
      ),
    ).toEqual([]);
  });
  it("does not highlight a room label, an image-only fixture or demolition text", () => {
    const faucet = { ...item, label: "Faucet", name: "Faucet", sku: "" };
    expect(drawingCalloutHighlights([run("KITCHEN ELEVATION")], faucet, [faucet], true)).toEqual(
      [],
    );
    expect(drawingCalloutHighlights([], faucet, [faucet], true)).toEqual([]);
    expect(
      drawingCalloutHighlights([run("REMOVE EXISTING FAUCET")], faucet, [faucet], true),
    ).toEqual([]);
  });
  it("drops empty/invalid PDF text runs instead of placing a false box", () => {
    expect(
      drawingTextRuns(
        [
          { type: "beginMarkedContent" },
          { str: "", transform: [] },
          { str: "bad", transform: [0, 0, 0, 0, 0, 0], width: 0 },
        ],
        { transform: [1, 0, 0, -1, 0, 1000], width: 1000, height: 1000, scale: 1 },
      ),
    ).toEqual([]);
  });
});
