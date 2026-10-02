import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatSpecQuantity, parseSpecQuantity, specQuantityInput, specQuantityUnit,
  specQuantityUnitLabel, type SpecQuantity, type SpecQuantityPatch, type SpecQuantityUnit,
} from "@/lib/specQuantity";

export function SpecQuantityEditor({ item, label, disabled, onSave, display = "combined", className = "" }: {
  item: SpecQuantity;
  label: string;
  disabled?: boolean;
  onSave: (patch: SpecQuantityPatch) => Promise<void>;
  display?: "combined" | "quantity" | "unit";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const [draft, setDraft] = useState("");
  const [unit, setUnit] = useState<SpecQuantityUnit>("count");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const value = display === "unit" ? specQuantityUnitLabel(specQuantityUnit(item))
    : display === "quantity" ? specQuantityInput(item) : formatSpecQuantity(item);

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      await onSave(parseSpecQuantity(draft, unit));
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save quantity. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (disabled) return <span className={className}>{value || "—"}</span>;
  return <>
    <button type="button" className={`text-left hover:underline ${className}`}
      aria-label={`Edit quantity for ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        setDraft(specQuantityInput(item));
        setUnit(specQuantityUnit(item));
        setError("");
        setOpen(true);
      }}>{value || "—"}</button>
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <DialogContent className="sm:max-w-md print:hidden" onClick={(event) => event.stopPropagation()}>
        <DialogHeader><DialogTitle>Quantity · {label}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div>
            <Label htmlFor={`${id}-amount`}>Qty</Label>
            <div className="mt-1 flex gap-2">
              <Input id={`${id}-amount`} autoFocus value={draft} disabled={saving}
                placeholder="Number or TBD" onChange={(event) => setDraft(event.target.value)} />
              <button type="button" disabled={saving} onClick={() => setDraft("TBD")}
                className="border border-border px-3 text-sm disabled:opacity-50">TBD</button>
            </div>
          </div>
          <div>
            <Label htmlFor={`${id}-unit`}>Measurement</Label>
            <select id={`${id}-unit`} value={unit} disabled={saving}
              onChange={(event) => setUnit(event.target.value as SpecQuantityUnit)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="count">Count</option><option value="square_feet">Sq Ft</option>
            </select>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">Use TBD when quantity is unknown. Changing the measurement does not convert the amount.</DialogDescription>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => setOpen(false)} className="border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="bg-ink px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Save quantity"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
