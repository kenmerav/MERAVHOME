import { PDFDocument, PDFSignature, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { activeInvoiceAdjustments, adjustedInvoiceTotal, invoiceAdjustmentAmount } from "@/lib/invoiceAdjustments";
import { paymentFonts } from "@/lib/serviceInvoicePdf";
import { formatMoney } from "@/lib/money";
import type { ServiceInvoicePaymentSummary } from "@/lib/serviceInvoicePayments";

// Add a fresh itemized page to the viewing/download copy. The uploaded source,
// existing scopes, payment links and payment history remain recoverable.
export async function appendInvoiceAdjustmentsPdf(
  bytes: Uint8Array,
  summary: ServiceInvoicePaymentSummary,
  context: { title?: string | null; clientName?: string | null } = {},
) {
  const rows = activeInvoiceAdjustments(summary.adjustments);
  if (!rows.length) return bytes;
  const document = await PDFDocument.load(bytes);
  if (document.getForm().getFields().some(field => field instanceof PDFSignature)) {
    throw new Error("This invoice is signed. Keep the signed original and request an updated invoice copy.");
  }
  const fonts = await paymentFonts(document);
  const paper = rgb(230 / 255, 228 / 255, 218 / 255);
  const ink = rgb(.13, .12, .12);
  const addedPages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const text = (value: string, x: number, baseline: number, size = 10, font = fonts.regular) =>
    page.drawText(safeText(value, font), { x, y: baseline, size, font, color: ink });
  const right = (value: string, baseline: number, bold = false) => {
    const font = bold ? fonts.bold : fonts.regular;
    const safe = safeText(value, font);
    text(safe, 542 - font.widthOfTextAtSize(safe, 11), baseline, 11, font);
  };
  const newPage = () => {
    page = document.addPage([612, 792]);
    addedPages.push(page);
    page.drawRectangle({ x: 50, y: 55, width: 512, height: 680, borderWidth: .4, borderColor: rgb(.65, .65, .65) });
    text("MERAV INTERIORS", 70, 690, 27);
    text("BY KATIE ROBERTS", 72, 668, 9);
    text("INVOICE ITEMS & CREDITS", 70, 623, 15, fonts.bold);
    const details = [context.title?.replace(/\.(pdf|html?)$/i, ""), context.clientName].filter(Boolean).join(" | ");
    const detailLines = wrapText(details, fonts.regular, 9, 472);
    let baseline = 603;
    for (const line of detailLines.slice(0, 3)) { text(line, 70, baseline, 9); baseline -= 12; }
    page.drawRectangle({ x: 70, y: baseline - 36, width: 472, height: 26, color: paper });
    text("ITEM", 79, baseline - 27, 9, fonts.bold);
    text("AMOUNT", 493, baseline - 27, 9, fonts.bold);
    y = baseline - 57;
  };
  newPage();
  for (const row of rows) {
    const lines = [
      ...wrapText(row.label, fonts.regular, 11, 345),
      ...wrapText(`${row.adjustment_type === "credit" ? "Credit" : "Additional charge"} - ${row.status}`, fonts.regular, 9, 345),
      ...(row.notes ? wrapText(row.notes, fonts.regular, 9, 345) : []),
    ];
    const height = lines.length * 14 + 16;
    if (y - Math.min(height, 400) < 165) newPage();
    right(invoiceAdjustmentAmount(row), y, true);
    for (let i = 0; i < lines.length; i++) {
      if (y < 165) newPage();
      text(lines[i], 79, y, i === 0 ? 11 : 9);
      y -= 14;
    }
    y -= 10;
    page.drawLine({ start: { x: 70, y }, end: { x: 542, y }, thickness: .4, color: rgb(.8, .8, .8) });
    y -= 20;
  }
  if (y < 240) newPage();
  const paid = summary.paidAmount ?? summary.payments.reduce((sum, row) => sum + (row.status === "paid" ? Number(row.amount) : 0), 0);
  const total = adjustedInvoiceTotal(summary.totalAmount, rows);
  const balance = summary.balanceDue ?? Math.max(total - paid, 0);
  const totals = [
    ["Original invoice total", summary.totalAmount],
    ["Revised invoice total", total],
    ["Payments received", paid],
    ["Remaining balance", balance],
  ] as const;
  for (const [label, amount] of totals) {
    const bold = label === "Revised invoice total" || label === "Remaining balance";
    text(label, 79, y, 11, bold ? fonts.bold : fonts.regular);
    right(formatMoney(amount), y, bold);
    y -= 24;
  }
  text("This itemized update accompanies the original invoice.", 79, y - 6, 9);
  for (let index = 0; index < addedPages.length; index++) {
    addedPages[index].drawText(`Invoice items - ${index + 1} of ${addedPages.length}`, {
      x: 70, y: 73, size: 8, font: fonts.regular, color: ink,
    });
  }
  return document.save();
}

function safeText(value: string, font: PDFFont) {
  return Array.from(String(value).replace(/[\r\n\t]/g, " ")).map(char => {
    try { font.encodeText(char); return char; } catch { return "?"; }
  }).join("");
}

function wrapText(value: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const char of safeText(value, font)) {
    if (font.widthOfTextAtSize(line + char, size) > width && line) {
      const space = line.lastIndexOf(" ");
      if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1); }
      else { lines.push(line); line = ""; }
    }
    line += char;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.length ? lines : [""];
}
