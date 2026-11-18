import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import {
  parseInvoiceCost,
  productInvoiceProfit,
  type ProductInvoiceCostLine,
  type ProductInvoiceFee,
  type ProductInvoiceInternalCosts,
} from "@/lib/productInvoiceProfit";

export function ProductInvoiceCosts({
  invoiceId,
  subtotal,
  shipping,
  fees,
  lines,
  hasAdjustments,
}: {
  invoiceId: string;
  subtotal?: number;
  shipping?: number;
  fees: ProductInvoiceFee[];
  lines: ProductInvoiceCostLine[];
  hasAdjustments: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["productInvoiceCosts", invoiceId];
  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => db.getProductInvoiceCosts(invoiceId),
  });
  const [edit, setEdit] = useState<typeof data>(undefined);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (costs: ProductInvoiceInternalCosts) =>
      db.saveProductInvoiceCosts(invoiceId, costs, edit?.revision ?? null),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved);
      setEdit(undefined);
    },
    onError: (saveError) => {
      setError(saveError.message);
      void refetch();
    },
  });
  const profit = productInvoiceProfit({ subtotal, shipping, fees, lines, costs: data ?? null });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const shippingCost = parseInvoiceCost(String(form.get("shipping") ?? ""));
      const feeCosts: Record<string, number> = {};
      for (const fee of fees) {
        const cost = parseInvoiceCost(String(form.get(`fee-${fee.key}`) ?? ""));
        if (cost !== null) feeCosts[fee.key] = cost;
      }
      save.mutate({ shipping_cost: shippingCost, fee_costs: feeCosts });
    } catch (parseError) {
      setError((parseError as Error).message);
    }
  }

  return (
    <section aria-label="Invoice costs and profit" className="mt-4 border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Internal costs &amp; profit</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Gross profit excludes sales tax{hasAdjustments ? " and later invoice adjustments" : ""}.
          </p>
        </div>
        {edit === undefined && !isError && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEdit(data ?? null)}
            disabled={isFetching}
          >
            Edit costs
          </Button>
        )}
      </div>

      {isPending ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Loading invoice costs…
        </p>
      ) : isError && edit === undefined ? (
        <p role="status" className="mt-3 text-sm">
          Could not load invoice costs.{" "}
          <button type="button" onClick={() => void refetch()} className="underline">
            Try again
          </button>
        </p>
      ) : (
        <dl aria-live="polite" className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Billed before tax</dt>
            <dd className="mt-1">
              {profit.clientCharges === null ? "Unavailable" : formatMoney(profit.clientCharges)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Product cost</dt>
            <dd className="mt-1">
              {profit.productCost === null ? "Unavailable" : formatMoney(profit.productCost)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Total internal cost</dt>
            <dd className="mt-1">
              {profit.totalCost === null ? "Incomplete" : formatMoney(profit.totalCost)}
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              Shipping {profit.shippingCost === null ? "TBD" : formatMoney(profit.shippingCost)}
              {fees.length > 0 &&
                ` · Fees ${profit.feeCost === null ? "TBD" : formatMoney(profit.feeCost)}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Gross profit</dt>
            <dd className="mt-1 text-base font-semibold">
              {profit.grossProfit === null ? "Incomplete" : formatMoney(profit.grossProfit)}
            </dd>
          </div>
        </dl>
      )}

      {!isPending && !isError && profit.grossProfit === null && (
        <p className="mt-3 text-sm text-muted-foreground">
          {[
            profit.clientCharges === null && "This invoice is missing its saved charge breakdown.",
            !lines.length && "This invoice has no saved product cost breakdown.",
            profit.missingProducts > 0 &&
              `${profit.missingProducts} product ${profit.missingProducts === 1 ? "line needs" : "lines need"} a saved cost or quantity.`,
            data?.shipping_cost == null && "Enter your shipping cost.",
            profit.missingFees > 0 &&
              `Enter costs for ${profit.missingFees} invoice ${profit.missingFees === 1 ? "fee" : "fees"}.`,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}

      {edit !== undefined && (
        <form onSubmit={submit} className="mt-4 border-t border-border pt-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Enter what you paid. Use 0 when you had no cost.
          </p>
          <fieldset disabled={save.isPending} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">
              Our total shipping cost
              <Input
                name="shipping"
                inputMode="decimal"
                defaultValue={edit?.shipping_cost ?? ""}
                className="mt-1"
              />
            </label>
            {fees.map((fee) => (
              <label key={fee.key} className="block text-sm">
                Our cost for {fee.name}
                <Input
                  name={`fee-${fee.key}`}
                  inputMode="decimal"
                  defaultValue={edit?.fee_costs[fee.key] ?? ""}
                  className="mt-1"
                />
              </label>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save costs"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEdit(undefined);
                setError(null);
              }}
              disabled={save.isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
