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
    const blob = await (await fetch(documentUrl)).blob();
    if (isHtmlInvoice(blob, documentUrl)) {
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

    const pdfBlob = await sanitizeInvoicePdfBlob(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
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

  const blob = await (await fetch(documentUrl)).blob();
  if (isHtmlInvoice(blob, documentUrl)) {
    printHtmlAsPdf(applyInvoicePaymentLink(await blob.text(), options.paymentUrl), fileName);
    return;
  }

  const pdfBlob = await sanitizeInvoicePdfBlob(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
  const url = URL.createObjectURL(pdfBlob);
  triggerDownload(url, invoicePdfFileName(fileName));
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function sanitizeInvoicePdfBlob(blob: Blob) {
  try {
    const { PDFDocument, PDFName, rgb } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
    let removedStripeLink = false;

    for (const page of pdfDoc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;

      const keptAnnotations = [];
      for (let index = 0; index < annots.size(); index += 1) {
        const annotationRef = annots.get(index);
        const annotation = pdfDoc.context.lookup(annotationRef) as any;
        const action = annotation?.lookup?.(PDFName.of("A"));
        const uri = action?.lookup?.(PDFName.of("URI"));
        const uriText = typeof uri?.decodeText === "function" ? uri.decodeText() : uri?.asString?.() || "";

        if (/https:\/\/(?:buy|checkout)\.stripe\.com\//i.test(uriText)) {
          removedStripeLink = true;
          continue;
        }

        keptAnnotations.push(annotationRef);
      }

      if (keptAnnotations.length !== annots.size()) {
        page.node.set(PDFName.of("Annots"), pdfDoc.context.obj(keptAnnotations));
      }
    }

    if (removedStripeLink) {
      const firstPage = pdfDoc.getPages()[0];
      const { width, height } = firstPage.getSize();

      // Uploaded invoice PDFs keep old Stripe links baked into the file. Cover
      // only the legacy pay strip; the client portal Pay Online button is current.
      firstPage.drawRectangle({
        x: width * 0.54,
        y: height * 0.16,
        width: width * 0.43,
        height: height * 0.055,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
    }

    return new Blob([await pdfDoc.save()], { type: "application/pdf" });
  } catch (error) {
    console.warn("Could not sanitize invoice PDF payment link.", error);
    return blob;
  }
}

function applyInvoicePaymentLink(html: string, paymentUrl?: string | null) {
  const withoutEmbeddedPayRow = removeEmbeddedPayRow(html);

  // The client portal has its own current Pay Online button. Strip stale
  // Stripe URLs from saved invoice HTML so old phase links cannot be reused.
  if (!paymentUrl) {
    return withoutEmbeddedPayRow.replace(/https:\/\/(?:buy|checkout)\.stripe\.com\/[^\s"')<]+/gi, "#");
  }

  return withoutEmbeddedPayRow.replace(/https:\/\/(?:buy|checkout)\.stripe\.com\/[^\s"')<]+/gi, escapeHtmlAttribute(paymentUrl));
}

function removeEmbeddedPayRow(html: string) {
  const withoutPayBlock = html.replace(
    /<div\s+class=["']pay["'][^>]*>\s*<div>[\s\S]*?<\/div>\s*<div>[\s\S]*?<\/div>\s*<\/div>/gi,
    "",
  );

  if (withoutPayBlock !== html) return withoutPayBlock;

  return withoutPayBlock
    .replace(/<a\b[^>]*>\s*CLICK(?:\s|&nbsp;)+HERE(?:\s|&nbsp;)+TO(?:\s|&nbsp;)+PAY\s*<\/a>/gi, "CLICK HERE TO PAY")
    .replace(/(?<![>\w])CLICK(?:\s|&nbsp;)+HERE(?:\s|&nbsp;)+TO(?:\s|&nbsp;)+PAY(?!\s*<\/a>)/gi, "");
}

function isHtmlInvoice(blob: Blob, documentUrl: string) {
  return blob.type.toLowerCase().includes("text/html") || /^data:text\/html/i.test(documentUrl) || /\.html?(?:$|\?)/i.test(documentUrl);
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
