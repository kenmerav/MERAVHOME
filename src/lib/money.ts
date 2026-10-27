import { specOrderQuantity, specQuantityUnit } from "./specQuantity";
import { materialPriceUnit } from "./productPriceUnit";

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

export function isKnownPrice(value: unknown) {
  return typeof value === "number"
    ? Number.isFinite(value) && value >= 0
    : typeof value === "string" &&
      /^\s*\$?\s*(?:\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?:\/\s*(?:sq\.?\s*ft\.?|square\s+(?:foot|feet)|sf|each|item|unit|sheet|piece|set|box|carton|case|roll|gallon))?\s*$/i.test(value);
}

/** A blank retail price means the client pays retail; an invalid entered price stays invalid. */
export function retailPriceOrClient(retail: string | number | null | undefined, client: string | number | null | undefined) {
  return retail == null || (typeof retail === "string" && !retail.trim()) ? client : retail;
}

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

export function procurementTotals(
  items: any[],
  taxRate: string | number = 0,
  options: { unknownAsZero?: boolean } = {},
) {
  const contribution = (value: number) =>
    options.unknownAsZero && !Number.isFinite(value) ? 0 : value;
  const money = items.reduce(
    (sum, item) => {
      const product = item.room_product?.product;
      const material = item.material as {
        quantity?: number | null;
        quantity_tbd?: boolean;
        quantity_unit?: import("./specQuantity").SpecQuantityUnit;
        selection_quantity_unit?: import("./specQuantity").SpecQuantityUnit | null;
        waste_percent?: number;
        design_accuracy_fact?: import("./designAccuracy").AccuracyOutput | null;
      } | null;
      const fact = material?.design_accuracy_fact;
      const quantity = fact
        ? fact.purchaseReady
          ? fact.purchaseQuantity
          : null
        : material?.quantity_tbd
          ? null
          : material
            ? specOrderQuantity({ ...material, quantity: material.quantity ?? null })
            : null;
      const qty =
        typeof quantity === "number" && Number.isFinite(quantity) && quantity >= 0
          ? quantity
          : Number.NaN;
      const priceUnit = material ? materialPriceUnit({ ...material, product }) : null;
      const quantityUnit = material
        ? specQuantityUnit({ ...material, quantity: material.quantity ?? null })
        : null;
      const incompatibleUnit = fact
        ? !fact.priceUnit || fact.priceUnit !== fact.purchaseUnit
        : (priceUnit === "sq_ft" && quantityUnit !== "square_feet") ||
          (priceUnit === "unit" && quantityUnit === "square_feet");
      const clientPrice = fact ? fact.price : product?.price;
      const missingPrice = qty !== 0 && !isKnownPrice(clientPrice);
      const missingCost = qty !== 0 && !isKnownPrice(product?.unit_cost);
      const retailPrice = retailPriceOrClient(product?.retail_price, clientPrice);
      const missingRetail = qty !== 0 && !isKnownPrice(retailPrice);
      const comparable = Number.isFinite(qty) && !incompatibleUnit && !missingPrice && !missingRetail;
      return {
        client:
          sum.client +
          contribution(missingPrice || incompatibleUnit ? Number.NaN : moneyValue(clientPrice) * qty),
        cost:
          sum.cost +
          contribution(missingCost || incompatibleUnit ? Number.NaN : moneyValue(product?.unit_cost) * qty),
        shipping: sum.shipping + contribution(moneyValue(product?.shipping) * qty),
        retail: sum.retail + contribution(missingRetail || incompatibleUnit ? Number.NaN : moneyValue(retailPrice) * qty),
        discount: sum.discount + (comparable ? (moneyValue(retailPrice) - moneyValue(clientPrice)) * qty : 0),
        missingRetailPrices: sum.missingRetailPrices + (missingRetail ? 1 : 0),
        unknownQuantities: sum.unknownQuantities + (Number.isFinite(qty) ? 0 : 1),
        missingPrices: sum.missingPrices + (missingPrice ? 1 : 0),
        missingCosts: sum.missingCosts + (missingCost ? 1 : 0),
        incompatibleUnits: sum.incompatibleUnits + (incompatibleUnit ? 1 : 0),
      };
    },
    {
      client: 0,
      cost: 0,
      shipping: 0,
      retail: 0,
      discount: 0,
      missingRetailPrices: 0,
      unknownQuantities: 0,
      missingPrices: 0,
      missingCosts: 0,
      incompatibleUnits: 0,
    },
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
