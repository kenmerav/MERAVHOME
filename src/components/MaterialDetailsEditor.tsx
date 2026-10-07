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

function draftFor(item: MaterialItem) {
  const p = item.product;
  return {
    name: p?.name || item.item_label,
    vendor: p?.vendor || "",
    sku: p?.sku || "",
    finish: p?.finish || "",
    dimensions: p?.dimensions || "",
    price: p?.price || "",
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
      ] as const;
      if (pricingKeys.some((key) => draft[key] !== initial[key]))
        Object.assign(patch, productPricingPatch(draft, initial));
      if (Object.keys(patch).length > 0) {
        const productId = await saveMaterialProductDetails(item.id, patch);
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
            item.product?.price || "Add price"
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
              <span className="eyebrow mb-1.5 block">Price</span>
              <Input
                inputMode="decimal"
                placeholder="0.00"
                readOnly={calculated != null}
                value={calculated == null ? draft.price : formatMoney(calculated)}
                onChange={(event) => set("price", event.target.value)}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {calculated == null
                  ? "Enter the price directly, or add a base price and markup."
                  : "Calculated from the base price and markup. Clear markup to enter a price directly."}
              </span>
            </label>
          </div>
        </div>
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
