import { PDFDocument, PDFName, PDFSignature, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatMoney } from "@/lib/money";
import { currentDueInvoicePayment, invoiceDueNow, type ServiceInvoicePaymentSummary } from "@/lib/serviceInvoicePayments";
import { activeInvoiceAdjustments, adjustedInvoiceTotal } from "@/lib/invoiceAdjustments";
import { currentInvoiceDate } from "@/lib/invoiceDate";

export type InvoicePdfText = { text: string; x: number; y: number; width: number; size: number };
export type InvoicePdfPage = { index: number; rotation: number; items: InvoicePdfText[] };
type Row = { page: number; label: InvoicePdfText; amounts: InvoicePdfText[]; labelLines?: InvoicePdfText[] };
type PhaseRow = Row & { payment: ServiceInvoicePaymentSummary["payments"][number]; current: boolean };

const refreshError = "Could not safely update this invoice's payment section. The original is preserved; please ask the team to review its PDF layout.";

function normalizeLabel(label: string) {
  return label.replace(/^Phase\s+\d+\s*-\s*/i, "").replace(/^Due\s+(?:on|at)\s+/i, "")
    .replace(/[:\s]+$/g, "").replace(/\s+/g, " ").toLowerCase();
}

function findRows(pages: InvoicePdfPage[], matches: (text: string) => boolean): Row[] {
  return pages.flatMap(page => page.items.filter(item => matches(item.text)).map(label => ({
    page: page.index, label,
    amounts: page.items.filter(item => item.x >= label.x + label.width - 1
      && Math.abs(item.y - label.y) < Math.max(2.5, label.size * .35)
      && /^[\d$.,\s-]+$/.test(item.text)),
  })));
}

function findPhaseRows(pages: InvoicePdfPage[]): Row[] {
  return findRows(pages, text => /^Due\s+(?:on|at)\s+/i.test(text)).map(row => {
    const lines = [row.label];
    const items = pages.find(page => page.index === row.page)!.items;
    const right = row.label.x + row.label.width;
    while (!/:\s*$/.test(lines.at(-1)!.text) && lines.length < 4) {
      const previous = lines.at(-1)!;
      const candidates = items.filter(item => item.y < previous.y - previous.size * .5
        && item.y >= previous.y - previous.size * 1.65
        && Math.abs(item.x + item.width - right) < 2
        && Math.abs(item.size - previous.size) < .5
        && !/^[\d$.,\s-]+$/.test(item.text)
        && !/^(Due\s|Paid\s*:|Design Fee Due|CLICK HERE TO PAY|Amount due now|No payment due)/i.test(item.text));
      if (!candidates.length) break;
      if (candidates.length !== 1) throw new Error(refreshError);
      lines.push(candidates[0]);
    }
    if (lines.length === 1) return row;
    const amounts = items.filter(item => item.x >= right - 1
      && lines.some(line => Math.abs(item.y - line.y) < Math.max(2.5, line.size * .35))
      && /^[\d$.,\s-]+$/.test(item.text));
    return { ...row, label: { ...row.label, text: lines.map(line => line.text).join(" ") }, labelLines: lines, amounts };
  });
}

// Locate text, never a guessed fixed rectangle. Ambiguous or changed layouts
// fail visibly instead of quietly producing a stale or partially updated bill.
export function planInvoicePdfPayments(pages: InvoicePdfPage[], summary: ServiceInvoicePaymentSummary) {
  if (!pages.some(page => page.items.some(item => /SERVICE\s+INVOICE/i.test(item.text)))) return null;
  const unique = (matches: (text: string) => boolean) => {
    const rows = findRows(pages, matches);
    if (rows.length !== 1) throw new Error(refreshError);
    return rows[0];
  };
  const paid = unique(text => /^Paid\s*:\s*$/i.test(text));
  const balance = unique(text => /^Design Fee Due\s*:\s*$/i.test(text));
  const pay = unique(text => /^(?:CLICK HERE TO PAY|Amount due now|No payment due)$/i.test(text));
  const originalPhases = findPhaseRows(pages);
  const current = currentDueInvoicePayment(summary.payments);
  const phases: PhaseRow[] = originalPhases.map(row => {
    const payments = summary.payments.filter(payment => normalizeLabel(payment.label) === normalizeLabel(row.label.text));
    if (payments.length !== 1 || !row.amounts.length) throw new Error(refreshError);
    return { ...row, payment: payments[0], current: payments[0] === current };
  });
  if (!phases.length || !balance.amounts.length || !pay.amounts.length
    || (current && !phases.some(row => row.current))
    || summary.payments.some(payment => /^(?:Phase\s+\d+\s*-|Due\s+(?:on|at)\s+)/i.test(payment.label)
      && !phases.some(row => row.payment === payment))
    || pages.some(page => page.rotation !== 0)) throw new Error(refreshError);
  if (new Set(phases.map(row => normalizeLabel(row.label.text))).size !== phases.length) throw new Error(refreshError);
  return { paid, balance, pay, phases, current };
}

async function readPdfText(bytes: Uint8Array): Promise<InvoicePdfPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const document = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  try {
    const pages: InvoicePdfPage[] = [];
    for (let index = 0; index < document.numPages; index++) {
      const page = await document.getPage(index + 1);
      const content = await page.getTextContent();
      pages.push({ index, rotation: page.rotate, items: content.items.flatMap(item => {
        if (!("str" in item) || !item.str.trim()) return [];
        if (Math.abs(item.transform[1]) > .01 || Math.abs(item.transform[2]) > .01) throw new Error(refreshError);
        return [{ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width, size: Math.abs(item.transform[3]) }];
      }) });
    }
    return pages;
  } finally { await document.destroy(); }
}

function amountBox(row: Row, fallback: Row) {
  const items = row.amounts.length ? row.amounts : fallback.amounts;
  return {
    right: Math.max(...items.map(item => item.x + item.width)),
    left: Math.min(...items.map(item => item.x)),
    y: row.amounts.length ? Math.min(...items.map(item => item.y)) : row.label.y + Math.min(...items.map(item => item.y)) - fallback.label.y,
    size: Math.max(...items.map(item => item.size)),
  };
}

function removeStripeAnnotations(document: PDFDocument) {
  for (const page of document.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    const kept = [];
    for (let index = 0; index < annotations.size(); index++) {
      const reference = annotations.get(index);
      const annotation = document.context.lookup(reference) as any;
      const action = annotation?.lookup?.(PDFName.of("A"));
      const uri = action?.lookup?.(PDFName.of("URI"));
      const url = typeof uri?.decodeText === "function" ? uri.decodeText() : uri?.asString?.() || "";
      if (!/^https:\/\/(?:buy|checkout)\.stripe\.com\//i.test(url)) kept.push(reference);
    }
    page.node.set(PDFName.of("Annots"), document.context.obj(kept));
  }
}

type PaymentFontBytes = { regular: Uint8Array; bold: Uint8Array };

export async function paymentFonts(document: PDFDocument, suppliedBytes?: PaymentFontBytes) {
  const names = document.getPages().flatMap(page => {
    const fonts = page.node.Resources()?.lookup(PDFName.of("Font")) as any;
    return fonts?.values?.().map((reference: any) => {
      const font = document.context.lookup(reference) as any;
      return String(font?.get?.(PDFName.of("BaseFont")) ?? "");
    }) ?? [];
  });
  if (!names.some(name => /PlayfairDisplay|MeravInvoiceSerif/i.test(name))) {
    const sans = !names.some(name => /Times|Georgia|Palatino|Baskerville/i.test(name))
      && names.some(name => /Helvetica|Arial/i.test(name));
    return {
      regular: await document.embedFont(sans ? StandardFonts.Helvetica : StandardFonts.TimesRoman),
      bold: await document.embedFont(sans ? StandardFonts.HelveticaBold : StandardFonts.TimesRomanBold),
      paperFill: rgb(1, 1, 1),
    };
  }
  // Fontkit's variable-font subset conversion corrupts some outlines (e.g. R
  // and y). Embed pre-instantiated fixed weights, not getVariation() subsets.
  document.registerFontkit(fontkit);
  const embed = async (style: "Regular" | "Bold") => {
    const supplied = suppliedBytes?.[style === "Regular" ? "regular" : "bold"];
    const response = supplied ? null : await fetch(`/invoice-assets/v2/MeravInvoiceSerif-${style}.ttf`);
    if (response && !response.ok) throw new Error("Could not load the invoice font. Please try again.");
    const bytes = supplied ?? new Uint8Array(await response!.arrayBuffer());
    return document.embedFont(bytes.slice(), { subset: true });
  };
  return { regular: await embed("Regular"), bold: await embed("Bold"), paperFill: rgb(230 / 255, 228 / 255, 218 / 255) };
}

function drawRight(page: PDFPage, text: string, right: number, y: number, size: number, font: PDFFont, width?: number) {
  const fitted = width ? Math.min(size, size * width / Math.max(font.widthOfTextAtSize(text, size), 1)) : size;
  const x = right - font.widthOfTextAtSize(text, fitted);
  page.drawText(text, { x, y, size: fitted, font, color: rgb(0, 0, 0) });
  return { x, y, right, size: fitted };
}

// Derive a fresh viewing/download copy each time. Never save these overlays back
// onto the uploaded source, so status reversals cannot leave old strikes behind.
export async function updateServiceInvoicePdf(
  bytes: Uint8Array, summary: ServiceInvoicePaymentSummary,
  testing: { pages?: InvoicePdfPage[]; fontBytes?: PaymentFontBytes } = {},
): Promise<Uint8Array | null> {
  const sourcePages = testing.pages ?? await readPdfText(bytes);
  const plan = planInvoicePdfPayments(sourcePages, summary);
  if (!plan) return null;
  const document = await PDFDocument.load(bytes);
  if (document.getForm().getFields().some(field => field instanceof PDFSignature)) {
    throw new Error("This invoice is signed. Keep the signed original and ask the team for an updated payment copy.");
  }
  const fonts = await paymentFonts(document, testing.fontBytes);
  removeStripeAnnotations(document);
  const dateRows = findRows(sourcePages, text => /^Date\s*:\s*$/i.test(text));
  if (dateRows.length === 1) {
    const row = dateRows[0];
    const dates = sourcePages.find(page => page.index === row.page)!.items.filter(item =>
      item.x >= row.label.x + row.label.width
      && Math.abs(item.y - row.label.y) < Math.max(2.5, row.label.size * .35)
      && /^(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})$/.test(item.text));
    if (dates.length === 1) {
      const date = dates[0];
      const text = currentInvoiceDate();
      const page = document.getPages()[row.page];
      page.drawRectangle({ x: date.x - 1, y: date.y - date.size * .28,
        width: Math.max(date.width, fonts.regular.widthOfTextAtSize(text, date.size)) + 2,
        height: date.size * 1.4, color: rgb(1, 1, 1) });
      page.drawText(text, { x: date.x, y: date.y, size: date.size, font: fonts.regular });
    }
  }
  const paid = summary.paidAmount ?? summary.payments.reduce((sum, payment) => sum + (payment.status === "paid" ? Number(payment.amount) : 0), 0);
  const waived = summary.payments.reduce((sum, payment) => sum + (payment.status === "waived" ? Number(payment.amount) : 0), 0);
  const balance = summary.balanceDue ?? Math.max(adjustedInvoiceTotal(summary.totalAmount, summary.adjustments) - paid - waived, 0);
  const fallback = plan.balance;
  const updateRow = (row: Row, amount: number, bold: boolean, strike = false, underline = false) => {
    const page = document.getPages()[row.page];
    const box = amountBox(row, fallback);
    // Clear just the existing payment text; retain the table, logo, scopes,
    // border, signature lines, and every page in its original position.
    const lines = row.labelLines ?? [row.label];
    const labelRight = Math.max(...lines.map(line => line.x + line.width));
    const font = bold ? fonts.bold : fonts.regular;
    const left = Math.min(...lines.flatMap(line => [line.x, labelRight - font.widthOfTextAtSize(line.text, line.size)])) - 1;
    const bottom = Math.min(...lines.map(line => line.y - line.size * .28), box.y - box.size * .28);
    const top = Math.max(...lines.map(line => line.y + line.size * 1.09), box.y + box.size * 1.09);
    page.drawRectangle({ x: left, y: bottom, width: box.right + 1 - left, height: top - bottom, color: rgb(1, 1, 1) });
    const labels = lines.map(line => drawRight(page, line.text, labelRight, line.y, line.size, font));
    const value = drawRight(page, formatMoney(amount), box.right, box.y, box.size, bold ? fonts.bold : fonts.regular, box.right - labelRight - 3);
    if (strike || underline) for (const text of [...labels, value]) page.drawLine({
      start: { x: text.x, y: text.y + text.size * (strike ? .32 : -.12) },
      end: { x: text.right, y: text.y + text.size * (strike ? .32 : -.12) }, thickness: .45, color: rgb(0, 0, 0),
    });
  };
  updateRow(plan.paid, paid, false);
  updateRow(plan.balance, Math.max(balance, 0), true, false, true);
  for (const row of plan.phases) updateRow(row, Number(row.payment.amount), row.current,
    row.payment.status === "paid" || row.payment.status === "waived");

  const additions = activeInvoiceAdjustments(summary.adjustments);
  if (additions.length) {
    const phases = plan.phases.filter(row => row.page === plan.pay.page);
    if (!phases.length) throw new Error(refreshError);
    const lastY = Math.min(...phases.flatMap(row => (row.labelLines ?? [row.label]).map(line => line.y)));
    const reference = phases.find(row => row.current) ?? phases[phases.length - 1];
    const labelSize = reference.label.size;
    const amountSize = amountBox(reference, fallback).size;
    const font = reference.current ? fonts.bold : fonts.regular;
    const step = Math.max(12, Math.max(labelSize, amountSize) * 1.45);
    const firstY = lastY - step;
    const lastItemY = firstY - (additions.length - 1) * step;
    const shift = Math.max(0, plan.pay.label.y - (lastItemY - step * 1.7));
    const payPage = document.getPages()[plan.pay.page];
    const originalBox = amountBox(plan.pay, fallback);
    const labelRight = phases[phases.length - 1].label.x + phases[phases.length - 1].label.width;
    const left = Math.min(...phases.map(row => row.label.x), plan.pay.label.x) - 20;
    const right = originalBox.right + 4;
    const top = lastY - phases[phases.length - 1].label.size * .35 - 2;
    const lowerText = sourcePages[plan.pay.page].items.filter(item => item.x >= left && item.x < right && item.y < top);
    const bottom = Math.min(...lowerText.map(item => item.y - item.size * .3)) - 12;
    if (bottom - shift < 65 || shift > 80) throw new Error(refreshError);
    if (shift > 0) {
      const source = await PDFDocument.load(bytes);
      const region = await document.embedPage(source.getPages()[plan.pay.page], { left, right, top, bottom });
      payPage.drawRectangle({ x: left, y: bottom - shift, width: right - left,
        height: top - bottom + shift, color: rgb(1, 1, 1) });
      payPage.drawPage(region, { x: left, y: bottom - shift, width: right - left, height: top - bottom });
      plan.pay.label = { ...plan.pay.label, y: plan.pay.label.y - shift };
      plan.pay.amounts = plan.pay.amounts.map(item => ({ ...item, y: item.y - shift }));
    }
    additions.forEach((row, index) => {
      const y = firstY - index * step;
      const label = drawRight(payPage, row.label, labelRight, y, labelSize, font, labelRight - left - 4);
      const amount = `${row.adjustment_type === "credit" ? "-" : ""}${formatMoney(Number(row.amount))}`;
      const value = drawRight(payPage, amount, originalBox.right, y, amountSize, font, originalBox.right - labelRight - 4);
      if (row.status !== "open") for (const text of [label, value]) payPage.drawLine({
        start: { x: text.x, y: y + text.size * .32 }, end: { x: text.right, y: y + text.size * .32 }, thickness: .45,
      });
    });
  }

  const payPage = document.getPages()[plan.pay.page];
  const box = amountBox(plan.pay, fallback);
  const labelRight = plan.pay.label.x + plan.pay.label.width;
  const { amount: dueNow, link } = invoiceDueNow(summary);
  const label = dueNow > 0 ? (link ? "CLICK HERE TO PAY" : "AMOUNT DUE NOW") : "NO PAYMENT DUE";
  const left = Math.min(plan.pay.label.x, ...plan.phases.filter(row => row.page === plan.pay.page).map(row => row.label.x)) - 8;
  // The MERAV invoice payment cell uses the same warm paper fill as its tables.
  const fill = fonts.paperFill;
  payPage.drawRectangle({ x: left, y: box.y - box.size * .11, width: labelRight + 1 - left,
    height: box.size * 1.16, color: fill });
  payPage.drawRectangle({ x: box.left - .5, y: box.y - box.size * .11, width: box.right + .5 - box.left,
    height: box.size * 1.16, color: fill });
  const labelSize = Math.min(plan.pay.label.size, (labelRight - left - 1) / fonts.regular.widthOfTextAtSize(label, 1));
  const labelX = labelRight - fonts.regular.widthOfTextAtSize(label, labelSize);
  payPage.drawText(label, { x: labelX, y: plan.pay.label.y, size: labelSize, font: fonts.regular, color: link ? rgb(0, 0, 1) : rgb(0, 0, 0) });
  drawRight(payPage, formatMoney(dueNow), box.right, box.y, box.size, fonts.bold, box.right - box.left);
  if (link) {
    payPage.drawLine({ start: { x: labelX, y: plan.pay.label.y - .8 }, end: { x: labelRight, y: plan.pay.label.y - .8 }, thickness: .4, color: rgb(0, 0, 1) });
    const annotation = document.context.obj({ Type: "Annot", Subtype: "Link", Rect: [labelX, plan.pay.label.y - 1, labelRight, plan.pay.label.y + labelSize * 1.1],
      Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(link) } });
    payPage.node.addAnnot(document.context.register(annotation));
  }
  return document.save();
}
