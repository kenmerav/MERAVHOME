import { formatMoney } from "@/lib/money";

export type InvoiceDocumentAdjustment = {
  id?: string;
  adjustment_type: "credit" | "charge";
  label: string;
  amount: number;
  status: string;
  notes?: string | null;
  sort_order?: number;
};

export function activeInvoiceAdjustments(rows: InvoiceDocumentAdjustment[] = []) {
  return [...rows].filter(row => row.status !== "void" &&
    !(row.adjustment_type === "charge" && row.status === "waived"))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function adjustedInvoiceTotal(original: number, rows: InvoiceDocumentAdjustment[] = []) {
  return Math.max(0, Math.round((Number(original) + activeInvoiceAdjustments(rows).reduce(
    (sum, row) => sum + Number(row.amount) * (row.adjustment_type === "credit" ? -1 : 1), 0,
  ) + Number.EPSILON) * 100) / 100);
}

export function invoiceAdjustmentAmount(row: InvoiceDocumentAdjustment) {
  return `${row.adjustment_type === "credit" ? "-" : "+"}${formatMoney(Number(row.amount))}`;
}

export function refreshInvoiceAdjustmentsHtml(html: string, rows: InvoiceDocumentAdjustment[] = [], original = 0) {
  const clean = html.replace(/<!-- invoice-items:start -->[\s\S]*?<!-- invoice-items:end -->/g, "");
  const active = activeInvoiceAdjustments(rows);
  if (!active.length) return clean;
  const table = `<!-- invoice-items:start -->
    <section style="margin:16pt 0;break-inside:avoid;font-family:inherit">
      <h2 style="font-size:11pt;margin:0 0 8pt">Additional items &amp; credits</h2>
      <table style="width:100%;border-collapse:collapse;font-size:8pt">
        <thead><tr style="background:#e6e4da;text-align:left"><th style="padding:7pt">Item</th><th style="padding:7pt">Status</th><th style="padding:7pt;text-align:right">Amount</th></tr></thead>
        <tbody>${active.map(row => `<tr style="border-bottom:1px solid #ddd;break-inside:avoid">
          <td style="padding:7pt;overflow-wrap:anywhere">${escapeHtml(row.label)}${row.notes ? `<div style="font-size:7pt;margin-top:3pt">${escapeHtml(row.notes)}</div>` : ""}</td>
          <td style="padding:7pt">${escapeHtml(row.status)}</td>
          <td style="padding:7pt;text-align:right;white-space:nowrap">${invoiceAdjustmentAmount(row)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="2" style="padding:8pt;font-weight:bold">Revised Invoice Total</td><td style="padding:8pt;text-align:right;font-weight:bold">${formatMoney(adjustedInvoiceTotal(original, active))}</td></tr></tfoot>
      </table>
    </section><!-- invoice-items:end -->`;
  if (/<section\s+class=["']summary["']/.test(clean)) {
    return clean.replace(/<section\s+class=["']summary["']/, () => `${table}\n<section class="summary"`);
  }
  if (/<\/main>/i.test(clean)) return clean.replace(/<\/main>/i, () => `${table}</main>`);
  return /<\/body>/i.test(clean) ? clean.replace(/<\/body>/i, () => `${table}</body>`) : `${clean}\n${table}`;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
