import { z } from "zod";
import { calculateProcurementOrderQuantity, type ProcurementSnapshot } from "@/lib/procurementCart";

export const verifiedCartPricingSchema = z
  .object({
    cart_verified: z.literal(true),
    currency: z.literal("USD"),
    retail_unit_price: z.number().finite().nonnegative(),
    retail_price_unit: z.enum(["pieces", "boxes", "square_feet"]),
    retail_price_url: z.string().url(),
    cart_unit_price: z.number().finite().nonnegative(),
    cart_price_unit: z.enum(["pieces", "boxes"]),
    cart_quantity: z.number().finite().positive(),
    cart_url: z.string().url(),
    evidence: z.string().trim().min(1).max(1200),
  })
  .strict();
export type VerifiedCartPricing = z.infer<typeof verifiedCartPricingSchema>;

function retailerHost(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("Invalid pricing source URL.");
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export function verifiedProductPrices(item: ProcurementSnapshot, input: VerifiedCartPricing) {
  const pricing = verifiedCartPricingSchema.parse(input);
  const host = retailerHost(item.product_url);
  if (retailerHost(pricing.cart_url) !== host || retailerHost(pricing.retail_price_url) !== host)
    throw new Error("Pricing evidence must come from this item's retailer.");
  const unit = item.requested_options.quantity_unit ?? "pieces";
  const coverage = item.requested_options.carton_coverage_sq_ft;
  const order = calculateProcurementOrderQuantity({
    quantity: item.requested_quantity,
    quantityUnit: unit,
    cartonCoverageSquareFeet: coverage,
    wastePercentage: item.requested_options.waste_percentage,
  });
  if (pricing.cart_quantity !== order.quantity || pricing.cart_price_unit !== order.unit)
    throw new Error("Verify the exact cart quantity and selling unit before updating prices.");
  const convert = (amount: number, from: string) => {
    if (from === unit) return amount;
    if (coverage && coverage > 0) {
      if (from === "boxes" && unit === "square_feet") return amount / coverage;
      if (from === "square_feet" && unit === "boxes") return amount * coverage;
    }
    throw new Error("The retailer price unit cannot be matched to the Spec Book price unit.");
  };
  // Preserve four decimals for area pricing; monetary totals are rounded by invoicing.
  const retail = Number(convert(pricing.retail_unit_price, pricing.retail_price_unit).toFixed(4));
  const cost = Number(convert(pricing.cart_unit_price, pricing.cart_price_unit).toFixed(4));
  return { retail, cost, unit, pricing };
}

export type CartPricingSync = {
  state: "pending" | "synced" | "needs_review";
  retail?: number;
  cost?: number;
  unit?: string;
  previous_retail?: string | null;
  previous_cost?: string | null;
  message: string;
  verified_pricing?: VerifiedCartPricing;
};

export function cartPricingSync(options: Record<string, unknown>): CartPricingSync | null {
  const value = options.cart_pricing as CartPricingSync | undefined;
  return value && ["pending", "synced", "needs_review"].includes(value.state) ? value : null;
}
