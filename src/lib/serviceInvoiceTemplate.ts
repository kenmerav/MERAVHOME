import { formatMoney } from "@/lib/money";
import { renderServiceInvoicePayments, type ServiceInvoicePaymentSummary } from "@/lib/serviceInvoicePayments";

export type ServiceInvoiceSection = {
  kind: "renovation" | "furniture";
  title: string;
  amount: number;
  location: string;
  description: string;
};

type ServiceInvoiceTemplate = ServiceInvoicePaymentSummary & {
  projectName: string;
  clientName: string;
  projectAddress: string;
  invoiceDate: string;
  sections: ServiceInvoiceSection[];
  assetBaseUrl?: string;
};

// Keep this version's files at stable paths so saved invoices can still load
// their original logo/fonts after later releases. Do not replace v1 assets.
function invoiceAssetUrl(name: string, assetBaseUrl?: string) {
  const origin = assetBaseUrl ?? (typeof window === "undefined"
    ? "https://studio.meravinteriors.com" : window.location.origin);
  return new URL(`/invoice-assets/v1/${name}`, origin).href;
}

export function serviceInvoiceStyles(assetBaseUrl?: string) {
  return `
    @font-face { font-family: MeravInvoice; src: url("${invoiceAssetUrl("PlayfairDisplay.ttf", assetBaseUrl)}") format("truetype"); font-weight: 400 900; font-style: normal; font-display: block; }
    @font-face { font-family: MeravInvoice; src: url("${invoiceAssetUrl("PlayfairDisplay-Italic.ttf", assetBaseUrl)}") format("truetype"); font-weight: 400 900; font-style: italic; font-display: block; }
    @page { size: letter; margin: 0; }
    html, body { width: 8.5in; min-height: 0; height: auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #fff; color: #211e1e; font-family: MeravInvoice, Georgia, serif; font-size: 6.62pt; line-height: 1.3; }
    * { box-sizing: border-box; }
    .page { width: 6.6in; min-height: 9.5in; margin: .75in 0 .75in .7in; padding: 0 .16in .2in; border: .4pt solid #aaa; }
    .brand { padding-top: 3pt; margin: 0 0 2.5pt; text-align: center; }
    .invoice-logo { display: block; width: 5.15in; max-width: 100%; height: auto; margin: 0 auto; }
    .top { display: grid; grid-template-columns: 1fr 120pt; gap: 12pt; min-height: 84pt; margin-bottom: 8pt; }
    .client-row, .provider-row { display: grid; grid-template-columns: 52pt 1fr; gap: 0; }
    .provider { margin-top: 32pt; }
    .title { font-size: 12.04pt; line-height: 1.2; font-weight: 700; margin-bottom: 14pt; white-space: nowrap; }
    .meta { display: grid; grid-template-columns: 56pt 1fr; row-gap: 23pt; }
    .meta span { overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 6.62pt; }
    th, td { border: .5pt solid #000; padding: 2pt 1.5pt; vertical-align: middle; overflow-wrap: anywhere; }
    th { background: #e7e5d9; text-align: left; font-weight: 700; }
    .center { text-align: center; }
    .right { text-align: right; }
    .line-table .section-title th { height: 20.8pt; padding: 0 1.5pt; font-size: 7.22pt; text-align: center; }
    .line-table .column-headings th { height: 20.8pt; }
    .line-table .item-row td { height: 106pt; }
    .line-table.furniture .section-title th { height: 19.5pt; }
    .line-table.furniture .column-headings th { height: 14.3pt; }
    .line-table.furniture .item-row td { height: 57.6pt; }
    .line-table .subtotal-row td { height: 20pt; padding: 2pt 1.5pt; }
    .line-table .subtotal-spacer { border: 0; padding: 0; background: transparent; }
    .line-table .subtotal-amount { background: #e7e5d9; }
    .line-table + .line-table { margin-top: 3pt; }
    thead { display: table-header-group; }
    .summary { width: 181pt; margin: 9pt 0 0 auto; font-size: 6.62pt; }
    .fee-row { display: grid; grid-template-columns: 1fr 65pt; align-items: stretch; margin-bottom: 1pt; }
    .fee-label { align-self: center; text-align: right; padding-right: 2pt; font-size: 9.03pt; white-space: nowrap; }
    .fee-box { min-height: 27.3pt; border: .5pt solid #000; background: #e7e5d9; padding: 6pt 1.5pt; text-align: right; font-size: 9.03pt; line-height: 1.3; font-weight: 700; }
    .summary-row { display: grid; grid-template-columns: 1fr 65pt; text-align: right; gap: 2pt; min-height: 10.8pt; margin: 0; }
    .summary-row > :last-child { font-size: 7.83pt; }
    .current-phase { font-weight: 700; }
    s { text-decoration-thickness: .5pt; }
    .pay { display: grid; grid-template-columns: 1fr 65pt; border: 1pt solid #000; margin: 11pt 0 0; font-size: 7.83pt; line-height: 1.25; }
    .pay div { background: #e7e5d9; padding: 1pt 2pt; text-align: right; font-weight: 700; }
    .pay div + div { border-left: .5pt solid #000; }
    .pay a { font-weight: 400; }
    a { color: #00f; text-decoration: underline; }
    .sig { margin-top: 25pt; border-top: .5pt solid #000; padding: 2pt 1.5pt 0; display: grid; grid-template-columns: 1fr 63pt; font-size: 6.62pt; line-height: 9pt; font-style: italic; }
    .sig + .sig { margin-top: 20pt; }
    @media print { .summary-row, .pay, .sig, .item-row { break-inside: avoid; } }
  `;
}

function logoHtml(assetBaseUrl?: string) {
  return `<section class="brand"><img class="invoice-logo" src="${invoiceAssetUrl("merav-submark.png", assetBaseUrl)}" width="1500" height="325" alt="MERAV Interiors — by Katie Roberts" /></section>`;
}

export function buildServiceInvoiceTemplate(data: ServiceInvoiceTemplate) {
  const address = data.projectAddress.split(/\n|,/).map(line => line.trim()).filter(Boolean).map(escapeHtml).join("<br>");
  const dateParts = data.invoiceDate.split("-");
  const date = dateParts.length === 3 ? `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}` : data.invoiceDate;
  const tables = data.sections.map(section => `
    <table class="line-table ${section.kind}">
      <colgroup><col style="width:29.5%"><col style="width:56%"><col style="width:14.5%"></colgroup>
      <thead>
        <tr class="section-title"><th colspan="3">${escapeHtml(section.kind === "renovation" ? "Renovation + Furnishings Design" : section.title)}</th></tr>
        <tr class="column-headings"><th>Location</th><th>Description</th><th>Subtotal</th></tr>
      </thead>
      <tbody>
        <tr class="item-row"><td class="center"><strong>${escapeHtml(section.location)}</strong></td><td class="center">${escapeHtml(section.description)}</td><td class="right">${formatMoney(section.amount)}</td></tr>
        <tr class="subtotal-row"><td class="subtotal-spacer" colspan="2"></td><td class="right subtotal-amount"><strong>${formatMoney(section.amount)}</strong></td></tr>
      </tbody>
    </table>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.projectName || "Design Service Invoice")}</title>
    <style data-service-invoice-template="v1">${serviceInvoiceStyles(data.assetBaseUrl)}</style></head><body>
    <main class="page">
      ${logoHtml(data.assetBaseUrl)}
      <section class="top">
        <div><div class="client-row"><strong>Client:</strong><span>${escapeHtml(data.clientName || "Client Name")}</span></div>
          <div class="provider provider-row"><strong>Provider:</strong><span>MERAV INTERIORS<br><a href="mailto:katie@meravinteriors.com">katie@meravinteriors.com</a></span></div></div>
        <div><div class="title">SERVICE INVOICE</div><div class="meta"><strong>Date:</strong><span>${escapeHtml(date)}</span><strong>Address:</strong><span>${address}</span></div></div>
      </section>
      ${tables}
      <section class="summary">
        <div class="fee-row"><strong class="fee-label">Total Design Fee:</strong><span class="fee-box">${formatMoney(data.totalAmount)}</span></div>
        ${renderServiceInvoicePayments(data)}
        <div class="sig"><span>Authorized by Client</span><span>Date</span></div>
        <div class="sig"><span>Authorized by MERAV INTERIORS</span><span>Date</span></div>
      </section>
    </main></body></html>`;
}

// Older saved HTML retains all client/scope/amount content. Update only known
// Studio template markup; unrelated product documents and uploaded PDFs are left alone.
export function restyleServiceInvoiceHtml(html: string, assetBaseUrl?: string) {
  if (!/SERVICE INVOICE/.test(html) || !/<main\s+class=["']page["']/.test(html)) return html;
  if (/data-service-invoice-template=/.test(html)) return html;
  const styles = `<style data-service-invoice-template="v1">${serviceInvoiceStyles(assetBaseUrl)}</style>`;
  return html.replace(/<style>\s*[\s\S]*?\.page\s*\{[\s\S]*?<\/style>/, () => styles)
    .replace(/<section\s+class=["']brand["'][^>]*>[\s\S]*?<\/section>/, () => logoHtml(assetBaseUrl))
    .replace(/<table\s+class=["']line-table["'][^>]*>([\s\S]*?)<\/table>/g, (_, content: string) => {
      const kind = /Furniture Design/.test(content) ? "furniture" : "renovation";
      return `<table class="line-table ${kind}">${content
        .replace(/<tr>(?=<th colspan)/, '<tr class="section-title">')
        .replace(/<tr>(?=<th style)/, '<tr class="column-headings">')
        .replace("Renovation Design", "Renovation + Furnishings Design")}</table>`;
    })
    .replace(/<div><strong>Client:<\/strong><span style=["']margin-left:[^"']*["']>/, '<div class="client-row"><strong>Client:</strong><span>')
    .replaceAll("background:#e9e7de", "background:#e7e5d9");
}

export async function waitForInvoiceAssets(document: Document) {
  const logo = document.querySelector<HTMLImageElement>("img.invoice-logo");
  if (!logo) return;
  if (document.fonts) {
    await Promise.all(["400", "700", "italic 400"].map(weight => document.fonts.load(`${weight} 10px MeravInvoice`)));
    await document.fonts.ready;
  }
  if (typeof logo.decode === "function") await logo.decode();
  else if (!logo.complete) await new Promise<void>((resolve, reject) => {
    logo.addEventListener("load", () => resolve(), { once: true });
    logo.addEventListener("error", () => reject(new Error("Could not load the invoice logo.")), { once: true });
  });
  if (!logo.naturalWidth) throw new Error("Could not load the invoice logo.");
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
