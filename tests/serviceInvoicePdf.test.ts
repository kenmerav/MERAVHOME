import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, StandardFonts, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { planInvoicePdfPayments, updateServiceInvoicePdf, type InvoicePdfPage } from "../src/lib/serviceInvoicePdf";
import { sanitizeInvoicePdfBlob } from "../src/lib/invoiceDocuments";

const payments = [
  { label: "Due on Project Start", amount: 9000, status: "paid", sort_order: 0 },
  { label: "Due at Design Document Delivery", amount: 9000, status: "due", notes: "https://buy.stripe.com/test_current", sort_order: 1 },
];
const summary = { payments, totalAmount: 18000, paidAmount: 9000, balanceDue: 9000 };

const pages: InvoicePdfPage[] = [{ index: 0, rotation: 0, items: [
  { text: "SERVICE INVOICE", x: 370, y: 700, width: 120, size: 12 },
  { text: "Paid:", x: 454, y: 380, width: 26, size: 8 },
  { text: "Design Fee Due:", x: 410, y: 365, width: 70, size: 8 },
  { text: "$18,000.00", x: 500, y: 365, width: 46, size: 9 },
  { text: "Due on Project Start:", x: 390, y: 350, width: 90, size: 8 },
  { text: "$9,000.00", x: 504, y: 350, width: 42, size: 9 },
  { text: "Due at Design Document Delivery:", x: 350, y: 335, width: 130, size: 8 },
  { text: "$9,000.00", x: 504, y: 335, width: 42, size: 9 },
  { text: "CLICK HERE TO PAY", x: 392, y: 300, width: 88, size: 9 },
  { text: "$", x: 488, y: 300, width: 5, size: 9 },
  { text: "9,000.00", x: 510, y: 300, width: 36, size: 9 },
] }];

const fontAsset = (file: string) => new Uint8Array(readFileSync(new URL(`../public/invoice-assets/${file}`, import.meta.url)));

async function sourcePdf(branded = false) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = branded
    ? await document.embedFont(fontAsset("v1/PlayfairDisplay.ttf"), { subset: true })
    : await document.embedFont(StandardFonts.TimesRoman);
  const page = document.addPage([612, 792]);
  for (const item of pages[0].items) page.drawText(item.text, { x: item.x, y: item.y, size: item.size, font });
  page.drawText("Original scope and client stay here", { x: 60, y: 500, size: 10, font });
  for (const url of ["https://buy.stripe.com/test_old", "mailto:studio@example.test"]) {
    page.node.addAnnot(document.context.register(document.context.obj({ Type: "Annot", Subtype: "Link", Rect: [390, 300, 480, 310], A: { S: "URI", URI: document.context.obj(url) } })));
  }
  return document.save();
}

function links(document: PDFDocument) {
  const page = document.getPages()[0];
  const annotations = page.node.Annots();
  return Array.from({ length: annotations?.size() ?? 0 }, (_, i) => {
    const annotation = document.context.lookup(annotations!.get(i)) as any;
    const action = annotation.lookup(PDFName.of("A"));
    return action.lookup(PDFName.of("URI")).decodeText();
  });
}

describe("uploaded service invoice payment refresh", () => {
  it("keeps an extra inline on the original page and links the combined amount", async () => {
    const source = await sourcePdf();
    const extra = { id: "extra", adjustment_type: "charge" as const, label: "Material Ordering", amount: 2500, status: "open" };
    const rows = payments.map(payment => payment.status === "due" ? { ...payment,
      notes: "Stripe payment link: https://buy.stripe.com/test_combined\nStripe payment amount: 11500.00\nStripe adjustment ids: extra" } : payment);
    const updated = await updateServiceInvoicePdf(source, { ...summary, payments: rows, adjustments: [extra], balanceDue: 11500 });
    const result = await PDFDocument.load(updated!);
    expect(result.getPageCount()).toBe(1);
    expect(links(result)).toContain("https://buy.stripe.com/test_combined");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const parsed = await pdfjs.getDocument({ data: updated!.slice(), isEvalSupported: false }).promise;
    try {
      const items = (await (await parsed.getPage(1)).getTextContent()).items.filter((item: any) => "str" in item) as any[];
      const extraText = items.find(item => item.str === "Material Ordering");
      const payText = items.filter(item => item.str === "CLICK HERE TO PAY").at(-1);
      expect(extraText.transform[5]).toBeGreaterThan(payText.transform[5]);
      expect(items.some(item => item.str === "$2,500.00")).toBe(true);
      expect(items.some(item => item.str === "$11,500.00")).toBe(true);
    } finally { await parsed.destroy(); }
  });
  it("matches imported Due labels and generated Phase labels to the same original rows", () => {
    expect(planInvoicePdfPayments(pages, summary)?.phases.map(row => [row.payment.status, row.current])).toEqual([["paid", false], ["due", true]]);
    const generated = summary.payments.map((payment, index) => ({ ...payment, label: `Phase ${index + 1} - ${index ? "Design Document Delivery" : "Project Start"}` }));
    expect(planInvoicePdfPayments(pages, { ...summary, payments: generated })?.phases[1].current).toBe(true);
  });
  it("does not guess when a phase was renamed, duplicated, added or the layout rotated", () => {
    const renamed = payments.map((payment, index) => index ? { ...payment, label: "Due at Something Else" } : payment);
    expect(() => planInvoicePdfPayments(pages, { ...summary, payments: renamed })).toThrow("Could not safely update");
    expect(() => planInvoicePdfPayments(pages, { ...summary, payments: [...payments, payments[1]] })).toThrow();
    expect(() => planInvoicePdfPayments(pages, { ...summary, payments: [...payments, { label: "Phase 3 - Completion", amount: 100, status: "not_due" }] })).toThrow();
    expect(() => planInvoicePdfPayments([{ ...pages[0], rotation: 90 }], summary)).toThrow();
  });
  it("leaves procurement/non-service PDFs out of the payment overlay", () => {
    const other = [{ ...pages[0], items: pages[0].items.filter(item => item.text !== "SERVICE INVOICE") }];
    expect(planInvoicePdfPayments(other, summary)).toBeNull();
  });
  it("uses only the latest marked-due row, not an older due row with a link", () => {
    const rows = payments.map((payment, index) => ({ ...payment, status: "due", notes: index ? undefined : "https://buy.stripe.com/test_old" }));
    expect(planInvoicePdfPayments(pages, { ...summary, payments: rows })?.phases.map(row => row.current)).toEqual([false, true]);
  });
  it("updates a derived PDF and replaces the stale Stripe annotation without changing the source", async () => {
    const source = await sourcePdf();
    const original = source.slice();
    const updated = await updateServiceInvoicePdf(source, summary);
    expect(updated).not.toBeNull();
    expect(source).toEqual(original);
    const result = await PDFDocument.load(updated!);
    expect(result.getPageCount()).toBe(1);
    expect(result.getPages()[0].getSize()).toEqual({ width: 612, height: 792 });
    expect(links(result)).toEqual(["mailto:studio@example.test", "https://buy.stripe.com/test_current"]);
  });
  it("removes the old pay link when all phases are paid or the latest due phase has no link", async () => {
    const source = await sourcePdf();
    for (const rows of [payments.map(payment => ({ ...payment, status: "paid" })), payments.map(payment => ({ ...payment, notes: undefined }))]) {
      const updated = await updateServiceInvoicePdf(source, { ...summary, payments: rows });
      expect(links(await PDFDocument.load(updated!))).toEqual(["mailto:studio@example.test"]);
    }
  });
  it("uses the same updater for open/download and does not silently return a stale PDF on failure", async () => {
    const source = await sourcePdf();
    const buffer = new Uint8Array(source.length); buffer.set(source);
    const blob = new Blob([buffer.buffer], { type: "application/pdf" });
    const result = await sanitizeInvoicePdfBlob(blob, { servicePayments: summary });
    expect(links(await PDFDocument.load(await result.arrayBuffer()))).toContain("https://buy.stripe.com/test_current");
    await expect(sanitizeInvoicePdfBlob(blob, { servicePayments: { ...summary, payments: [] } })).rejects.toThrow("Could not safely update");
  });
  it("embeds intact fixed-weight outlines, including the R in HERE and y in Delivery", async () => {
    const fetched: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = String(input);
      fetched.push(path);
      const bytes = fontAsset(path.replace("/invoice-assets/", ""));
      return new Response(bytes.buffer as ArrayBuffer, { status: 200 });
    });
    try {
      const source = await sourcePdf(true);
      const result = await PDFDocument.load((await updateServiceInvoicePdf(source, summary, { pages }))!);
      const resources = result.getPages()[0].node.Resources()!.lookup(PDFName.of("Font")) as any;
      const checked = new Set<string>();
      const letters = new Set<string>();
      for (const reference of resources.values()) {
        const dictionary = result.context.lookup(reference) as any;
        const name = String(dictionary.get(PDFName.of("BaseFont")));
        if (!name.includes("MeravInvoiceSerif") || checked.has(name)) continue;
        checked.add(name);
        const style = name.includes("Bold") ? "Bold" : "Regular";
        const original = fontkit.create(fontAsset(`v2/MeravInvoiceSerif-${style}.ttf`)) as any;
        const descriptor = dictionary.lookup(PDFName.of("DescendantFonts")).lookup(0).lookup(PDFName.of("FontDescriptor"));
        const embedded = fontkit.create(decodePDFRawStream(descriptor.lookup(PDFName.of("FontFile2"))).decode()) as any;
        const cmap = Buffer.from(decodePDFRawStream(dictionary.lookup(PDFName.of("ToUnicode"))).decode()).toString();
        for (const match of cmap.matchAll(/^<([0-9a-f]+)> <([0-9a-f]{4})>$/gim)) {
          const codePoint = parseInt(match[2], 16);
          if (codePoint < 32 || codePoint > 126) continue;
          const actual = embedded.getGlyph(parseInt(match[1], 16));
          const expected = original.glyphForCodePoint(codePoint);
          letters.add(String.fromCodePoint(codePoint));
          expect(actual.path.commands, `${style} ${String.fromCodePoint(codePoint)} outline`).toEqual(expected.path.commands);
        }
      }
      expect(checked.size).toBe(2);
      expect(letters.has("R")).toBe(true);
      expect(letters.has("y")).toBe(true);
      expect(fetched).toEqual([
        "/invoice-assets/v2/MeravInvoiceSerif-Regular.ttf",
        "/invoice-assets/v2/MeravInvoiceSerif-Bold.ttf",
      ]);
      expect(links(result)).toContain("https://buy.stripe.com/test_current");
    } finally { fetchMock.mockRestore(); }
  });
  it("reports a missing PDF font rather than generating a broken payment copy", async () => {
    const source = await sourcePdf(true);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    try {
      await expect(updateServiceInvoicePdf(source, summary, { pages })).rejects.toThrow("Could not load the invoice font");
    } finally { fetchMock.mockRestore(); }
  });
});
