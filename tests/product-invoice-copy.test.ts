import { describe, expect, it } from "vitest";
import { buildProductInvoiceHtml, copyProductInvoiceDraft, makeProductInvoiceDraft, productInvoiceTotals } from "@/components/ProductInvoiceCreator";

function baseDraft(shipping: string | null = null, price = "$150") {
  return makeProductInvoiceDraft({ projectName: "Lovesy", clientName: "Client", defaultTaxRate: "8", onlyApproved: false,
    items: [{ id: "lamp", material: { client_product_name: "Current lamp", category: "Lighting", quantity: 1, quantity_unit: "count", image_url: null, color: null, product_url: null, cad_label: null, notes: null }, room_product: { product: { id: "p", name: "Lamp", category: "Lighting", vendor: null, image_url: null, price, retail_price: "$180", unit_cost: "$120", shipping, finish: null, dimensions: null, sku: null, product_url: null } } }],
  });
}

describe("starting a new invoice from a saved invoice", () => {
  it("refreshes prices and shipping for selected legacy invoice lines", () => {
    const saved = { invoiceName: "Product Invoice", taxRate: "6", notes: "Original notes", showDesignerDiscount: true, paid: "500", stripeLink: "https://buy.stripe.com/old", stripePaymentLinkId: "old", dueDate: "2026-11-01",
      lines: [
        { sourceId: "lamp", productId: "p", selected: true, name: "Edited lamp", room: "Bedroom", quantity: "3", quantityUnit: "count", unitPrice: "$80", retailUnitPrice: "$100", unitCost: "$65", priceUnit: "unit", shipping: "" },
        { sourceId: "excluded", selected: false, name: "Not included", quantity: "9", unitPrice: "$99" },
      ],
    };
    const original = structuredClone(saved);
    const copied = copyProductInvoiceDraft(baseDraft("$5"), saved);
    expect(copied.lines).toHaveLength(1);
    expect(copied.lines[0]).toMatchObject({ sourceId: "lamp", selected: true, name: "Edited lamp", quantity: "3", unitPrice: "$150", retailUnitPrice: "$180", unitCost: "$120", shipping: "$5", sourceAvailable: true });
    expect(copied).toMatchObject({ invoiceName: "Product Invoice (Copy)", taxRate: "6", paid: "", stripeLink: "", stripePaymentLinkId: "", dueDate: "", showDesignerDiscount: true });
    const totals = productInvoiceTotals(copied);
    expect(totals).toMatchObject({ shipping: 15, total: 492 });
    const html = buildProductInvoiceHtml(copied, totals);
    expect(html.match(/Shipping:/g)).toHaveLength(1);
    expect(html).toContain("<span>Shipping:</span><span>$15.00</span>");
    expect(html).toContain('<div class="cell right" role="cell">$450.00</div>');
    expect(html).not.toContain("Additional items & credits");
    copied.lines[0].quantity = "4";
    copied.lines[0].unitPrice = "$90";
    expect(saved).toEqual(original);
    expect(productInvoiceTotals(copied).total).toBe(401.6);
    expect(buildProductInvoiceHtml(copied, productInvoiceTotals(copied))).toContain("Edited lamp");
  });

  it("keeps an invoice-only price while Procurement pricing is unchanged", () => {
    const saved = baseDraft("$5");
    saved.lines[0].unitPrice = "$80";
    const withNewShipping = copyProductInvoiceDraft(baseDraft("$12"), saved);
    expect(withNewShipping.lines[0]).toMatchObject({ unitPrice: "$80", shipping: "$12" });

    const repriced = copyProductInvoiceDraft(baseDraft("$12", "$160"), withNewShipping);
    expect(repriced.lines[0]).toMatchObject({ unitPrice: "$160", shipping: "$12" });
    expect(productInvoiceTotals(repriced)).toMatchObject({ subtotal: 160, shipping: 12, total: 184.8 });
  });

  it("uses the current Procurement quantity when the pricing basis changes to square feet", () => {
    const saved = baseDraft();
    const current = baseDraft("$5");
    Object.assign(current.lines[0], { unitPrice: "$10", priceUnit: "sq_ft", quantity: "25", quantityUnit: "square_feet" });
    const repriced = copyProductInvoiceDraft(current, saved);
    expect(repriced.lines[0]).toMatchObject({ unitPrice: "$10", priceUnit: "sq_ft", quantity: "25", quantityUnit: "square_feet" });
    expect(productInvoiceTotals(repriced).subtotal).toBe(250);
  });

  it.each([
    ["$12", "$12", 24],
    ["$0", "$0", 0],
    [null, "", 0],
  ])("updates an old shipping charge when current shipping is %s", (currentShipping, draftShipping, totalShipping) => {
    const copied = copyProductInvoiceDraft(baseDraft(currentShipping), { lines: [{ sourceId: "lamp", quantity: "2", unitPrice: "$90", shipping: "$5" }] });
    expect(copied.lines[0].shipping).toBe(draftShipping);
    expect(productInvoiceTotals(copied).shipping).toBe(totalShipping);
  });

  it("retains saved shipping when the same source row now has a different product", () => {
    const copied = copyProductInvoiceDraft(baseDraft("$20"), { lines: [{ sourceId: "lamp", productId: "old-p", quantity: "2", unitPrice: "$90", shipping: "$5" }] });
    expect(copied.lines[0]).toMatchObject({ productId: "old-p", shipping: "$5", sourceAvailable: false });
  });

  it("keeps saved items that no longer exist in current Procurement", () => {
    const copied = copyProductInvoiceDraft(baseDraft(), { lines: [{ sourceId: "removed", selected: true, name: "Old chair", category: "Furniture", quantity: "2", quantityUnit: "count", unitPrice: "$75" }] });
    expect(copied.lines).toHaveLength(1);
    expect(copied.lines[0]).toMatchObject({ name: "Old chair", sourceAvailable: false, unitPrice: "$75", priceUnit: "unit" });
  });

  it("recovers missing retail metadata for older invoices from the same current item", () => {
    const copied = copyProductInvoiceDraft(baseDraft(), { lines: [{ sourceId: "lamp", selected: true, name: "Saved lamp", quantity: "2", unitPrice: "$90" }] });
    expect(copied.lines[0]).toMatchObject({ name: "Saved lamp", unitPrice: "$150", retailUnitPrice: "$180", priceUnit: "unit" });
  });
});
