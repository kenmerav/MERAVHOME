import type { MaterialItem } from "@/lib/db";

export function materialImageUrl(item?: MaterialItem | null) {
  return item?.image_url || item?.product?.image_url || null;
}
