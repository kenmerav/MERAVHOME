import { describe, expect, it } from "vitest";
import { buildProductInvoiceHtml, makeProductInvoiceDraft, productInvoiceTotals } from "@/components/ProductInvoiceCreator";
import { productInvoiceDiscount, productInvoiceDiscountLineIssues } from "@/lib/productInvoiceDiscount";

function draft() {
  return makeProductInvoiceDraft({
    projectName: "Test project", clientName: "Client", defaultTaxRate: "10", onlyApproved: false,
    items: [{ id: "lamp", material: { client_product_name: "Lamp", category: "Lighting", quantity: 2, quantity_unit: "count", image_url: null, color: null, product_url: null, cad_label: null, notes: null },
      room_product: { product: { id: "p", name: "Lamp", category: "Lighting", vendor: null, image_url: null, price: "$80", retail_price: "$100", unit_cost: "$50", shipping: "$5", finish: null, dimensions: null, sku: null, product_url: null } } }],
  });
}

describe("client invoice designer discount", () => {
  it("is off by default and adds retail and discount to the actual invoice when selected", () => {
    const invoice = draft();
    const totals = productInvoiceTotals(invoice);
    expect(totals.total).toBe(186);
    expect(buildProductInvoiceHtml(invoice, totals)).not.toContain("Designer discount:");
    invoice.showDesignerDiscount = true;
    const html = buildProductInvoiceHtml(invoice, totals);
    expect(html).toContain("Full retail price:</span><span>$200.00");
    expect(html).toContain("Designer discount:</span><span>-$40.00");
    expect(html).toContain("$186.00");
    expect(html).not.toContain("$50.00");
    expect(productInvoiceTotals(invoice).total).toBe(186);
  });

  it("recalculates from selected invoice lines and their edited quantities and prices", () => {
    const invoice = draft();
    invoice.lines[0].quantity = "3";
    invoice.lines[0].unitPrice = "$90";
    invoice.lines.push({ ...invoice.lines[0], selected: false, retailUnitPrice: "$900" });
    expect(productInvoiceDiscount(invoice.lines)).toEqual({ retail: 300, discount: 30, incomplete: 0 });
  });

  it("uses the client price as retail when retail is blank, including after invoice edits", () => {
    const invoice = draft();
    invoice.showDesignerDiscount = true;
    invoice.lines[0].retailUnitPrice = "";
    expect(productInvoiceDiscount(invoice.lines)).toEqual({ retail: 160, discount: 0, incomplete: 0 });
    expect(buildProductInvoiceHtml(invoice, productInvoiceTotals(invoice))).toContain("Full retail price:</span><span>$160.00");
    invoice.lines[0].unitPrice = "$90";
    expect(productInvoiceDiscount(invoice.lines)).toEqual({ retail: 180, discount: 0, incomplete: 0 });
  });

  it("refuses to present a discount if the client price or price unit is missing or an entered retail price is invalid", () => {
    const invoice = draft();
    invoice.showDesignerDiscount = true;
    invoice.lines[0].retailUnitPrice = "invalid";
    expect(productInvoiceDiscount(invoice.lines).incomplete).toBe(1);
    expect(buildProductInvoiceHtml(invoice, productInvoiceTotals(invoice))).not.toContain("Designer discount:");
    invoice.lines[0].retailUnitPrice = "$100";
    invoice.lines[0].priceUnit = "sq_ft";
    expect(productInvoiceDiscount(invoice.lines).incomplete).toBe(1);
    invoice.lines[0].priceUnit = "unit";
    invoice.lines[0].unitPrice = "";
    expect(productInvoiceDiscount(invoice.lines).incomplete).toBe(1);
  });

  it("explains each selected problem and accepts an invoice-only unit correction", () => {
    const invoice = draft();
    const line = invoice.lines[0];
    line.unitPrice = "";
    line.priceUnit = "sq_ft";
    expect(productInvoiceDiscountLineIssues(line)).toEqual(["client price needed", "price and quantity units need review"]);
    line.unitPrice = "$80";
    line.priceUnit = "unit";
    expect(productInvoiceDiscountLineIssues(line)).toEqual([]);
    expect(productInvoiceDiscount(invoice.lines)).toEqual({ retail: 200, discount: 40, incomplete: 0 });
    line.selected = false;
    line.unitPrice = "";
    expect(productInvoiceDiscountLineIssues(line)).toEqual([]);
  });

  it("ignores unchecked items even when they have missing prices, quantities and mismatched units", () => {
    const invoice = draft();
    invoice.showDesignerDiscount = true;
    invoice.lines.push({ ...invoice.lines[0], sourceId: "excluded", selected: false,
      quantity: "TBD", unitPrice: "", retailUnitPrice: "", priceUnit: "sq_ft" });
    expect(productInvoiceDiscount(invoice.lines)).toEqual({ retail: 200, discount: 40, incomplete: 0 });
    expect(productInvoiceTotals(invoice).total).toBe(186);
    expect(buildProductInvoiceHtml(invoice, productInvoiceTotals(invoice))).toContain("Designer discount:</span><span>-$40.00");
  });
});
