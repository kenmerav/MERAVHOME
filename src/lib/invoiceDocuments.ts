export function invoicePdfFileName(fileName?: string | null) {
  const safeName = (fileName || "Invoice").replace(/\.(html?|pdf)$/i, "").trim() || "Invoice";
  return `${safeName}.pdf`;
}

type InvoiceDocumentOptions = {
  paymentUrl?: string | null;
};

export async function openInvoiceDocument(documentUrl: string | null, fileName?: string | null, options: InvoiceDocumentOptions = {}) {
  if (!documentUrl) return;
  const target = window.open("", "_blank");
  if (target) target.opener = null;

  try {
    if (!documentUrl.startsWith("data:")) {
      if (target) target.location.href = documentUrl;
      else window.open(documentUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const blob = await (await fetch(documentUrl)).blob();
    if (blob.type === "text/html") {
      const html = applyInvoicePaymentLink(await blob.text(), options.paymentUrl);
      if (target) {
        target.document.open();
        target.document.write(html);
        target.document.close();
      } else {
        const htmlUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        window.open(htmlUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(htmlUrl), 60_000);
      }
      return;
    }

    const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
    const url = URL.createObjectURL(pdfBlob);
    if (target) {
      target.document.title = invoicePdfFileName(fileName);
      target.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    if (target) target.close();
    throw error;
  }
}

export async function downloadInvoiceDocument(documentUrl: string | null, fileName?: string | null, options: InvoiceDocumentOptions = {}) {
  if (!documentUrl) return;

  if (!documentUrl.startsWith("data:")) {
    triggerDownload(documentUrl, invoicePdfFileName(fileName));
    return;
  }

  const blob = await (await fetch(documentUrl)).blob();
  if (blob.type === "text/html") {
    printHtmlAsPdf(applyInvoicePaymentLink(await blob.text(), options.paymentUrl), fileName);
    return;
  }

  const url = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
  triggerDownload(url, invoicePdfFileName(fileName));
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function applyInvoicePaymentLink(html: string, paymentUrl?: string | null) {
  if (!html.includes("CLICK HERE TO PAY")) return html;

  if (paymentUrl) {
    const safeUrl = escapeHtmlAttribute(paymentUrl);
    const linked = `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">CLICK HERE TO PAY</a>`;
    return html
      .replace(/<a\b[^>]*>\s*CLICK HERE TO PAY\s*<\/a>/gi, linked)
      .replace(/(?<![>\w])CLICK HERE TO PAY(?!\s*<\/a>)/gi, linked);
  }

  return html.replace(/<a\b[^>]*>\s*CLICK HERE TO PAY\s*<\/a>/gi, "CLICK HERE TO PAY");
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function printHtmlAsPdf(html: string, fileName?: string | null) {
  const target = window.open("", "_blank");
  if (!target) {
    throw new Error("Allow popups to download the invoice PDF.");
  }

  target.opener = null;
  target.document.open();
  target.document.write(html);
  target.document.close();
  target.document.title = invoicePdfFileName(fileName);
  target.setTimeout(() => {
    target.focus();
    target.print();
  }, 350);
}

function triggerDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
