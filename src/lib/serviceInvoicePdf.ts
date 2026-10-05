import { PDFDocument, PDFName, PDFSignature, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatMoney } from "@/lib/money";
import { currentDueInvoicePayment, invoicePaymentStripeUrl, type ServiceInvoicePaymentSummary } from "@/lib/serviceInvoicePayments";

export type InvoicePdfText = { text: string; x: number; y: number; width: number; size: number };
export type InvoicePdfPage = { index: number; rotation: number; items: InvoicePdfText[] };
type Row = { page: number; label: InvoicePdfText; amounts: InvoicePdfText[] };
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
  const originalPhases = findRows(pages, text => /^Due\s+(?:on|at)\s+/i.test(text));
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
  if (!names.some(name => /PlayfairDisplay/i.test(name))) {
    const sans = names.some(name => /Helvetica|Arial/i.test(name));
    return {
      regular: await document.embedFont(sans ? StandardFonts.Helvetica : StandardFonts.TimesRoman),
      bold: await document.embedFont(sans ? StandardFonts.HelveticaBold : StandardFonts.TimesRomanBold),
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
  return { regular: await embed("Regular"), bold: await embed("Bold") };
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
  const plan = planInvoicePdfPayments(testing.pages ?? await readPdfText(bytes), summary);
  if (!plan) return null;
  const document = await PDFDocument.load(bytes);
  if (document.getForm().getFields().some(field => field instanceof PDFSignature)) {
    throw new Error("This invoice is signed. Keep the signed original and ask the team for an updated payment copy.");
  }
  const fonts = await paymentFonts(document, testing.fontBytes);
  removeStripeAnnotations(document);
  const paid = summary.paidAmount ?? summary.payments.reduce((sum, payment) => sum + (payment.status === "paid" ? Number(payment.amount) : 0), 0);
  const waived = summary.payments.reduce((sum, payment) => sum + (payment.status === "waived" ? Number(payment.amount) : 0), 0);
  const balance = summary.balanceDue ?? Math.max(summary.totalAmount - paid - waived, 0);
  const fallback = plan.balance;
  const updateRow = (row: Row, amount: number, bold: boolean, strike = false, underline = false) => {
    const page = document.getPages()[row.page];
    const box = amountBox(row, fallback);
    // Clear just the existing payment text; retain the table, logo, scopes,
    // border, signature lines, and every page in its original position.
    const labelRight = row.label.x + row.label.width;
    const font = bold ? fonts.bold : fonts.regular;
    const labelWidth = font.widthOfTextAtSize(row.label.text, row.label.size);
    const left = Math.min(row.label.x, labelRight - labelWidth) - 1;
    const bottom = Math.min(row.label.y - row.label.size * .28, box.y - box.size * .28);
    const top = Math.max(row.label.y + row.label.size * 1.09, box.y + box.size * 1.09);
    page.drawRectangle({ x: left, y: bottom, width: box.right + 1 - left, height: top - bottom, color: rgb(1, 1, 1) });
    const label = drawRight(page, row.label.text, labelRight, row.label.y, row.label.size, font);
    const value = drawRight(page, formatMoney(amount), box.right, box.y, box.size, bold ? fonts.bold : fonts.regular, box.right - labelRight - 3);
    if (strike || underline) for (const text of [label, value]) page.drawLine({
      start: { x: text.x, y: text.y + text.size * (strike ? .32 : -.12) },
      end: { x: text.right, y: text.y + text.size * (strike ? .32 : -.12) }, thickness: .45, color: rgb(0, 0, 0),
    });
  };
  updateRow(plan.paid, paid, false);
  updateRow(plan.balance, Math.max(balance, 0), true, false, true);
  for (const row of plan.phases) updateRow(row, Number(row.payment.amount), row.current,
    row.payment.status === "paid" || row.payment.status === "waived");

  const payPage = document.getPages()[plan.pay.page];
  const box = amountBox(plan.pay, fallback);
  const labelRight = plan.pay.label.x + plan.pay.label.width;
  const link = invoicePaymentStripeUrl(plan.current);
  const label = plan.current ? (link ? "CLICK HERE TO PAY" : "AMOUNT DUE NOW") : "NO PAYMENT DUE";
  const left = Math.min(plan.pay.label.x, ...plan.phases.filter(row => row.page === plan.pay.page).map(row => row.label.x)) - 8;
  // The MERAV invoice payment cell uses the same warm paper fill as its tables.
  const fill = rgb(230 / 255, 228 / 255, 218 / 255);
  payPage.drawRectangle({ x: left, y: box.y - box.size * .11, width: labelRight + 1 - left,
    height: box.size * 1.16, color: fill });
  payPage.drawRectangle({ x: box.left - .5, y: box.y - box.size * .11, width: box.right + .5 - box.left,
    height: box.size * 1.16, color: fill });
  const labelSize = Math.min(plan.pay.label.size, (labelRight - left - 1) / fonts.regular.widthOfTextAtSize(label, 1));
  const labelX = labelRight - fonts.regular.widthOfTextAtSize(label, labelSize);
  payPage.drawText(label, { x: labelX, y: plan.pay.label.y, size: labelSize, font: fonts.regular, color: link ? rgb(0, 0, 1) : rgb(0, 0, 0) });
  drawRight(payPage, formatMoney(plan.current ? Number(plan.current.amount) : 0), box.right, box.y, box.size, fonts.bold, box.right - box.left);
  if (link) {
    payPage.drawLine({ start: { x: labelX, y: plan.pay.label.y - .8 }, end: { x: labelRight, y: plan.pay.label.y - .8 }, thickness: .4, color: rgb(0, 0, 1) });
    const annotation = document.context.obj({ Type: "Annot", Subtype: "Link", Rect: [labelX, plan.pay.label.y - 1, labelRight, plan.pay.label.y + labelSize * 1.1],
      Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(link) } });
    payPage.node.addAnnot(document.context.register(annotation));
  }
  return document.save();
}
