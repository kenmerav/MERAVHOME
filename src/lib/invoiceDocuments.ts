import { supabaseImageTransformUrl } from "@/lib/local-assets";
import { restyleServiceInvoiceHtml, waitForInvoiceAssets } from "@/lib/serviceInvoiceTemplate";
import { refreshInvoiceAdjustmentsHtml } from "@/lib/invoiceAdjustments";
import {
  currentDueInvoicePayment,
  invoicePaymentStripeUrl,
  refreshServiceInvoicePayments,
  type ServiceInvoicePaymentSummary,
} from "@/lib/serviceInvoicePayments";

export function invoicePdfFileName(fileName?: string | null) {
  const safeName = (fileName || "Invoice").replace(/\.(html?|pdf)$/i, "").trim() || "Invoice";
  return `${safeName}.pdf`;
}

type InvoiceDocumentOptions = {
  paymentUrl?: string | null;
  servicePayments?: ServiceInvoicePaymentSummary;
  invoiceTitle?: string | null;
  clientName?: string | null;
};

export function prepareInvoiceHtml(html: string, options: InvoiceDocumentOptions = {}) {
  const paymentUrl = options.servicePayments
    ? invoicePaymentStripeUrl(currentDueInvoicePayment(options.servicePayments.payments))
    : options.paymentUrl;
  const safeHtml = applyInvoicePaymentLink(restyleServiceInvoiceHtml(html), paymentUrl);
  if (!options.servicePayments) return safeHtml;
  return refreshInvoiceAdjustmentsHtml(
    refreshServiceInvoicePayments(safeHtml, options.servicePayments),
    options.servicePayments.adjustments, options.servicePayments.totalAmount,
  );
}

export async function openInvoiceDocument(
  documentUrl: string | null,
  fileName?: string | null,
  options: InvoiceDocumentOptions = {},
) {
  if (!documentUrl) return;
  const target = window.open("", "_blank");
  if (target) target.opener = null;

  try {
    const blob = await (await fetch(documentUrl)).blob();
    if (isHtmlInvoice(blob, documentUrl)) {
      const html = optimizeInvoiceImages(
        prepareInvoiceHtml(await blob.text(), options),
      );
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

    const pdfBlob = await sanitizeInvoicePdfBlob(
      blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }),
      options,
    );
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

export async function downloadInvoiceDocument(
  documentUrl: string | null,
  fileName?: string | null,
  options: InvoiceDocumentOptions = {},
) {
  if (!documentUrl) return;

  const blob = await (await fetch(documentUrl)).blob();
  if (isHtmlInvoice(blob, documentUrl)) {
    await printHtmlAsPdf(
      optimizeInvoiceImages(prepareInvoiceHtml(await blob.text(), options)),
      fileName,
    );
    return;
  }

  const pdfBlob = await sanitizeInvoicePdfBlob(
    blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }),
    options,
  );
  const url = URL.createObjectURL(pdfBlob);
  triggerDownload(url, invoicePdfFileName(fileName));
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function sanitizeInvoicePdfBlob(blob: Blob, options: InvoiceDocumentOptions = {}) {
  const base = await refreshInvoicePdfBlob(blob, options);
  if (!options.servicePayments?.adjustments?.length) return base;
  const { appendInvoiceAdjustmentsPdf } = await import("@/lib/invoiceAdjustmentsPdf");
  const updated = await appendInvoiceAdjustmentsPdf(new Uint8Array(await base.arrayBuffer()), options.servicePayments, {
    title: options.invoiceTitle, clientName: options.clientName,
  });
  const bytes = new Uint8Array(updated.length);
  bytes.set(updated);
  return new Blob([bytes.buffer], { type: "application/pdf" });
}

async function refreshInvoicePdfBlob(blob: Blob, options: InvoiceDocumentOptions = {}) {
  if (options.servicePayments) {
    const { updateServiceInvoicePdf } = await import("@/lib/serviceInvoicePdf");
    const updated = await updateServiceInvoicePdf(new Uint8Array(await blob.arrayBuffer()), options.servicePayments);
    if (updated) {
      const bytes = new Uint8Array(updated.length);
      bytes.set(updated);
      return new Blob([bytes.buffer], { type: "application/pdf" });
    }
  }
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
        const uriText =
          typeof uri?.decodeText === "function" ? uri.decodeText() : uri?.asString?.() || "";

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

    const saved = await pdfDoc.save();
    const bytes = new Uint8Array(saved.length);
    bytes.set(saved);
    return new Blob([bytes.buffer], { type: "application/pdf" });
  } catch (error) {
    console.warn("Could not sanitize invoice PDF payment link.", error);
    return blob;
  }
}

export function applyInvoicePaymentLink(html: string, paymentUrl?: string | null) {
  const currentPaymentUrl = paymentUrl?.trim();

  // Remove the embedded pay row when there is no currently-due Stripe link so
  // an old saved link cannot be reused after an invoice is paid or replaced.
  if (!currentPaymentUrl) {
    return removeEmbeddedPayRow(html).replace(
      /https:\/\/(?:buy|checkout)\.stripe\.com\/[^\s"')<]+/gi,
      "#",
    );
  }

  const escapedPaymentUrl = escapeHtmlAttribute(currentPaymentUrl);
  const withCurrentUrl = html.replace(
    /https:\/\/(?:buy|checkout)\.stripe\.com\/[^\s"')<]+/gi,
    escapedPaymentUrl,
  );

  if (
    /<a\b[^>]*>\s*CLICK(?:\s|&nbsp;)+HERE(?:\s|&nbsp;)+TO(?:\s|&nbsp;)+PAY\s*<\/a>/i.test(
      withCurrentUrl,
    )
  ) {
    return withCurrentUrl;
  }

  return withCurrentUrl.replace(
    /(<div\s+class=["']pay["'][^>]*>\s*<div[^>]*>)\s*(CLICK(?:\s|&nbsp;)+HERE(?:\s|&nbsp;)+TO(?:\s|&nbsp;)+PAY)\s*(<\/div>)/i,
    `$1<a href="${escapedPaymentUrl}">$2</a>$3`,
  );
}

function removeEmbeddedPayRow(html: string) {
  const withoutPayBlock = html.replace(
    /<div\s+class=["']pay["'][^>]*>\s*<div>[\s\S]*?<\/div>\s*<div>[\s\S]*?<\/div>\s*<\/div>/gi,
    "",
  );

  if (withoutPayBlock !== html) return withoutPayBlock;

  return withoutPayBlock
    .replace(
      /<a\b[^>]*>\s*CLICK(?:\s|&nbsp;)+HERE(?:\s|&nbsp;)+TO(?:\s|&nbsp;)+PAY\s*<\/a>/gi,
      "CLICK HERE TO PAY",
    )
    .replace(
      /(?<![>\w])CLICK(?:\s|&nbsp;)+HERE(?:\s|&nbsp;)+TO(?:\s|&nbsp;)+PAY(?!\s*<\/a>)/gi,
      "",
    );
}

function isHtmlInvoice(blob: Blob, documentUrl: string) {
  return (
    blob.type.toLowerCase().includes("text/html") ||
    /^data:text\/html/i.test(documentUrl) ||
    /\.html?(?:$|\?)/i.test(documentUrl)
  );
}

function optimizeInvoiceImages(html: string) {
  if (typeof DOMParser === "undefined") return html;

  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll<HTMLImageElement>("img.product-image").forEach((image) => {
    const source = image.getAttribute("src");
    if (!source) return;
    image.setAttribute(
      "src",
      supabaseImageTransformUrl(source, {
        width: 240,
        height: 240,
        quality: 65,
        resize: "contain",
      }),
    );
  });

  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function printHtmlAsPdf(html: string, fileName?: string | null) {
  const target = window.open("", "_blank");
  if (!target) {
    throw new Error("Allow popups to download the invoice PDF.");
  }

  target.opener = null;
  target.document.open();
  target.document.write(html);
  target.document.close();
  target.document.title = invoicePdfFileName(fileName);
  try {
    await waitForInvoiceAssets(target.document);
    target.focus();
    target.print();
  } catch {
    target.close();
    throw new Error("Could not load the invoice logo or fonts. Please try the PDF again.");
  }
}

function triggerDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
