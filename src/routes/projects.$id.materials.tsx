import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Sparkles, Trash2, X, Check } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, type MaterialItem, type Room } from "@/lib/db";
import { ALL_CATEGORIES, PRODUCT_CATEGORIES } from "@/lib/roomTemplates";
import { buildClientProductName, clientProductName } from "@/lib/clientProductName";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/projects/$id/materials")({
  head: () => ({ meta: [{ title: "Materials — MERAV Studio" }] }),
  component: MaterialsPage,
});

type ScrapedRow = {
  material_item_id: string;
  url: string;
  existing_product_id?: string | null;
  scraped: {
    name?: string;
    vendor?: string;
    image_url?: string;
    color?: string;
    finish?: string;
    sku?: string;
    dimensions?: string;
    price?: string;
    unit_cost?: string;
    shipping?: string;
    description?: string;
    error?: string;
  };
};

function MaterialsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const { data: project } = useQuery({ queryKey: ["project", id], queryFn: () => db.getProject(id) });
  const { data: rooms = [] } = useQuery({ queryKey: ["rooms", id], queryFn: async () => (await db.listRooms(id)) ?? [] });
  const { data: items = [] } = useQuery({
    queryKey: ["materialItems", id],
    queryFn: async () => (await db.listMaterialItemsByProject(id)) ?? [],
  });

  const [scraping, setScraping] = useState(false);
  const [reviewRows, setReviewRows] = useState<ScrapedRow[] | null>(null);

  const byRoom = useMemo(() => {
    const map = new Map<string, MaterialItem[]>();
    items.forEach((it) => {
      const arr = map.get(it.room_id) ?? [];
      arr.push(it);
      map.set(it.room_id, arr);
    });
    return map;
  }, [items]);

  const overall = useMemo(() => {
    const total = items.length;
    const done = items.filter((it) => it.not_needed || (it.product_url && it.product_url.trim().length > 0)).length;
    return { done, total };
  }, [items]);

  const runScrape = async () => {
    setScraping(true);
    try {
      const res = await fetch("/api/scrape-materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Scrape failed");
      const rows = (body?.rows ?? []) as ScrapedRow[];
      if (rows.length === 0) {
        toast.info("Nothing new to scrape — every row is either empty, marked Not Needed, or already linked.");
      } else {
        setReviewRows(rows);
      }
    } catch (e: any) {
      toast.error(e?.message || "Scrape failed");
    } finally {
      setScraping(false);
    }
  };

  const commitReview = async (final: ScrapedRow[]) => {
    try {
      const res = await fetch("/api/scrape-materials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: final }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not save");
      toast.success(`Saved ${final.length} product${final.length === 1 ? "" : "s"} to catalog`);
      setReviewRows(null);
      qc.invalidateQueries({ queryKey: ["materialItems", id] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    }
  };

  if (!project) return <AppShell><div className="p-16 text-muted-foreground">Loading…</div></AppShell>;

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <Link to="/projects/$id" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Project
        </Link>

        <div className="flex items-end justify-between flex-wrap gap-6 mb-10">
          <div>
            <div className="eyebrow mb-2">{project.name} · {project.client_name}</div>
            <h1 className="editorial-hero text-4xl lg:text-6xl">Materials</h1>
            <p className="text-sm text-muted-foreground mt-3 max-w-xl">
              Fill in CAD label, product link, quantity, and color for every required item. Mark anything you don't need.
              When you're ready, scrape every link to save the products into the catalog.
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="text-xs text-muted-foreground">
              {overall.done} of {overall.total} items complete
            </div>
            <button
              onClick={runScrape}
              disabled={scraping}
              className="inline-flex items-center gap-2 px-5 py-3 bg-ink text-primary-foreground text-sm tracking-wide disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              {scraping ? "Scraping…" : "Scrape Product Info"}
            </button>
          </div>
        </div>

        <div className="space-y-12">
          {rooms.map((room) => (
            <RoomMaterialsSection
              key={room.id}
              room={room}
              items={byRoom.get(room.id) ?? []}
              projectId={id}
            />
          ))}
        </div>

        {reviewRows && (
          <ReviewDialog
            rows={reviewRows}
            items={items}
            onCancel={() => setReviewRows(null)}
            onCommit={commitReview}
          />
        )}
      </div>
    </AppShell>
  );
}

function RoomMaterialsSection({
  room,
  items,
  projectId,
}: {
  room: Room;
  items: MaterialItem[];
  projectId: string;
}) {
  const qc = useQueryClient();
  const done = items.filter((it) => it.not_needed || (it.product_url && it.product_url.trim().length > 0)).length;
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.item_label.localeCompare(b.item_label, undefined, { sensitivity: "base" })),
    [items],
  );
  const roomInitial = (room.name.trim().charAt(0) || "R").toUpperCase();
  const cadOptions = sortedItems.map((it, index) => ({
    itemId: it.id,
    value: `${roomInitial}-${String(index + 1).padStart(2, "0")}`,
  }));
  const usedCadLabels = new Set(
    sortedItems
      .map((it) => it.cad_label?.trim())
      .filter((label): label is string => !!label),
  );
  const cadLabelOwner = new Map<string, string>();
  for (const item of sortedItems) {
    const label = item.cad_label?.trim();
    if (label && !cadLabelOwner.has(label)) cadLabelOwner.set(label, item.id);
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["materialItems", projectId] });

  const update = async (id: string, patch: Partial<MaterialItem>) => {
    await db.updateMaterialItem(id, patch);
    invalidate();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    await db.deleteMaterialItem(id);
    invalidate();
  };

  return (
    <section className="border border-border bg-background">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bone/30">
        <div className="flex items-baseline gap-4">
          <h2 className="font-display text-2xl">{room.name}</h2>
          <span className="text-xs text-muted-foreground tracking-wide">
            {done} of {items.length} completed
          </span>
        </div>
        <AddCustomItemButton roomId={room.id} roomName={room.name} projectId={projectId} sortStart={items.length} />
      </div>

      {items.length === 0 ? (
        <div className="px-6 py-10 text-sm text-muted-foreground">
          No required items for this room. Add custom items above.
        </div>
      ) : (
        <div className="mobile-card-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-[0.15em] uppercase text-muted-foreground">
                <th className="px-6 py-3 w-[180px]">Item</th>
                <th className="py-3 w-[220px]">Client Product Name</th>
                <th className="py-3 w-[140px]">Category</th>
                <th className="py-3 w-[120px]">CAD Label</th>
                <th className="py-3">Product Link</th>
                <th className="py-3 w-[72px]">Qty</th>
                <th className="py-3 w-[140px]">Color / Finish</th>
                <th className="py-3 w-[100px]">Not Needed</th>
                <th className="py-3 w-[60px]">Notes</th>
                <th className="px-4 py-3 w-[40px]"></th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((it) => {
                const complete = it.not_needed || (it.product_url && it.product_url.trim().length > 0);
                return (
                  <tr key={it.id} className="border-t border-border align-middle">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${complete ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                          title={complete ? "Complete" : "Incomplete"}
                        />
                        <span className={it.not_needed ? "line-through text-muted-foreground" : ""}>{it.item_label}</span>
                        {!it.is_required && (
                          <span className="text-[10px] tracking-wider uppercase text-muted-foreground">Custom</span>
                        )}
                        {it.product && (
                          <span className="text-[10px] tracking-wider uppercase text-emerald-700">Scraped</span>
                        )}
                      </div>
                      {it.product && (
                        <div className="mt-2 flex items-center gap-2 pl-3.5">
                          {it.product.image_url ? (
                            <img src={it.product.image_url} alt="" className="w-10 h-10 object-cover bg-bone border border-border" />
                          ) : (
                            <div className="w-10 h-10 bg-bone border border-border" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs text-ink truncate max-w-[200px]" title={it.product.name}>
                              {it.product.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                              {[it.product.vendor, it.product.price, it.product.dimensions].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <InlineInput
                        value={clientProductName(it, room)}
                        onSave={(v) => update(it.id, { client_product_name: v || buildClientProductName(room.name, it.item_label) })}
                        disabled={it.not_needed}
                        placeholder="Kitchen Pendant"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Select
                        value={it.category ?? "Decor"}
                        onValueChange={(v) => update(it.id, { category: v })}
                        disabled={it.not_needed}
                      >
                        <SelectTrigger className="h-8 border-transparent hover:border-input focus:border-input bg-transparent text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRODUCT_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-3">
                      <CadLabelSelect
                        value={it.cad_label}
                        options={cadOptions.filter((option) => {
                          const ownerId = cadLabelOwner.get(option.value);
                          return !usedCadLabels.has(option.value) || ownerId === it.id;
                        })}
                        onSave={(v) => update(it.id, { cad_label: v })}
                        disabled={it.not_needed}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <InlineInput
                        value={it.product_url ?? ""}
                        onSave={(v) => update(it.id, { product_url: v || null, scrape_status: "pending" })}
                        disabled={it.not_needed}
                        placeholder="https://…"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <InlineInput
                        type="number"
                        value={it.quantity?.toString() ?? ""}
                        onSave={(v) => update(it.id, { quantity: v ? parseInt(v, 10) : null })}
                        disabled={it.not_needed}
                        placeholder="1"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <InlineInput
                        value={it.color ?? ""}
                        onSave={(v) => update(it.id, { color: v || null })}
                        disabled={it.not_needed}
                        placeholder="Antique Brass"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Checkbox
                        checked={it.not_needed}
                        onCheckedChange={(c) => update(it.id, { not_needed: !!c })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NotesPopover value={it.notes ?? ""} onSave={(v) => update(it.id, { notes: v || null })} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => remove(it.id)}
                        className="text-muted-foreground hover:text-ink"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CadLabelSelect({
  value,
  options,
  onSave,
  disabled,
}: {
  value: string | null;
  options: Array<{ itemId: string; value: string }>;
  onSave: (v: string | null) => void;
  disabled?: boolean;
}) {
  const normalizedValue = value?.trim() || "__none__";
  const hasCurrentValue = normalizedValue !== "__none__" && options.some((option) => option.value === normalizedValue);

  return (
    <Select
      value={normalizedValue}
      onValueChange={(next) => onSave(next === "__none__" ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 border-transparent hover:border-input focus:border-input bg-transparent text-xs">
        <SelectValue placeholder="CAD label" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">No label</SelectItem>
        {!hasCurrentValue && normalizedValue !== "__none__" && (
          <SelectItem value={normalizedValue}>{normalizedValue}</SelectItem>
        )}
        {options.map((option) => (
          <SelectItem key={option.itemId} value={option.value}>{option.value}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InlineInput({
  value,
  onSave,
  type = "text",
  disabled,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  type?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  return (
    <Input
      value={local}
      type={type}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onSave(local); }}
      className="h-8 border-transparent hover:border-input focus:border-input bg-transparent"
    />
  );
}

function NotesPopover({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(value);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setLocal(value); }}>
      <DialogTrigger asChild>
        <button className={`text-xs underline-offset-4 hover:underline ${value ? "text-ink" : "text-muted-foreground"}`}>
          {value ? "Edit" : "Add"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display text-xl font-normal">Notes</DialogTitle></DialogHeader>
        <Textarea value={local} onChange={(e) => setLocal(e.target.value)} rows={5} />
        <button
          onClick={() => { onSave(local); setOpen(false); }}
          className="w-full py-2.5 bg-ink text-primary-foreground text-sm"
        >
          Save
        </button>
      </DialogContent>
    </Dialog>
  );
}

function AddCustomItemButton({ roomId, roomName, projectId, sortStart }: { roomId: string; roomName: string; projectId: string; sortStart: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<string>("Other");

  const submit = async () => {
    if (!label.trim()) return toast.error("Label required");
    await db.bulkInsertMaterialItems([{
      room_id: roomId,
      project_id: projectId,
      item_label: label.trim(),
      client_product_name: buildClientProductName(roomName, label.trim()),
      category,
      is_required: false,
      sort_order: sortStart,
      cad_label: null,
      product_url: null,
      quantity: null,
      color: null,
      notes: null,
      not_needed: false,
      product_id: null,
      scrape_status: "pending",
      scrape_error: null,
    }]);
    qc.invalidateQueries({ queryKey: ["materialItems", projectId] });
    setLabel(""); setCategory("Other"); setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border hover:border-ink">
          <Plus className="w-3 h-3" /> Add custom item
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display text-xl font-normal">Add custom item</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="eyebrow">Item label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Vent Hood Insert" />
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <button onClick={submit} className="w-full py-2.5 bg-ink text-primary-foreground text-sm">Add</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({
  rows,
  items,
  onCancel,
  onCommit,
}: {
  rows: ScrapedRow[];
  items: MaterialItem[];
  onCancel: () => void;
  onCommit: (rows: ScrapedRow[]) => void;
}) {
  const [edited, setEdited] = useState<ScrapedRow[]>(rows);
  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const update = (idx: number, patch: Partial<ScrapedRow["scraped"]>) =>
    setEdited((prev) => prev.map((r, i) => (i === idx ? { ...r, scraped: { ...r.scraped, ...patch } } : r)));

  const remove = (idx: number) => setEdited((prev) => prev.filter((_, i) => i !== idx));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Review scraped products</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Confirm or edit any details below. Products will be saved to your catalog and linked to each material row.
        </p>

        <div className="space-y-5 mt-4">
          {edited.map((row, idx) => {
            const item = itemById.get(row.material_item_id);
            const failed = !!row.scraped.error;
            return (
              <div key={row.material_item_id} className="border border-border p-4 grid grid-cols-1 sm:grid-cols-[120px_1fr_auto] gap-4">
                <div className="aspect-square bg-bone overflow-hidden">
                  {row.scraped.image_url ? (
                    <img src={row.scraped.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-muted-foreground text-xs">No image</div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="eyebrow">{item?.client_product_name || item?.item_label}</span>
                    {row.existing_product_id && (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-bone">Reused from catalog</span>
                    )}
                    {failed && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-rose-100 text-rose-700">Scrape failed — edit manually</span>}
                  </div>
                  <a href={row.url} target="_blank" rel="noreferrer" className="block text-xs text-muted-foreground underline-offset-4 hover:underline truncate">{row.url}</a>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="Name" value={row.scraped.name ?? ""} onChange={(v) => update(idx, { name: v })} />
                    <Field label="Vendor" value={row.scraped.vendor ?? ""} onChange={(v) => update(idx, { vendor: v })} />
                    <Field label="SKU" value={row.scraped.sku ?? ""} onChange={(v) => update(idx, { sku: v })} />
                    <Field label="Color" value={row.scraped.color ?? ""} onChange={(v) => update(idx, { color: v })} />
                    <Field label="Finish" value={row.scraped.finish ?? ""} onChange={(v) => update(idx, { finish: v })} />
                    <Field label="Dimensions" value={row.scraped.dimensions ?? ""} onChange={(v) => update(idx, { dimensions: v })} />
                    <Field label="Price" value={row.scraped.price ?? ""} onChange={(v) => update(idx, { price: v })} />
                    <Field label="Unit Cost" value={row.scraped.unit_cost ?? ""} onChange={(v) => update(idx, { unit_cost: v })} />
                    <Field label="Shipping" value={row.scraped.shipping ?? ""} onChange={(v) => update(idx, { shipping: v })} />
                    <Field label="Image URL" value={row.scraped.image_url ?? ""} onChange={(v) => update(idx, { image_url: v })} className="sm:col-span-2" />
                    <div className="sm:col-span-2 space-y-1">
                      <Label className="eyebrow text-[10px]">Description</Label>
                      <Textarea
                        value={row.scraped.description ?? ""}
                        onChange={(e) => update(idx, { description: e.target.value })}
                        rows={2}
                      />
                    </div>
                  </div>
                </div>
                <button onClick={() => remove(idx)} className="text-muted-foreground hover:text-ink self-start" title="Skip this row">
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 mt-6 sticky bottom-0 bg-background pt-4">
          <button onClick={onCancel} className="px-5 py-2.5 border border-border text-sm">Cancel</button>
          <button onClick={() => onCommit(edited)} className="px-5 py-2.5 bg-ink text-primary-foreground text-sm inline-flex items-center gap-2">
            <Check className="w-4 h-4" /> Save {edited.length} to catalog
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, onChange, className }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="eyebrow text-[10px]">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}
