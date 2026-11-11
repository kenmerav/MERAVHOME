import { formatMoney, moneyValue } from "./money";
import { calculateProcurementOrderQuantity } from "./procurementCart";
import { cleanProductDetail } from "./productDetails";
import { exactProductPrice } from "./productPricing";
import { roomDetailValue, updateRoomDetail } from "./roomDesignDetails";
import { roomDesignTileSurface, updateRoomDesignTileNotes } from "./roomDesignTile";
import {
  parseSpecQuantity,
  selectionQuantityUnitFromSpec,
  specQuantityUnitFromSelection,
} from "./specQuantity";
import type { RoomDesignSelection } from "./roomDesignWorkflow";

const TILE_FIELDS = [
  "location",
  "layout",
  "direction",
  "groutColor",
  "jointWidth",
  "edgeTreatment",
  "edgeProduct",
  "edgeFinish",
  "edgeSize",
] as const;
export const EXTENSION_SELLING_UNITS = [
  "each",
  "sq ft",
  "linear ft",
  "pair",
  "set",
  "box",
  "carton",
  "slab",
  "roll",
  "gallon",
  "sheet",
];
export const EXTENSION_PRICE_TYPES = ["Retail", "Trade", "Vendor quote"];
const text = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 500) : "";
const object = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const choice = (value: unknown, options: string[]) =>
  options.includes(text(value)) ? text(value) : "";
const number = (value: unknown, max: number, min = 0) =>
  (typeof value === "number" || /^\d+(?:\.\d{1,4})?$/.test(text(value))) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= min &&
  Number(value) <= max
    ? Number(value)
    : undefined;
const webUrl = (value: unknown) => {
  try {
    const url = new URL(text(value));
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
};
const known = (value?: string) => Boolean(cleanProductDetail(value));

export function extensionPurchaseDetails(value: unknown) {
  const details = object(value);
  return {
    unitPrice: exactProductPrice(details.unitPrice),
    priceUnit: choice(details.priceUnit, EXTENSION_SELLING_UNITS),
    sellingUnit: choice(details.sellingUnit, EXTENSION_SELLING_UNITS),
    priceType: choice(details.priceType, EXTENSION_PRICE_TYPES),
    priceSource: text(details.priceSource),
    availability: text(details.availability),
    minimumOrder: number(details.minimumOrder, 1_000_000_000_000, 0.0001),
    specSheet: webUrl(details.specSheet),
    coverage: number(details.coverage, 1_000_000, 0.0001),
    checkedAt: /^\d{4}-\d{2}-\d{2}T/.test(text(details.checkedAt)) ? text(details.checkedAt) : "",
  };
}

export type ExtensionPurchaseDetails = ReturnType<typeof extensionPurchaseDetails>;

export function parseExtensionSelectionReview(value: unknown, quantity: number | null) {
  const review = object(value);
  const quantityUnit = selectionQuantityUnitFromSpec(text(review.quantityUnit));
  if (quantityUnit !== review.quantityUnit) throw new Error("Choose a valid quantity unit.");
  const wastePercent = number(review.wastePercent, 100);
  if (
    (text(review.wastePercent) || typeof review.wastePercent === "number") &&
    wastePercent === undefined
  )
    throw new Error("Waste must be between 0 and 100 percent.");
  parseSpecQuantity(
    String(quantity ?? "TBD"),
    specQuantityUnitFromSelection(quantityUnit),
    wastePercent,
  );
  const tile = object(review.tile);
  const purchaseInput = object(review.purchase);
  const purchase = extensionPurchaseDetails({ ...purchaseInput, checkedAt: "" });
  if (text(purchaseInput.minimumOrder) && purchase.minimumOrder === undefined)
    throw new Error("Enter the minimum order as a positive quantity in the selling unit.");
  return {
    quantityUnit,
    wastePercent,
    confirmed: review.confirmed === true,
    installationLocation: text(review.installationLocation),
    surface: choice(review.surface, ["Tile", "Other material"]),
    purchase,
    tile: review.tile
      ? ({
          ...Object.fromEntries(TILE_FIELDS.map((key) => [key, text(tile[key])])),
          groutProduct: text(tile.groutProduct),
          suitability: text(tile.suitability),
          installationNotes: text(tile.installationNotes),
          sample: text(tile.sample),
        } as Record<
          | (typeof TILE_FIELDS)[number]
          | "groutProduct"
          | "suitability"
          | "installationNotes"
          | "sample",
          string
        >)
      : undefined,
  };
}

export type ExtensionSelectionReview = ReturnType<typeof parseExtensionSelectionReview>;

export function applyExtensionTileReview(
  notes: string,
  tile: NonNullable<ExtensionSelectionReview["tile"]>,
) {
  notes = updateRoomDesignTileNotes(notes, "surface", "Tile");
  for (const key of TILE_FIELDS) notes = updateRoomDesignTileNotes(notes, key, tile[key]);
  notes = updateRoomDetail(notes, "Grout product", tile.groutProduct);
  notes = updateRoomDetail(notes, "Manufacturer-listed tile use", tile.suitability);
  notes = updateRoomDetail(notes, "Installation notes", tile.installationNotes);
  return updateRoomDetail(notes, "Tile sample / lot", tile.sample);
}

export function extensionSelectionIssues(item: RoomDesignSelection) {
  const details = item.extensionPurchase;
  if (!details) return [];
  const issues: string[] = [];
  if (!known(item.sku)) issues.push("Confirm the SKU / model.");
  if (!known(item.finish)) issues.push("Confirm the exact color / finish.");
  if (!known(item.dimensions)) issues.push("Confirm the selected dimensions.");
  if (!known(item.manufacturer)) issues.push("Confirm the manufacturer.");
  if (!details.unitPrice || !details.priceUnit || !details.priceType || !known(details.priceSource))
    issues.push("Confirm the price, price unit, price type and source.");
  if (!details.sellingUnit) issues.push("Confirm the selling unit.");
  if (!known(details.availability)) issues.push("Confirm availability or lead time.");
  if (item.quantity === 0) issues.push("Confirm a positive quantity or leave it TBD.");
  if (roomDesignTileSurface(item) === "tile") {
    const has = (label: string) => known(roomDetailValue(item.notes, label));
    if (!has("Grout product")) issues.push("Confirm the grout brand and product.");
    if (!has("Tile edge treatment")) issues.push("Confirm the tile edge treatment.");
    if (
      roomDetailValue(item.notes, "Tile edge treatment") === "Other" &&
      !has("Tile edge product / profile") &&
      !has("Installation notes")
    )
      issues.push("Describe the tile edge treatment.");
    if (
      !has("Manufacturer-listed tile use") ||
      /\b(?:not|no longer)\s+(?:listed|approved|suitable|rated)\b/i.test(
        roomDetailValue(item.notes, "Manufacturer-listed tile use"),
      )
    )
      issues.push("Verify that the manufacturer lists this tile for the intended use.");
    if (item.quantityUnit === "sq ft" && ["box", "carton", "sheet"].includes(details.sellingUnit)) {
      if (!details.coverage) issues.push("Confirm square feet per selling unit.");
      if (item.wastePercent === undefined) issues.push("Confirm the tile waste percentage.");
    }
  }
  return issues;
}

export function extensionOrderEstimate(item: RoomDesignSelection) {
  const purchase = item.extensionPurchase;
  if (!purchase || item.quantity == null || !purchase.sellingUnit) return null;
  const { coverage, sellingUnit, priceUnit, unitPrice, minimumOrder } = purchase;
  const orderUnit = sellingUnit;
  const wholeUnits = ["each", "pair", "set", "box", "carton", "slab", "sheet"].includes(
    sellingUnit,
  );
  let orderQuantity = item.quantity;
  if (["box", "carton", "sheet"].includes(sellingUnit) && item.quantityUnit === "sq ft") {
    if (!coverage || item.wastePercent === undefined) return null;
    const order = calculateProcurementOrderQuantity({
      quantity: item.quantity,
      quantityUnit: "square_feet",
      cartonCoverageSquareFeet: coverage,
      wastePercentage: item.wastePercent,
    });
    orderQuantity = order.quantity;
  } else if (
    item.quantityUnit === sellingUnit ||
    (["box", "carton"].includes(sellingUnit) && ["box", "carton"].includes(item.quantityUnit || ""))
  ) {
    orderQuantity *= 1 + (item.wastePercent || 0) / 100;
  } else {
    return null;
  }
  orderQuantity = Math.max(orderQuantity, minimumOrder || 0);
  if (wholeUnits) orderQuantity = Math.ceil(Number(orderQuantity.toPrecision(15)));
  const area =
    sellingUnit === "sq ft"
      ? orderQuantity
      : ["box", "carton", "sheet"].includes(sellingUnit) && coverage
        ? orderQuantity * coverage
        : null;
  const samePackaging =
    ["box", "carton"].includes(priceUnit) && ["box", "carton"].includes(orderUnit);
  const pricedQuantity =
    priceUnit === "sq ft" ? area : priceUnit === orderUnit || samePackaging ? orderQuantity : null;
  return {
    quantity: Number(orderQuantity.toFixed(4)),
    unit: orderUnit,
    total:
      unitPrice && pricedQuantity !== null
        ? formatMoney(pricedQuantity * moneyValue(unitPrice))
        : "",
  };
}
