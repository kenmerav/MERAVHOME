import { cleanProductDetail } from "./productDetails";
import { exactProductPrice } from "./productPricing";
import { allowsMissingMaterialPrice } from "./specCompletion";
import type { MaterialItem } from "./db";
import { parseSpecQuantity, specQuantityUnitFromSelection } from "./specQuantity";
import type { RoomDesignSelection } from "./roomDesignWorkflow";
import { roomDesignTileIssues } from "./roomDesignTile";
import {
  roomItemCanOrder,
  roomItemNeedsProduct,
  roomItemInstructionIssues,
  roomItemDetailFields,
  roomDetailValue,
  roomItemStatus,
  roomDecisionIssues,
} from "./roomDesignDetails";

/** Other designers go straight from the board to approval during render testing. */
export function roomDesignStepForAccess(step: number, renderingEnabled: boolean) {
  return step === 3 && !renderingEnabled ? 4 : step;
}

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
    notes: next.notes || previous.notes,
    quantityUnit: previous.quantityUnit,
    wastePercent: previous.wastePercent,
    finish: cleanProductDetail(next.finish) || cleanProductDetail(previous.finish),
  };
}

export function productAwareQuantityUnit(category: string, productName = "") {
  if (/stair runner/i.test(category)) return "linear ft";
  if (/power/i.test(category)) return "each";
  if (/tile|terracotta|porcelain|ceramic|mosaic|wallpaper|wall covering/i.test(productName))
    return /wallpaper|wall covering/i.test(productName) ? "roll" : "sq ft";
  if (/flooring|tile|backsplash/i.test(category)) return "sq ft";
  if (/baseboard|casing|transition/i.test(category)) return "linear ft";
  if (/countertop/i.test(category)) return "slab";
  if (/wall finish|ceiling finish|vanity finish|paint/i.test(category)) return "gallon";
  if (/shower system/i.test(category)) return "set";
  return "each";
}

export type RoomDesignProductGap = {
  field: "productName" | "vendor" | "url" | "imageUrl" | "finish" | "dimensions" | "price";
  label: string;
  message: string;
};

/** Only missing purchasing information belongs in the post-gather repair callout. */
export function roomDesignProductGaps(item: RoomDesignSelection): RoomDesignProductGap[] {
  if (!roomItemNeedsProduct(item)) return [];
  const gaps: RoomDesignProductGap[] = [];
  if (!cleanProductDetail(item.productName) || / selection$/i.test(item.productName))
    gaps.push({
      field: "productName",
      label: "Product name",
      message: "Confirm the exact product name.",
    });
  if (!cleanProductDetail(item.vendor) || item.vendor === "Linked vendor")
    gaps.push({ field: "vendor", label: "Vendor", message: "Confirm the vendor." });
  if (!/^https?:\/\//i.test(item.url || ""))
    gaps.push({ field: "url", label: "Product link", message: "Add the exact product link." });
  if (!item.imageUrl)
    gaps.push({
      field: "imageUrl",
      label: "Product image",
      message: "Add the selected product image.",
    });
  if (!cleanProductDetail(item.finish))
    gaps.push({
      field: "finish",
      label: "Color / finish",
      message: "Confirm the selected color / finish.",
    });
  if (
    /vanity|mirror|tub(?! filler)|toilet(?! paper| seat)|sink(?! drain| flange)|appliance|refrigerator|range|oven|lighting|pendant|sconce|cabinet hardware/i.test(
      item.category,
    ) &&
    !/\d/.test(cleanProductDetail(item.dimensions))
  )
    gaps.push({
      field: "dimensions",
      label: "Dimensions",
      message: "Confirm the selected product dimensions.",
    });
  const pricingOptional =
    !/hardware|hooks?|towel|holder|fan|outlet|power|shelf rails|appliance|refrigerator|range|oven/i.test(
      item.category,
    ) &&
    allowsMissingMaterialPrice({
      item_label: item.category,
      product_url: item.url,
      product: { name: item.productName },
    } as MaterialItem);
  if (!pricingOptional && !exactProductPrice(item.price))
    gaps.push({
      field: "price",
      label: "Price",
      message: "Confirm the exact selected product price.",
    });
  return gaps;
}

/** Selection review is separate from room completeness and procurement readiness. */
export function roomDesignSelectionIssues(item: RoomDesignSelection): string[] {
  if (!roomItemNeedsProduct(item))
    return [
      ...roomItemInstructionIssues(item),
      ...roomDecisionIssues(item),
      ...(["By builder", "By client", "Instructions only"].includes(roomItemStatus(item))
        ? roomDesignTileIssues(item)
        : []),
    ];
  const issues: string[] = [...roomDesignTileIssues(item), ...roomDecisionIssues(item)];
  if (
    roomItemDetailFields(item.category, item).some((field) =>
      /\bTBD\b|to be (?:decided|confirmed)/i.test(roomDetailValue(item.notes, field.label)),
    )
  )
    issues.push("Resolve the remaining TBD installation details.");
  issues.push(...roomDesignProductGaps(item).map((gap) => gap.message));
  if (
    /tile|terracotta|porcelain|ceramic|mosaic/i.test(item.productName) &&
    item.quantityUnit === "gallon"
  )
    issues.push("Choose an area or selling unit for tile, rather than gallons.");
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
    roomItemCanOrder(item) &&
    item.state === "locked" &&
    item.scrapeStatus === "complete" &&
    !roomDesignSelectionIssues(item).length &&
    Boolean(cleanProductDetail(item.sku) && exactProductPrice(item.price))
  );
}
