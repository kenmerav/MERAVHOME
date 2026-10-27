import { describe, expect, it } from "vitest";
import { buildProductInvoiceHtml, makeProductInvoiceDraft, productInvoiceTotals } from "@/components/ProductInvoiceCreator";

function makeInvoice() {
  const draft = makeProductInvoiceDraft({ projectName: "Project", clientName: "Client", defaultTaxRate: "0", onlyApproved: false, items: [] });
  const line = { productId: null, selected: true, approvalStatus: "approved", vendor: "Vendor", category: "Furniture", imageUrl: "", productUrl: "", finish: "", dimensions: "", sku: "", quantity: "1", quantityUnit: "count" as const, unitPrice: "$10", retailUnitPrice: "$10", priceUnit: "unit" as const, unitCost: "", shipping: "" };
  draft.lines = [
    { ...line, sourceId: "a", name: "Bedroom lamp", room: "Bedroom" },
    { ...line, sourceId: "b", name: "Kitchen table", room: "Kitchen" },
    { ...line, sourceId: "c", name: "Bedroom chair", room: " bedroom " },
    { ...line, sourceId: "d", name: "Unassigned item", room: "" },
    { ...line, sourceId: "e", name: "Excluded item", room: "Bedroom", selected: false },
  ];
  return draft;
}

describe("product invoice rooms", () => {
  it("groups selected items by room and keeps unassigned items last", () => {
    const draft = makeInvoice();
    const before = structuredClone(draft);
    const totals = productInvoiceTotals(draft);
    const html = buildProductInvoiceHtml(draft, totals);
    expect(html.match(/class="room-heading"/g)).toHaveLength(3);
    const positions = ["Bedroom</div>", "Bedroom lamp", "Bedroom chair", "Kitchen</div>", "Kitchen table", "Unassigned</div>", "Unassigned item"].map((s) => html.indexOf(s));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).not.toContain("Excluded item");
    expect(html).toContain("$40.00");
    expect(draft).toEqual(before);
  });

  it("escapes room headings and handles an empty invoice", () => {
    const draft = makeInvoice();
    draft.lines = [{ ...draft.lines[0], room: "<Kitchen & Dining>" }];
    expect(buildProductInvoiceHtml(draft, productInvoiceTotals(draft))).toContain("&lt;Kitchen &amp; Dining&gt;</div>");
    draft.lines = [];
    expect(buildProductInvoiceHtml(draft, productInvoiceTotals(draft))).toContain("No products selected");
  });
});
