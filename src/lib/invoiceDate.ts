export function currentInvoiceDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix", month: "2-digit", day: "2-digit", year: "numeric",
  }).format(now);
}

export function refreshInvoiceDateHtml(html: string) {
  if (!/SERVICE\s+INVOICE/.test(html)) return html;
  return html.replace(
    /(<div\s+class=["']meta["'][^>]*>\s*<strong[^>]*>Date:\s*<\/strong>\s*<span[^>]*>)[\s\S]*?(<\/span>)/i,
    (_, prefix: string, suffix: string) => `${prefix}${currentInvoiceDate()}${suffix}`,
  );
}
