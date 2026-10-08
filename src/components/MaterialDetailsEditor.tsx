import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { type MaterialItem, type Product } from "@/lib/db";
import { saveMaterialProductDetails } from "@/lib/materialProductEdit";
import { CATALOG_NAME_PENDING_NOTE } from "@/lib/catalogProductName";
import { productPricingPatch, type ProductPricingDraft } from "@/lib/productPricingEdit";
import { clientPriceFromMarkup, formatMoney } from "@/lib/money";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatPriceWithUnit, productPriceUnit } from "@/lib/productPriceUnit";
import { withSavedMaterialProduct } from "@/lib/materialPricingCache";

function draftFor(item: MaterialItem) {
  const p = item.product;
  return {
    name: p?.name || item.item_label,
    vendor: p?.vendor || "",
    sku: p?.sku || "",
    finish: p?.finish || "",
    dimensions: p?.dimensions || "",
    price: p?.price || "",
    price_unit: productPriceUnit(p?.price_unit) || ("" as const),
    retail_price: p?.retail_price || "",
    unit_cost: p?.unit_cost || "",
    markup_percent: p?.markup_percent?.toString() ?? "",
    markup_basis: p?.markup_basis || ("retail_price" as ProductPricingDraft["markup_basis"]),
    shipping: p?.shipping || "",
  };
}

export function MaterialDetailsEditor({
  item,
  trigger = "details",
}: {
  item: MaterialItem;
  trigger?: "details" | "price";
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => draftFor(item));
  const [initial, setInitial] = useState(draft);
  const calculated = clientPriceFromMarkup({
    retailPrice: draft.retail_price,
    ourPrice: draft.unit_cost,
    markupPercent: draft.markup_percent,
    markupBasis: draft.markup_basis,
  });
  const set = (key: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      const patch: Partial<Product> = {};
      for (const key of ["name", "vendor", "sku", "finish", "dimensions"] as const) {
        if (draft[key] !== initial[key]) {
          if (key === "name" && !draft.name.trim()) throw new Error("Enter a product name.");
          (patch as Record<string, unknown>)[key] = draft[key].trim() || null;
        }
      }
      if (
        "name" in patch &&
        (!item.product || item.product.notes?.includes(CATALOG_NAME_PENDING_NOTE))
      )
        patch.notes = item.product?.notes?.replace(CATALOG_NAME_PENDING_NOTE, "").trim() || null;
      const pricingKeys = [
        "price",
        "retail_price",
        "unit_cost",
        "markup_percent",
        "markup_basis",
        "shipping",
        "price_unit",
      ] as const;
      if (pricingKeys.some((key) => draft[key] !== initial[key])) {
        const amountChanged = (["price", "retail_price", "unit_cost"] as const)
          .some((key) => draft[key] !== initial[key]);
        const hasAmount = [draft.price, draft.retail_price, draft.unit_cost]
          .some((value) => value.trim() !== "");
        if (amountChanged && hasAmount && !productPriceUnit(draft.price_unit))
          throw new Error("Choose whether the price is per unit or per square foot.");
        Object.assign(patch, productPricingPatch(draft, initial));
      }
      if (Object.keys(patch).length > 0) {
        const productId = await saveMaterialProductDetails(item.id, patch);
        const { data: saved, error: readError } = await supabase
          .from("products")
          .select("*")
          .eq("id", productId)
          .single();
        if (readError || !saved)
          throw new Error("Details were saved, but could not be refreshed. Reopen this item to check the saved price.");
        const savedProduct = saved as unknown as Product;
        await qc.cancelQueries({ queryKey: ["materialItems", item.project_id] });
        qc.setQueriesData<MaterialItem[]>(
          { queryKey: ["materialItems", item.project_id] },
          (current) => withSavedMaterialProduct(current, item.id, savedProduct),
        );
        qc.setQueryData(["product", productId], savedProduct);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["materialItems", item.project_id] }),
          qc.invalidateQueries({ queryKey: ["procurement"] }),
          qc.invalidateQueries({ queryKey: ["catalog"] }),
          qc.invalidateQueries({ queryKey: ["products"] }),
          qc.invalidateQueries({ queryKey: ["product", productId] }),
          qc.invalidateQueries({ queryKey: ["roomProducts", item.room_id] }),
        ]);
        toast.success(`Details saved for ${item.item_label}`);
      }
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the details. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (next) {
          const current = draftFor(item);
          setDraft(current);
          setInitial(current);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Edit ${trigger === "price" ? "price" : "details"} for ${item.item_label}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-ink"
        >
          {trigger === "price" ? (
            formatPriceWithUnit(item.product?.price, item.product?.price_unit) || "Add price"
          ) : (
            <>
              <Pencil className="h-3 w-3" /> Edit details
            </>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">
            {item.client_product_name || item.item_label}
          </DialogTitle>
        </DialogHeader>
        <fieldset disabled={saving} className="min-w-0 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(
            [
              ["name", "Product name"],
              ["vendor", "Vendor / brand"],
              ["sku", "SKU / model number"],
              ["finish", "Finish"],
              ["dimensions", "Dimensions"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={key === "dimensions" ? "sm:col-span-2" : ""}>
              <span className="eyebrow mb-1.5 block">{label}</span>
              <Input value={draft[key]} onChange={(event) => set(key, event.target.value)} />
            </label>
          ))}
        </div>
        <div className="mt-2 border-t border-border pt-4">
          <div className="eyebrow mb-3">Pricing</div>
          <label className="mb-4 block">
            <span className="eyebrow mb-1.5 block">Price is per</span>
            <select
              aria-label="Price basis"
              className="h-10 w-full border border-input bg-background px-3 text-sm"
              value={draft.price_unit}
              onChange={(event) => set("price_unit", event.target.value)}
            >
              <option value="">Not set — choose a price basis</option>
              <option value="unit">Per unit (each, sheet, set, or box)</option>
              <option value="sq_ft">Per square foot (sq ft)</option>
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">
              Applies to display price, retail price, and cost. Does not change quantities or shipping.
              For per-unit pricing, confirm whether one unit means one item, sheet, set, or box.
            </span>
            {draft.price_unit === "sq_ft" && item.quantity_unit !== "square_feet" && (
              <span className="mt-1 block text-xs text-amber-800">
                The quantity is not in square feet. Confirm the quantity and any coverage conversion before budgeting or ordering.
              </span>
            )}
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(
              [
                ["retail_price", "Retail price"],
                ["unit_cost", "Our price / cost"],
                ["shipping", "Shipping"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <span className="eyebrow mb-1.5 block">{label}</span>
                <Input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={draft[key]}
                  onChange={(event) => set(key, event.target.value)}
                />
              </label>
            ))}
            <label>
              <span className="eyebrow mb-1.5 block">Markup based on</span>
              <select
                className="h-10 w-full border border-input bg-background px-3 text-sm"
                value={draft.markup_basis}
                onChange={(event) => set("markup_basis", event.target.value)}
              >
                <option value="retail_price">Retail price</option>
                <option value="our_price">Our price</option>
              </select>
            </label>
            <label>
              <span className="eyebrow mb-1.5 block">Markup % (optional)</span>
              <Input
                inputMode="decimal"
                value={draft.markup_percent}
                onChange={(event) => set("markup_percent", event.target.value)}
              />
            </label>
            <label>
              <span className="eyebrow mb-1.5 block">Display price — Materials &amp; Spec Book</span>
              <Input
                inputMode="decimal"
                placeholder="0.00"
                readOnly={calculated != null}
                value={calculated == null ? draft.price : formatMoney(calculated)}
                onChange={(event) => set("price", event.target.value)}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {calculated == null
                  ? "For a new blank display price, Retail price is used automatically. Existing display prices are kept. Our cost is never used automatically."
                  : "Calculated from the base price and markup. Clear markup to enter a price directly."}
              </span>
            </label>
          </div>
        </div>
        </fieldset>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => setOpen(false)}
            className="h-10 border border-border px-4 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="h-10 bg-ink px-4 text-sm text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save details"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
