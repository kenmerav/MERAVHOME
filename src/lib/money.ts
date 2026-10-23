export function moneyValue(value?: string | number | null) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "TBD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function normalizeMoneyInput(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("$")) return trimmed;
  if (trimmed.startsWith("-")) return `-$${trimmed.slice(1).trim()}`;
  return `$${trimmed}`;
}

export type MarkupBasis = "retail_price" | "our_price";

export function clientPriceFromMarkup({
  retailPrice,
  ourPrice,
  markupPercent,
  markupBasis,
}: {
  retailPrice?: string | number | null;
  ourPrice?: string | number | null;
  markupPercent?: string | number | null;
  markupBasis: MarkupBasis;
}) {
  const rawBase = markupBasis === "retail_price" ? retailPrice : ourPrice;
  if (rawBase == null || (typeof rawBase === "string" && !rawBase.trim())) return null;
  if (markupPercent == null || (typeof markupPercent === "string" && !markupPercent.trim()))
    return null;

  const base = moneyValue(rawBase);
  const percent = typeof markupPercent === "number" ? markupPercent : Number(markupPercent.trim());
  if (!Number.isFinite(base) || !Number.isFinite(percent)) return null;

  return Math.round(base * (1 + percent / 100) * 100) / 100;
}

export function procurementTotals(items: any[], taxRate: string | number = 0) {
  const money = items.reduce(
    (sum, item) => {
      const product = item.room_product?.product;
      const material = item.material as {
        quantity?: number | null;
        quantity_tbd?: boolean;
        design_accuracy_fact?: import("./designAccuracy").AccuracyOutput | null;
      } | null;
      const fact = material?.design_accuracy_fact;
      const quantity = fact
        ? fact.purchaseReady
          ? fact.purchaseQuantity
          : null
        : material?.quantity_tbd
          ? null
          : material?.quantity;
      const qty =
        typeof quantity === "number" && Number.isFinite(quantity) && quantity >= 0
          ? quantity
          : Number.NaN;
      return {
        client: sum.client + moneyValue(product?.price) * qty,
        cost: sum.cost + moneyValue(product?.unit_cost) * qty,
        shipping: sum.shipping + moneyValue(product?.shipping) * qty,
        unknownQuantities: sum.unknownQuantities + (Number.isFinite(qty) ? 0 : 1),
      };
    },
    { client: 0, cost: 0, shipping: 0, unknownQuantities: 0 },
  );
  const subtotal = money.client;
  const tax = subtotal * ((Number(taxRate) || 0) / 100);
  const total = subtotal + tax + money.shipping;
  return {
    ...money,
    subtotal,
    tax,
    total,
    profit: subtotal - money.cost,
  };
}
