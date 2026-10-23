import type { MaterialItem, Room } from "./db";
import { clientProductName } from "./clientProductName";
import { materialImageUrl } from "./materialImages";
import { normalizeItemCategory } from "./roomTemplates";
import { formatMoney, moneyValue } from "./money";
import { materialPriceUnit, type ProductPriceUnit } from "./productPriceUnit";
import {
  specQuantityInput,
  specQuantityUnit,
  specOrderQuantity,
  formatSpecQuantity,
  type SpecQuantityUnit,
} from "./specQuantity";
import { cleanProductDetail } from "./productDetails";
import { projectMaterialAccuracy } from "./designAccuracyProjection";

/** One source of displayed selection data for the spreadsheet and drawing views. */
export type SpecSpreadsheetRow = {
  id: string;
  productId: string;
  roomId: string;
  room: string;
  category: string;
  imageUrl: string;
  itemLabel: string;
  cadLabel: string;
  clientProductName: string;
  productName: string;
  vendor: string;
  finish: string;
  color: string;
  quantity: string;
  quantityUnit: SpecQuantityUnit;
  wastePercent?: number;
  waste?: string;
  orderQuantity?: string;
  dimensions: string;
  sku: string;
  clientPrice: string;
  priceUnit: ProductPriceUnit | null;
  orderedBy: string;
  ordered: string;
  productUrl: string;
  notes: string;
  status: string;
};

export function specPriceLabel(value: string | number | null | undefined) {
  if (value == null || String(value).trim() === "") return null;
  const cleaned = typeof value === "number" ? String(value) : value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned) && !/^\.\d+$/.test(cleaned)) return null;
  const amount = moneyValue(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? formatMoney(amount) : null;
}

export function buildSpecSpreadsheetRows(
  items: MaterialItem[],
  rooms: Pick<Room, "id" | "name">[],
  roomById = new Map(rooms.map((room) => [room.id, room])),
): SpecSpreadsheetRow[] {
  const roomOrder = new Map(rooms.map((room, index) => [room.id, index]));
  return items
    .map(projectMaterialAccuracy)
    .filter((item) => !item.not_needed && (item.product_id || item.design_accuracy_fact) && item.product)
    .slice()
    .sort((a, b) => {
      const roomDelta = (roomOrder.get(a.room_id) ?? 9999) - (roomOrder.get(b.room_id) ?? 9999);
      if (roomDelta !== 0) return roomDelta;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })
    .map((item) => {
      const room = roomById.get(item.room_id);
      const product = item.product;
      return {
        id: item.id,
        productId: item.product_id ?? "",
        roomId: item.room_id,
        room: room?.name ?? "Unassigned",
        category: normalizeItemCategory(item.category) ?? item.category ?? "",
        imageUrl: materialImageUrl(item) ?? "",
        itemLabel: item.item_label ?? "",
        cadLabel: item.cad_label ?? "",
        clientProductName: room
          ? clientProductName(item, room)
          : item.client_product_name || product?.name || "",
        productName: product?.name ?? "",
        vendor: product?.vendor ?? "",
        finish: cleanProductDetail(product?.finish),
        color: cleanProductDetail(item.color),
        quantity: specQuantityInput(item),
        quantityUnit: specQuantityUnit(item),
        wastePercent: item.waste_percent || 0,
        waste: item.waste_percent ? `${item.waste_percent}%` : "",
        orderQuantity: item.design_accuracy_fact ? item.design_accuracy_fact.purchaseQuantity === null ? "TBD" : `${item.design_accuracy_fact.purchaseQuantity} ${item.design_accuracy_fact.purchaseUnit}` : formatSpecQuantity({ ...item, quantity: specOrderQuantity(item) }),
        dimensions: product?.dimensions ?? "",
        sku: product?.sku ?? "",
        clientPrice: item.design_accuracy_fact?.price != null ? `${specPriceLabel(item.design_accuracy_fact.price)} / ${item.design_accuracy_fact.priceUnit || "price basis not set"}` : specPriceLabel(product?.price) ?? "",
        priceUnit: materialPriceUnit(item),
        orderedBy: item.ordered_by ?? "",
        ordered: item.ordered ? "Yes" : "No",
        productUrl: item.product_url || product?.product_url || "",
        notes: item.notes ?? "",
        status: item.room_product?.approval_status === "declined" ? "Needs re-selection" : item.design_accuracy_fact ? item.design_accuracy_fact.designResolved ? "Design decisions confirmed" : "Design draft — decisions outstanding" : "",
      };
    });
}

export function specProductHref(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!/\s/.test(trimmed) && /^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed))
    return `https://${trimmed}`;
  return null;
}
