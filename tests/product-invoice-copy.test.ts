import { describe, expect, it } from "vitest";
import { buildProductInvoiceHtml, copyProductInvoiceDraft, makeProductInvoiceDraft, productInvoiceTotals } from "@/components/ProductInvoiceCreator";

function baseDraft() {
  return makeProductInvoiceDraft({ projectName: "Lovesy", clientName: "Client", defaultTaxRate: "8", onlyApproved: false,
    items: [{ id: "lamp", material: { client_product_name: "Current lamp", category: "Lighting", quantity: 1, quantity_unit: "count", image_url: null, color: null, product_url: null, cad_label: null, notes: null }, room_product: { product: { id: "p", name: "Lamp", category: "Lighting", vendor: null, image_url: null, price: "$150", retail_price: "$180", unit_cost: null, shipping: null, finish: null, dimensions: null, sku: null, product_url: null } } }],
  });
}

describe("starting a new invoice from a saved invoice", () => {
  it("copies only selected saved lines and preserves invoice-only price and quantity edits", () => {
    const saved = { invoiceName: "Product Invoice", taxRate: "6", notes: "Original notes", showDesignerDiscount: true, paid: "500", stripeLink: "https://buy.stripe.com/old", stripePaymentLinkId: "old", dueDate: "2026-11-01",
      lines: [
        { sourceId: "lamp", selected: true, name: "Edited lamp", room: "Bedroom", quantity: "3", quantityUnit: "count", unitPrice: "$80", retailUnitPrice: "$100", priceUnit: "unit", shipping: "$5" },
        { sourceId: "excluded", selected: false, name: "Not included", quantity: "9", unitPrice: "$99" },
      ],
    };
    const original = structuredClone(saved);
    const copied = copyProductInvoiceDraft(baseDraft(), saved);
    expect(copied.lines).toHaveLength(1);
    expect(copied.lines[0]).toMatchObject({ sourceId: "lamp", selected: true, name: "Edited lamp", quantity: "3", unitPrice: "$80", retailUnitPrice: "$100", shipping: "$5", sourceAvailable: true });
    expect(copied).toMatchObject({ invoiceName: "Product Invoice (Copy)", taxRate: "6", paid: "", stripeLink: "", stripePaymentLinkId: "", dueDate: "", showDesignerDiscount: true });
    expect(productInvoiceTotals(copied).total).toBe(269.4);
    copied.lines[0].quantity = "4";
    copied.lines[0].unitPrice = "$90";
    expect(saved).toEqual(original);
    expect(productInvoiceTotals(copied).total).toBe(401.6);
    expect(buildProductInvoiceHtml(copied, productInvoiceTotals(copied))).toContain("Edited lamp");
  });

  it("keeps saved items that no longer exist in current Procurement", () => {
    const copied = copyProductInvoiceDraft(baseDraft(), { lines: [{ sourceId: "removed", selected: true, name: "Old chair", category: "Furniture", quantity: "2", quantityUnit: "count", unitPrice: "$75" }] });
    expect(copied.lines).toHaveLength(1);
    expect(copied.lines[0]).toMatchObject({ name: "Old chair", sourceAvailable: false, unitPrice: "$75", priceUnit: "unit" });
  });

  it("recovers missing retail metadata for older invoices from the same current item", () => {
    const copied = copyProductInvoiceDraft(baseDraft(), { lines: [{ sourceId: "lamp", selected: true, name: "Saved lamp", quantity: "2", unitPrice: "$90" }] });
    expect(copied.lines[0]).toMatchObject({ name: "Saved lamp", unitPrice: "$90", retailUnitPrice: "$180", priceUnit: "unit" });
  });
});
