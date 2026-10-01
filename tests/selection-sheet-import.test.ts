import { describe, expect, it } from "vitest";
import {
  blankMissing,
  fillSelectionBlanks,
  matchSelectionImport,
  parseSelectionSheet,
  readSelectionCsv,
  selectedSheetStatus,
  selectionImportId,
  selectionImportMarker,
} from "../src/lib/selectionSheetImport";

const header = "ID,Room,Item,Product,Vendor,Finish,Dimensions,Quantity,Product link,Status,Notes";
const csv = `${header}\nSEL-001,Primary bath,Flooring,Cream Misto,TileBar,Honed,6 x 12,,,Selected; details open,"Running bond, left to right"`;
const row = () => parseSelectionSheet(csv)[0];

describe("selection sheet import", () => {
  it("uses stable IDs so concurrent retries cannot insert duplicate records", async () => {
    expect(await selectionImportId("project/bath/SEL-001")).toBe(
      await selectionImportId("project/bath/SEL-001"),
    );
    expect(await selectionImportId("project/bath/SEL-001")).not.toBe(
      await selectionImportId("project/other/SEL-001"),
    );
  });
  it("matches an existing exact product without collapsing another finish", () => {
    const entry = row();
    const existing = {
      id: "selected",
      room_id: "bath",
      item_label: "Flooring",
      product_id: "product",
      product: {
        name: "Cream Misto",
        vendor: "TileBar",
        finish: "Honed",
        dimensions: "6 x 12",
      },
    };
    expect(matchSelectionImport("project", "bath", entry, [existing])).toEqual(existing);
    expect(
      matchSelectionImport("project", "bath", entry, [
        { ...existing, product: { ...existing.product, finish: "Polished" } },
      ]),
    ).toBeNull();
  });
  it("keeps unlinked selections, missing quantity and image inputs blank", () => {
    const entry = row();
    expect(entry.productUrl).toBeNull();
    expect(entry.quantity).toBeNull();
    expect(entry.dimensions).toBe("6 x 12");
    expect(entry.notes).toContain("Running bond, left to right");
    expect(fillSelectionBlanks("project", entry, null).quantity).toBeNull();
  });
  it("handles BOM, CRLF, quoted multiline notes, commas and escaped quotes", () => {
    expect(readSelectionCsv('\uFEFFa,b\r\n"first, second","line 1\nline ""2"""\r\n')).toEqual([
      ["a", "b"],
      ["first, second", 'line 1\nline "2"'],
    ]);
    expect(() => readSelectionCsv('a,b\n"bad')).toThrow("unclosed");
  });
  it("accepts the original Gillespie headers without guessing mixed dimensions into a quantity", () => {
    const entry = parseSelectionSheet(
      "ID,Room / area,Item,Product / direction,Brand / supplier,Finish / model,Dimensions / quantity,Status,Installation / layout notes,Still needed,Source date,Source,Source link,Product link\nSEL-020,Kitchen island,Pendants,Pietra,Corbett,Vintage Brass,2 pendants; 20 in,Selected; details open,Center on island,Mounting height,9/13/2026,Client PDF,https://example.com/source,",
    )[0];
    expect(entry.quantity).toBeNull();
    expect(entry.notes).toContain("2 pendants; 20 in");
    expect(entry.notes).toContain("Mounting height");
    expect(entry.productUrl).toBeNull();
  });
  it("rejects malformed rows, duplicate IDs, unsafe links and invalid quantities before saving", () => {
    expect(() => parseSelectionSheet(csv + "\nSEL-001,Bath,Sink,Test,,,,,,Selected,")).toThrow(
      "Duplicate",
    );
    expect(() =>
      parseSelectionSheet(csv.replace("6 x 12,,,", "6 x 12,,javascript:alert(1),")),
    ).toThrow("Invalid product link");
    expect(() => parseSelectionSheet(csv.replace("6 x 12,,,", "6 x 12,-1,,"))).toThrow(
      "Invalid quantity",
    );
    expect(() => parseSelectionSheet(csv + "\nSEL-002,Bath")).toThrow("wrong number");
  });
  it("preserves explicit zero and treats placeholders as missing", () => {
    expect(parseSelectionSheet(csv.replace("6 x 12,,,", "6 x 12,0,,"))[0].quantity).toBe(0);
    for (const value of ["", "TBD", "Not provided", "n.a.", null])
      expect(blankMissing(value)).toBeNull();
    expect(blankMissing("Finish TBD; door chosen")).toBe("Finish TBD; door chosen");
  });
  it("defaults only chosen entries into the import", () => {
    for (const status of ["Selected", "Selected; details open", "Purchased"])
      expect(selectedSheetStatus(status)).toBe(true);
    for (const status of ["Conflict", "Quoted option", "Needs decision", "Design direction", ""])
      expect(selectedSheetStatus(status)).toBe(false);
  });
  it("matches the stable source reference only in the assigned room", () => {
    const entry = row(),
      marker = selectionImportMarker("project", entry.sourceId);
    const existing = { id: "existing", room_id: "bath", item_label: "Flooring", notes: marker };
    expect(matchSelectionImport("project", "bath", entry, [existing])).toEqual(existing);
    expect(matchSelectionImport("project", "other", entry, [existing])).toBeNull();
    expect(() =>
      matchSelectionImport("project", "bath", entry, [existing, { ...existing, id: "duplicate" }]),
    ).toThrow("Multiple existing");
  });
  it("fills one empty slot and preserves existing selections, exclusions and manual values", () => {
    const entry = row();
    const empty = { id: "slot", room_id: "bath", item_label: "Flooring", notes: "Trade note" };
    expect(matchSelectionImport("project", "bath", entry, [empty])).toEqual(empty);
    expect(
      matchSelectionImport("project", "bath", entry, [{ ...empty, product_id: "chosen" }]),
    ).toBeNull();
    expect(
      matchSelectionImport("project", "bath", entry, [{ ...empty, not_needed: true }]),
    ).toBeNull();
    const patch = fillSelectionBlanks("project", entry, {
      ...empty,
      quantity: 0,
      color: "Chosen finish",
      product_url: "https://example.com",
    });
    expect(patch.quantity).toBe(0);
    expect(patch.color).toBe("Chosen finish");
    expect(patch.product_url).toBe("https://example.com");
    expect(patch.notes).toContain("Trade note");
    expect(fillSelectionBlanks("project", entry, { ...empty, ...patch }).notes).toBe(patch.notes);
  });
});
