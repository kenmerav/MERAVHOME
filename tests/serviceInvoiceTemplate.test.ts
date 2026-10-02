import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildServiceInvoiceTemplate, restyleServiceInvoiceHtml, waitForInvoiceAssets,
} from "../src/lib/serviceInvoiceTemplate";
import { prepareInvoiceHtml } from "../src/lib/invoiceDocuments";

const data = {
  projectName: "Sample Project", clientName: "Sample Client", projectAddress: "123 Sample Lane",
  invoiceDate: "2026-10-02", totalAmount: 8000, paidAmount: 6000, balanceDue: 2000,
  assetBaseUrl: "https://studio.example.test",
  sections: [
    { kind: "renovation" as const, title: "Renovation Design", amount: 8000, location: "Full Space", description: "Design planning" },
    { kind: "furniture" as const, title: "Furniture Design", amount: 0, location: "Full Space", description: "Furniture planning" },
  ],
  payments: [
    { label: "Phase 1 - Project Start", amount: 4000, status: "paid", notes: "https://buy.stripe.com/test_old", sort_order: 0 },
    { label: "Phase 2 - Design Presentation", amount: 2000, status: "paid", notes: null, sort_order: 1 },
    { label: "Phase 3 - Design Document Delivery", amount: 1600, status: "due", notes: "https://buy.stripe.com/test_document", sort_order: 2 },
    { label: "Phase 4 - Project Completion", amount: 400, status: "not_due", notes: null, sort_order: 3 },
  ],
};

describe("reference service invoice layout", () => {
  it("uses the supplied image, local regular/bold/italic fonts, and fixed Letter layout", () => {
    const html = buildServiceInvoiceTemplate(data);
    expect(html).toContain('src="https://studio.example.test/invoice-assets/v1/merav-submark.png"');
    expect(html).toContain('class="invoice-logo"');
    expect(html).toContain("PlayfairDisplay.ttf");
    expect(html).toContain("PlayfairDisplay-Italic.ttf");
    expect(html).toContain("@page { size: letter;");
    expect(html).toContain("width: 6.6in");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("Times New Roman");
    expect(html).not.toContain("BY KATIE ROBERTS</div>");
  });
  it("retains both design tables, including zero-cost furniture", () => {
    const html = buildServiceInvoiceTemplate(data);
    expect(html).toContain("Renovation + Furnishings Design");
    expect(html).toContain("Furniture Design");
    expect(html).toContain("Furniture planning");
    expect(html).toContain('<td class="right">$0.00</td>');
    expect(html.match(/class="line-table /g)).toHaveLength(2);
    expect(html).toContain("Authorized by Client");
    expect(html).toContain("Authorized by MERAV INTERIORS");
  });
  it("uses live payment values instead of copying the reference's totals", () => {
    const html = buildServiceInvoiceTemplate(data);
    expect(html).toContain("<strong>Paid:</strong><span>$6,000.00</span>");
    expect(html).toContain("<u>$2,000.00</u>");
    expect(html).toContain("<s>$4,000.00</s>");
    expect(html).toContain("<s>$2,000.00</s>");
    expect(html).not.toContain("<small>Paid</small>");
    expect(html).toContain('class="summary-row current-phase"');
    expect(html).toContain('href="https://buy.stripe.com/test_document"');
    expect(html).toContain('<div>$1,600.00</div>');
    expect(html).not.toContain("test_old");
  });
  it("escapes client data and allows long descriptions to flow without clipping", () => {
    const html = buildServiceInvoiceTemplate({ ...data, clientName: '<script>alert("x")</script>', projectAddress: "Line one\nLine two", sections: [{ ...data.sections[0], description: "Very long details ".repeat(150) }] });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Line one<br>Line two");
    expect(html).toContain("Very long details ".repeat(150));
    expect(html).toContain("overflow-wrap: anywhere");
    expect(html).not.toContain("overflow: hidden");
  });
  it("does not change already-versioned templates or unrelated product invoices", () => {
    const current = buildServiceInvoiceTemplate(data);
    expect(restyleServiceInvoiceHtml(current)).toBe(current);
    const product = "<main class='page'><h1>Product Invoice</h1><div>Furniture purchase</div></main>";
    expect(restyleServiceInvoiceHtml(product)).toBe(product);
  });
  it("restyles older saved staff/client HTML without replacing scope or client records", () => {
    const legacy = `<html><head><style>@import url('https://fonts.googleapis.com/css2?family=Cormorant'); .page { width:7in } .summary { color:#000 }</style></head><body>
      <main class="page"><section class="brand"><div class="logo">MERAV INTERIORS</div><div class="byline">BY KATIE ROBERTS</div></section>
      <h1>SERVICE INVOICE</h1><div><strong>Client:</strong><span style="margin-left:0.55in">Original Client</span></div>
      <table class="line-table"><thead><tr><th colspan="3" class="center">Renovation Design</th></tr><tr><th style="width:30%">Location</th></tr></thead><tbody><tr class="item-row"><td>Original scope</td></tr></tbody></table>
      <section class="summary"><div class="fee-row"><span>$8,000.00</span></div><div class="summary-row">Old payment summary</div><div class="sig">Authorized by Client</div></section></main></body></html>`;
    const html = prepareInvoiceHtml(legacy, { servicePayments: data });
    expect(html).toContain("Original Client");
    expect(html).toContain("Original scope");
    expect(html).toContain('class="client-row"');
    expect(html).toContain('class="invoice-logo"');
    expect(html).toContain('class="line-table renovation"');
    expect(html).toContain('class="section-title"');
    expect(html).toContain('class="column-headings"');
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("Old payment summary");
    expect(html).toContain("<strong>Paid:</strong><span>$6,000.00</span>");
    expect(html).toContain('href="https://buy.stripe.com/test_document"');
  });
  it("keeps the original supplied logo byte-for-byte", () => {
    // Compare with the reviewed asset's digest rather than depend on a user's local file.
    const image = readFileSync(new URL("../public/invoice-assets/v1/merav-submark.png", import.meta.url));
    expect(createHash("sha256").update(image).digest("hex")).toBe("eab63ee373a3214eb032063c64d8aefca3d4a0f1f493e67b5dae80afa4b3f5e6");
  });
});

describe("printing waits for invoice assets", () => {
  it("waits for all font styles and logo decoding before printing", async () => {
    const calls: string[] = [];
    const logo = { naturalWidth: 1500, decode: async () => { calls.push("logo"); } };
    const document = { querySelector: () => logo, fonts: {
      load: async (font: string) => { calls.push(font); }, ready: Promise.resolve(),
    } } as unknown as Document;
    await waitForInvoiceAssets(document);
    expect(calls).toEqual(["400 10px MeravInvoice", "700 10px MeravInvoice", "italic 400 10px MeravInvoice", "logo"]);
  });
  it("reports logo failures rather than silently printing a missing image", async () => {
    const document = { querySelector: () => ({ naturalWidth: 0, decode: async () => {} }) } as unknown as Document;
    await expect(waitForInvoiceAssets(document)).rejects.toThrow("Could not load the invoice logo");
  });
  it("does not add invoice font dependencies to unrelated product documents", async () => {
    await expect(waitForInvoiceAssets({ querySelector: () => null } as unknown as Document)).resolves.toBeUndefined();
  });
});
