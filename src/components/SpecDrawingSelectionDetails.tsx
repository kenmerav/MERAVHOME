import { ArrowUpRight } from "lucide-react";
import type { SpecSpreadsheetRow } from "@/lib/specBookRows";
import { specProductHref } from "@/lib/specBookRows";
import { formatPriceWithUnit } from "@/lib/productPriceUnit";
import { specQuantityUnitLabel } from "@/lib/specQuantity";

export type DrawingSpecVisibility = {
  showPricing: boolean;
  showLinks: boolean;
  showOrdering: boolean;
  hideInternalProductDetails: boolean;
};

/** The original spreadsheet row, with the same role visibility, above the drawings. */
export function SpecDrawingSelectionDetails({
  row,
  visibility,
}: {
  row: SpecSpreadsheetRow;
  visibility: DrawingSpecVisibility;
}) {
  const fields = [
    ["Room", row.room],
    ["Category", row.category],
    ["Item", row.itemLabel],
    ["CAD", row.cadLabel],
    ["Qty", row.quantity],
    ["Unit", specQuantityUnitLabel(row.quantityUnit)],
    ["Waste / order", row.waste || ""],
    ["Finish", row.finish],
    ["Color", row.color],
    ["Dimensions", row.dimensions],
    ["Vendor", row.vendor],
    ...(!visibility.hideInternalProductDetails
      ? [
          ["Product Name", row.productName],
          ["SKU", row.sku],
        ]
      : []),
    ...(visibility.showPricing
      ? [["Price", formatPriceWithUnit(row.clientPrice, row.priceUnit)]]
      : []),
    ...(visibility.showOrdering
      ? [
          ["Ordered By", row.orderedBy],
          ["Ordered", row.ordered],
        ]
      : []),
    ...(!visibility.hideInternalProductDetails && row.status ? [["Status", row.status]] : []),
  ];
  const href = specProductHref(row.productUrl);
  return (
    <div className="px-5 pb-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 text-sm lg:grid-cols-4">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {label}
            </dt>
            <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value || "—"}</dd>
          </div>
        ))}
      </dl>
      {visibility.showLinks && row.productUrl && (
        <div className="mt-5 min-w-0 text-sm">
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Product link
          </div>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-start gap-1 underline [overflow-wrap:anywhere]"
            >
              {row.productUrl}
              <ArrowUpRight size={14} className="mt-0.5 shrink-0" />
            </a>
          ) : (
            <span className="[overflow-wrap:anywhere]">{row.productUrl}</span>
          )}
        </div>
      )}
      {row.notes && (
        <div className="mt-5 text-sm">
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Notes
          </div>
          <p className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
            {row.notes}
          </p>
        </div>
      )}
    </div>
  );
}
