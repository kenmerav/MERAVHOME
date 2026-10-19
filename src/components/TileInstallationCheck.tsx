import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tileInstallationNote, needsTileInstallation, type TileField, type TileInstallationReview } from "@/lib/tileInstallation";
import type { MaterialItem } from "@/lib/db";

export function TileInstallationCheck({ projectId, items, rooms }: {
  projectId: string; items: MaterialItem[]; rooms: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [review, setReview] = useState<TileInstallationReview | null>(null);
  const locked = useRef(false);
  const qc = useQueryClient();
  if (!items.some(needsTileInstallation)) return null;
  async function run() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setOpen(true); setReview(null);
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session || session.error) throw Error("Sign in to review installation details.");
      const r = await fetch("/api/check-material-plans", { method: "POST", headers: { Authorization: `Bearer ${session.data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, action: "tile_details" }) });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "Could not check installation details.");
      setReview(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check installation details."); }
    finally { locked.current = false; setBusy(false); }
  }
  return <>
    <button type="button" onClick={() => void run()} className="inline-flex items-center gap-2 border border-ink px-5 py-3 text-sm text-ink">
      <ClipboardCheck className="h-4 w-4" />Check grout & tile layout
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-3xl">Grout & tile layout</DialogTitle>
          <DialogDescription>{busy ? "Checking saved notes and construction callouts…" : review?.message || "Review installation details for selected tiled areas."}</DialogDescription></DialogHeader>
        {busy && <Loader2 className="h-5 w-5 animate-spin" />}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        {review && <>
          <p className="text-sm text-muted-foreground">{review.checked_items} tiled {review.checked_items === 1 ? "area" : "areas"} checked · {review.findings.length} {review.findings.length === 1 ? "detail" : "details"} to review</p>
          {!review.findings.length && <p className="border p-5">{review.checked_items ? "Grout color, joint width and layout are documented for the selected tiled areas." : "No current tiled surfaces need installation review."}</p>}
          {review.findings.map(f => {
            const item = items.find(x => x.id === f.item_id);
            return item && <div key={f.id} className="border p-5 space-y-3">
              <div className="flex gap-4 items-center">
                {(item.image_url || item.product?.image_url) && <img src={item.image_url || item.product!.image_url!} alt="" loading="lazy" className="h-20 w-20 object-contain border bg-bone" />}
                <div><p className="text-xs uppercase tracking-widest text-muted-foreground">{rooms.find(r => r.id === f.room_id)?.name}</p>
                  <h3 className="font-display text-2xl">{f.item_label}</h3></div>
              </div>
              <p className="font-medium">{f.field === "grout" ? "Grout color / joint width" : "Tile layout"}</p>
              <p className="text-sm text-muted-foreground">{f.message}</p>
              <TileNoteEditor key={item.updated_at + f.field} item={item} field={f.field as TileField} onSaved={async () => {
                await Promise.all([["materialItems", projectId], ["spec-completion-review", projectId]].map(queryKey => qc.invalidateQueries({ queryKey })));
                await run();
              }} />
            </div>;
          })}
          {!!review.covered.length && <details className="text-sm border p-4"><summary className="cursor-pointer">{review.covered.length} {review.covered.length === 1 ? "detail" : "details"} already documented</summary>
            {review.covered.map(row => <div key={row.item_id + row.field} className="mt-3 border-t pt-3">
              <p className="font-medium">{items.find(i => i.id === row.item_id)?.client_product_name || items.find(i => i.id === row.item_id)?.item_label} · {row.field === "grout" ? "Grout" : "Tile layout"}</p>
              {row.evidence.map((p, i) => <p key={i} className="text-muted-foreground">{p.source === "plans" ? `Drawing page ${p.page}${p.sheet ? ` · ${p.sheet}` : ""}` : p.source === "board" ? "Design Board notes" : "Saved notes"}: {p.text}</p>)}
            </div>)}
          </details>}
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
function TileNoteEditor({ item, field, onSaved }: { item: MaterialItem; field: TileField; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(""), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const label = field === "grout" ? "Grout color and joint width" : "Tile pattern / direction";
  async function save() {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError("");
    try {
      const notes = tileInstallationNote(field, value, item.notes);
      const { data, error: failure } = await supabase.from("material_items").update({ notes }).eq("id", item.id)
        .eq("project_id", item.project_id).eq("room_id", item.room_id).eq("updated_at", item.updated_at).select("id").maybeSingle();
      if (failure) throw failure;
      if (!data) throw Error("This selection changed. Refresh Materials before saving.");
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this note."); }
    finally { lock.current = false; setSaving(false); }
  }
  return <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-2">
    <label className="block text-xs font-medium">{label}
      <input aria-label={`${label} for ${item.item_label}`} value={value} onChange={e => setValue(e.target.value)} disabled={saving} maxLength={1000}
        placeholder={field === "grout" ? "Off-white, 1/8 inch joints" : "Vertical straight set"} className="mt-1 w-full border px-3 py-2 text-sm" />
    </label>
    <button type="submit" disabled={saving} className="bg-ink text-white px-4 py-2 text-sm disabled:opacity-60">{saving ? "Saving…" : "Save to item notes"}</button>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
  </form>;
}
