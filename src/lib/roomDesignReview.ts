import { cleanProductDetail } from "./productDetails";
import { exactProductPrice } from "./productPricing";
import { parseSpecQuantity, specQuantityUnitFromSelection } from "./specQuantity";
import type { RoomDesignSelection } from "./roomDesignWorkflow";

/** Refreshing the same link must not reset the designer's measurement decisions. */
export function retainRoomDesignMeasurements<T extends RoomDesignSelection>(
  next: T,
  previous?: RoomDesignSelection,
): T {
  if (
    !previous ||
    next.url !== previous.url ||
    (next.productId && previous.productId && next.productId !== previous.productId)
  )
    return next;
  return {
    ...next,
    quantityUnit: previous.quantityUnit,
    wastePercent: previous.wastePercent,
    finish: cleanProductDetail(next.finish) || cleanProductDetail(previous.finish),
  };
}

export function productAwareQuantityUnit(category: string, productName = "") {
  if (/tile|terracotta|porcelain|ceramic|mosaic|wallpaper|wall covering/i.test(productName))
    return /wallpaper|wall covering/i.test(productName) ? "roll" : "sq ft";
  if (/flooring|tile|backsplash/i.test(category)) return "sq ft";
  if (/baseboard|casing|transition/i.test(category)) return "linear ft";
  if (/countertop/i.test(category)) return "slab";
  if (/wall finish|ceiling finish|vanity finish|paint/i.test(category)) return "gallon";
  if (/shower system/i.test(category)) return "set";
  return "each";
}

/** Selection review is separate from room completeness and procurement readiness. */
export function roomDesignSelectionIssues(item: RoomDesignSelection): string[] {
  const issues: string[] = [];
  if (!cleanProductDetail(item.productName) || / selection$/i.test(item.productName))
    issues.push("Confirm the exact product name.");
  if (!cleanProductDetail(item.vendor) || item.vendor === "Linked vendor")
    issues.push("Confirm the vendor.");
  if (!/^https?:\/\//i.test(item.url || "")) issues.push("Add the exact product link.");
  if (!item.imageUrl) issues.push("Add the selected product image.");
  if (!cleanProductDetail(item.finish)) issues.push("Confirm the selected color / finish.");
  if (
    /tile|terracotta|porcelain|ceramic|mosaic/i.test(item.productName) &&
    item.quantityUnit === "gallon"
  )
    issues.push("Choose an area or selling unit for tile, rather than gallons.");
  if (
    /vanity|mirror|tub(?! filler)|toilet(?! paper| seat)|sink(?! drain| flange)|appliance|refrigerator|range|oven|lighting|pendant|sconce|cabinet hardware/i.test(
      item.category,
    ) &&
    !/\d/.test(cleanProductDetail(item.dimensions))
  )
    issues.push("Confirm the selected product dimensions.");
  if (item.quantity == null) issues.push("Confirm quantity (currently TBD).");
  else {
    try {
      parseSpecQuantity(
        String(item.quantity),
        specQuantityUnitFromSelection(item.quantityUnit),
        item.wastePercent,
      );
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Check quantity and measurement.");
    }
  }
  return issues;
}

export function roomDesignOrderReady(item: RoomDesignSelection) {
  return (
    item.state === "locked" &&
    item.scrapeStatus === "complete" &&
    !roomDesignSelectionIssues(item).length &&
    Boolean(cleanProductDetail(item.sku) && exactProductPrice(item.price))
  );
}
