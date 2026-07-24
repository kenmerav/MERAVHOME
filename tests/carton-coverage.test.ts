import { describe, expect, it } from "vitest";
import {
  packagingDocumentUrls,
  parseCartonCoverageText,
  resolveCartonCoverage,
  resolveCartonCoverageTable,
} from "../src/lib/cartonCoverage";

describe("carton coverage parsing", () => {
  it.each([
    ["Sq Ft Per Carton: 10.32", 10.32],
    ["Coverage per carton: 11.63 sq ft", 11.63],
    ["Box quantity: 9.84 SF", 9.84],
    ["This case covers 12.5 square feet", 12.5],
    ["13.2 sq. ft. / box", 13.2],
  ])("extracts %s", (source, expected) => {
    expect(resolveCartonCoverage({ pageText: [source] })).toMatchObject({
      squareFeet: expected,
      confidence: "exact",
    });
  });

  it("does not confuse pieces or price per square foot with carton coverage", () => {
    expect(parseCartonCoverageText("12 pieces per box. Price: $4.50 per sq ft.")).toEqual([]);
  });

  it("requires review when a page contains coverage for multiple sizes", () => {
    expect(
      resolveCartonCoverage({
        pageText: ["3 x 12: 10.32 sq ft per box. 5 x 5: 11.63 sq ft per box."],
      }),
    ).toMatchObject({
      squareFeet: null,
      confidence: "review",
      candidates: [10.32, 11.63],
    });
  });

  it("resolves packaging links relative to the product page", () => {
    expect(
      packagingDocumentUrls(
        "https://example.com/tile/product/",
        '<a href="../media/thickness-packaging.pdf">Thickness & Packaging</a>',
      ),
    ).toEqual(["https://example.com/tile/media/thickness-packaging.pdf"]);
  });

  it("matches the exact size row in an Arizona-style packaging table", () => {
    const html = `
      <h2 id='Flash'>Flash</h2>
      <div class="section-content">
        <table>
          <tr><th>Item ID</th><th>Unit</th><th>Size</th><th>Item Type</th><th>Finish</th><th>Thickness</th><th>Item Status</th><th>Sf/Pc(Sht)</th><th>Pcs(Shts)/Box</th><th>Sf/Box</th><th>Boxes/Pallet</th><th>Sf/Pallet</th><th>Additional Packing Info</th>
          <tr><td>FLASH WHITE 3X12</td><td>SF</td><td>3X12</td><td>Field</td><td></td><td>8mm</td><td></td><td>0.2421</td><td>24</td><td>5.8104</td><td>125</td><td>726.3</td><td></td>
          <tr><td>FLASH WHITE 5X5</td><td>SF</td><td>5X5</td><td>Field</td><td></td><td>8mm</td><td></td><td>0.1818</td><td>38</td><td>6.9084</td><td>114</td><td>787.5576</td><td></td>
        </table>
      </div>
      <h2 id='Flash Bars'>Flash Bars</h2>
    `;
    expect(
      resolveCartonCoverageTable({
        html,
        sourceUrl: "https://media.arizonatile.com/packing_info.html#Flash",
        productName: "Flash",
        sku: "Flash",
        size: "3x12",
        color: "White",
      }),
    ).toEqual({
      squareFeet: 5.8104,
      confidence: "exact",
      evidence: "FLASH WHITE 3X12 · 3X12 · 24 pcs/box · 5.8104 sq ft/box",
      candidates: [5.8104],
    });
  });

  it("requires review when exact-size rows disagree and color cannot disambiguate them", () => {
    const html = `
      <h2 id="Test">Test</h2>
      <table>
        <tr><th>Item ID</th><th>Size</th><th>Pcs/Box</th><th>Sf/Box</th>
        <tr><td>TEST A 3X12</td><td>3X12</td><td>20</td><td>5</td>
        <tr><td>TEST B 3X12</td><td>3X12</td><td>24</td><td>6</td>
      </table>
    `;
    expect(
      resolveCartonCoverageTable({
        html,
        sourceUrl: "https://example.com/packing#Test",
        productName: "Test",
        sku: "",
        size: "3x12",
      }),
    ).toMatchObject({
      squareFeet: null,
      confidence: "review",
      candidates: [5, 6],
    });
  });
});
