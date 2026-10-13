import { hasCompletionValue } from "@/lib/specCompletion";
import { productPriceUnit, type ProductPriceUnit } from "@/lib/productPriceUnit";

export type CompletionDetailDraft = { value: string; priceUnit?: ProductPriceUnit | "" };
export function completionDetailValue(field: string, draft: CompletionDetailDraft) {
  const value = draft.value.trim();
  if (field === "color" || field === "finish") {
    if (!hasCompletionValue(value) || value.length > 200) throw new Error("Enter a confirmed color / finish.");
    return { color: value };
  }
  if (field !== "price" && field !== "price_unit") throw new Error("This detail cannot be edited here.");
  const number = value.replace(/[$,\s]/g, "");
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(number) || !Number.isFinite(Number(number)))
    throw new Error("Enter a valid price, such as 125.00.");
  const unit = productPriceUnit(draft.priceUnit);
  if (!unit) throw new Error("Choose whether the price is per item or per square foot.");
  return { price: `$${Number(number).toFixed(2)}`, price_unit: unit };
}
