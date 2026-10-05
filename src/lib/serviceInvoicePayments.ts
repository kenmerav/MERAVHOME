import { formatMoney } from "@/lib/money";
import { activeInvoiceAdjustments, adjustedInvoiceTotal, type InvoiceDocumentAdjustment } from "@/lib/invoiceAdjustments";

export type InvoicePaymentSummaryRow = {
  label: string;
  amount: number;
  status: string;
  notes?: string | null;
  sort_order?: number;
};

export type ServiceInvoicePaymentSummary = {
  payments: InvoicePaymentSummaryRow[];
  totalAmount: number;
  paidAmount?: number;
  balanceDue?: number;
  adjustments?: InvoiceDocumentAdjustment[];
};

export function invoiceDraftPricingChanged<T extends object>(draft: T, patch: Partial<T>) {
  const keys = ["currentPhase", "serviceType", "projectType", "squareFeet", "paid",
    "renovationRate", "renovationVirtualRate", "furnitureRate", "furnitureVirtualRate"] as Array<keyof T>;
  return keys.some(key => key in patch && patch[key] !== draft[key]);
}

export function currentDueInvoicePayment(payments: InvoicePaymentSummaryRow[]) {
  return payments
    .map((payment, index) => ({ payment, order: payment.sort_order ?? index }))
    .filter(({ payment }) => payment.status === "due" && money(payment.amount) > 0)
    .sort((a, b) => b.order - a.order)[0]?.payment ?? null;
}

export function invoicePaymentStripeUrl(payment: InvoicePaymentSummaryRow | null) {
  if (payment?.status !== "due" || money(payment.amount) <= 0) return null;
  return payment.notes?.match(/https:\/\/(?:buy|checkout)\.stripe\.com\/[^\s"')<>]+/i)?.[0] ?? null;
}

export function invoiceDueNow(summary: ServiceInvoicePaymentSummary) {
  const current = currentDueInvoicePayment(summary.payments);
  const openItems = activeInvoiceAdjustments(summary.adjustments).filter(row => row.status === "open");
  const extra = openItems.reduce((sum, row) => sum + Number(row.amount) * (row.adjustment_type === "credit" ? -1 : 1), 0);
  const amount = Math.max(0, Math.round(((current?.amount ?? 0) + extra) * 100) / 100);
  let link = invoicePaymentStripeUrl(current);
  if (openItems.length || /Stripe payment amount:/i.test(current?.notes ?? "")) {
    const quoted = Number(current?.notes?.match(/Stripe payment amount:\s*([\d.]+)/i)?.[1]);
    const quotedIds = current?.notes?.match(/Stripe adjustment ids:[ \t]*([^\n]*)/i)?.[1].split(",").filter(Boolean).sort().join(",") ?? "";
    const currentIds = openItems.map(row => row.id).filter(Boolean).sort().join(",");
    if (Math.round(quoted * 100) !== Math.round(amount * 100) || quotedIds !== currentIds || openItems.some(row => !row.id)) link = null;
  }
  return { current, amount, link: amount > 0 ? link : null };
}

export function renderServiceInvoicePayments(summary: ServiceInvoicePaymentSummary) {
  const { payments } = summary;
  const { current, amount: dueNow, link } = invoiceDueNow(summary);
  const paid = summary.paidAmount ?? payments.reduce(
    (sum, payment) => sum + (payment.status === "paid" ? money(payment.amount) : 0), 0,
  );
  const waived = payments.reduce(
    (sum, payment) => sum + (payment.status === "waived" ? money(payment.amount) : 0), 0,
  );
  const balance = summary.balanceDue ?? Math.max(adjustedInvoiceTotal(summary.totalAmount, summary.adjustments) - paid - waived, 0);
  const phases = [...payments].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .filter(payment => money(payment.amount) > 0 && /^(Phase \d+ - |Due (on|at) )/i.test(payment.label))
    .map(payment => {
      const name = payment.label.replace(/^Phase \d+ - /, "").replace(/^Due (on|at) /i, "").replace(/:$/, "");
      const label = `Due ${name === "Project Start" ? "on" : "at"} ${escapeHtml(name)}:`;
      const amount = formatMoney(money(payment.amount));
      const closed = payment.status === "paid" || payment.status === "waived";
      const content = closed
        ? `<span><s>${label}</s>${payment.status === "waived" ? " <small>Waived</small>" : ""}</span><s>${amount}</s>`
        : `<span>${label}</span><span>${amount}</span>`;
      return `<div class="summary-row${current === payment ? " current-phase" : ""}"${current === payment ? ' style="font-weight:700"' : ""}>${content}</div>`;
    }).join("\n");
  const items = activeInvoiceAdjustments(summary.adjustments).map(row => {
    const amount = `${row.adjustment_type === "credit" ? "-" : ""}${formatMoney(Number(row.amount))}`;
    const closed = row.status !== "open";
    return `<div class="summary-row" style="font-weight:700"><span>${closed ? "<s>" : ""}${escapeHtml(row.label)}${closed ? "</s>" : ""}</span><span>${closed ? "<s>" : ""}${amount}${closed ? "</s>" : ""}</span></div>`;
  }).join("\n");
  const pay = dueNow > 0
    ? `<div class="pay"><div>${link ? `<a href="${escapeHtml(link)}">CLICK HERE TO PAY</a>` : "Amount due now"}</div><div>${formatMoney(dueNow)}</div></div>`
    : '<div class="summary-row"><span>No payment currently due</span><span></span></div>';
  return `<!-- service-payments:start -->
    <style>@media print { html, body { min-height: 0 !important; height: auto !important; } .summary-row, .pay { break-inside: avoid; } }</style>
    ${activeInvoiceAdjustments(summary.adjustments).length ? `<div class="summary-row"><strong>Revised Invoice Total:</strong><strong>${formatMoney(adjustedInvoiceTotal(summary.totalAmount, summary.adjustments))}</strong></div>` : ""}
    <div class="summary-row"><strong>Paid:</strong><span>${formatMoney(paid)}</span></div>
    <div class="summary-row"><strong><u>Design Fee Due:</u></strong><strong><u>${formatMoney(Math.max(balance, 0))}</u></strong></div>
    ${phases}
    ${items}
    ${pay}
    <!-- service-payments:end -->`;
}

// Refresh saved Studio-generated HTML without changing its line items, client
// details, signatures, or original document. Imported PDFs are not HTML templates.
export function refreshServiceInvoicePayments(html: string, summary: ServiceInvoicePaymentSummary) {
  const rendered = renderServiceInvoicePayments(summary);
  if (html.includes("<!-- service-payments:start -->")) {
    return html.replace(/<!-- service-payments:start -->[\s\S]*?<!-- service-payments:end -->/, () => rendered);
  }
  if (!/SERVICE INVOICE/.test(html)) return html;
  return html.replace(
    /(<section\s+class=["']summary["'][^>]*>\s*<div\s+class=["']fee-row["'][^>]*>[\s\S]*?<\/div>)[\s\S]*?(?=<div\s+class=["']sig["'])/,
    (_, prefix: string) => `${prefix}\n${rendered}\n`,
  );
}

function money(value: number) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#039;");
}
