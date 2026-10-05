import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { activeInvoiceAdjustments, adjustedInvoiceTotal, refreshInvoiceAdjustmentsHtml } from "../src/lib/invoiceAdjustments";
import { appendInvoiceAdjustmentsPdf } from "../src/lib/invoiceAdjustmentsPdf";
import { prepareInvoiceHtml, sanitizeInvoicePdfBlob } from "../src/lib/invoiceDocuments";

const extra = { adjustment_type: "charge" as const, label: "Material Ordering", amount: 2500, status: "open" };
const summary = { totalAmount: 18000, paidAmount: 9000, balanceDue: 11500,
  payments: [{ label: "Phase 1 - Project Start", amount: 9000, status: "paid" },
    { label: "Phase 2 - Design Document Delivery", amount: 9000, status: "due" }], adjustments: [extra] };
const html = '<html><body><main class="page"><h1>SERVICE INVOICE</h1><p>Original scope</p><section class="summary"><div class="fee-row">Total Design Fee: $18,000.00</div><div class="sig">Authorized by Client</div></section></main></body></html>';
async function source() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  doc.addPage().drawText("Original procurement invoice and scope", { x: 50, y: 700, font });
  return doc.save();
}
async function pdfText(bytes: Uint8Array, last = true) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(last ? pdf.numPages : 1);
    return (await page.getTextContent()).items.map(item => "str" in item ? item.str : "").join(" ");
  } finally { await pdf.destroy(); }
}

describe("existing invoice items and credits", () => {
  it("includes the saved $2,500 charge, revised $20,500 total and $11,500 balance in HTML", () => {
    const result = prepareInvoiceHtml(html, { servicePayments: summary });
    expect(result).toContain("Material Ordering");
    expect(result).toContain("$2,500.00");
    expect(result).toContain("$20,500.00");
    expect(result).toContain("$11,500.00");
    expect(result).toContain("Original scope");
    expect(result).toContain("Authorized by Client");
  });
  it("refreshes rather than duplicates additions and removes waived/voided entries", () => {
    const first = refreshInvoiceAdjustmentsHtml(html, [extra], 18000);
    const second = refreshInvoiceAdjustmentsHtml(first, [extra], 18000);
    expect(second.match(/Material Ordering/g)).toHaveLength(1);
    expect(refreshInvoiceAdjustmentsHtml(second, [{ ...extra, status: "waived" }], 18000)).not.toContain("Material Ordering");
    expect(activeInvoiceAdjustments([{ ...extra, status: "void" }])).toEqual([]);
  });
  it("keeps paid charges and credits while excluding waived charges", () => {
    expect(adjustedInvoiceTotal(18000, [
      { ...extra, status: "paid" }, { ...extra, status: "waived" },
      { ...extra, adjustment_type: "credit", amount: 500, status: "refunded" },
    ])).toBe(20000);
  });
  it("escapes client-facing labels and notes", () => {
    const result = refreshInvoiceAdjustmentsHtml(html, [{ ...extra, label: '<script>alert("bad")</script>', notes: '<img onerror="bad">' }], 18000);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("<img onerror");
    expect(result).toContain("&lt;script&gt;");
  });
  it("adds itemized details to non-service HTML too", () => {
    const result = prepareInvoiceHtml("<html><body>Product Invoice</body></html>", { servicePayments: summary });
    expect(result).toContain("Product Invoice");
    expect(result).toContain("Material Ordering");
  });
  it("adds a readable PDF page, preserves the original, and does not double count on repeat opens", async () => {
    const original = await source();
    const before = original.slice();
    for (let run = 0; run < 2; run++) {
      const updated = await appendInvoiceAdjustmentsPdf(original, summary, { title: "Angel Spirit Invoice.pdf" });
      expect((await PDFDocument.load(updated)).getPageCount()).toBe(2);
      const text = await pdfText(updated);
      expect(text).toContain("Material Ordering");
      expect(text).toContain("+$2,500.00");
      expect(text).toContain("$20,500.00");
      expect(text).toContain("$11,500.00");
      expect(await pdfText(updated, false)).toContain("Original procurement invoice and scope");
    }
    expect(original).toEqual(before);
  });
  it("does not add an empty PDF page after an extra is waived", async () => {
    const original = await source();
    expect(await appendInvoiceAdjustmentsPdf(original, { ...summary, adjustments: [{ ...extra, status: "waived" }] })).toEqual(original);
  });
  it("paginates long item lists and notes without dropping their totals", async () => {
    const original = await source();
    const adjustments = Array.from({ length: 32 }, (_, i) => ({ ...extra, label: `Added item ${i + 1}`, notes: "Full specification details ".repeat(12) }));
    const result = await appendInvoiceAdjustmentsPdf(original, { ...summary, adjustments, balanceDue: 89000 });
    expect((await PDFDocument.load(result)).getPageCount()).toBeGreaterThan(2);
    const text = await pdfText(result);
    expect(text).toContain("$98,000.00");
    expect(text).toContain("$89,000.00");
  });
});
