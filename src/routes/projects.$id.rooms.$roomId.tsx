import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, BookOpen, LayoutTemplate, Plus, Sparkles, Trash2, ExternalLink, Star, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { resolveImage } from "@/lib/local-assets";
import {
  db, PRODUCT_CATEGORIES, MATERIAL_CATEGORIES, SUBCATEGORIES,
  type ProductCategory, type MaterialCategory, type Product, type RoomProduct,
  type Material, type Room, type Project,
} from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

async function scrapeProductUrl(url: string) {
  if (!url || !/^https?:\/\//.test(url)) {
    toast.error("Enter a valid URL first");
    return null;
  }
  const t = toast.loading("Scraping product info…");
  try {
    const res = await fetch("/api/scrape-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok || data?.error) throw new Error(data?.error || "Scrape failed");
    toast.success("Filled from URL", { id: t });
    return data as { name?: string; vendor?: string; sku?: string; finish?: string; image_url?: string; notes?: string };
  } catch (e: any) {
    toast.error(e?.message || "Scrape failed", { id: t });
    return null;
  }
}

function mergeScraped<T extends Record<string, any>>(f: T, scraped: Record<string, any>): T {
  const out: any = { ...f };
  for (const k of Object.keys(scraped)) {
    if (k in out && !out[k] && scraped[k]) out[k] = scraped[k];
  }
  return out;
}

export const Route = createFileRoute("/projects/$id/rooms/$roomId")({
  head: () => ({ meta: [{ title: "Room — MERAV Studio" }] }),
  component: RoomPage,
});

function RoomPage() {
  const { id, roomId } = Route.useParams();
  const qc = useQueryClient();

  const { data: project } = useQuery({ queryKey: ["project", id], queryFn: () => db.getProject(id) });
  const { data: room } = useQuery({ queryKey: ["room", roomId], queryFn: () => db.getRoom(roomId) });
  const { data: images = [] } = useQuery({ queryKey: ["roomImages", roomId], queryFn: async () => (await db.listRoomImages(roomId)) ?? [] });
  const { data: selections = [] } = useQuery({ queryKey: ["roomProducts", roomId], queryFn: async () => (await db.listRoomProducts(roomId)) ?? [] });
  const { data: materials = [] } = useQuery({ queryKey: ["materials", roomId], queryFn: async () => (await db.listMaterials(roomId)) ?? [] });

  if (!project || !room) {
    return <AppShell><div className="p-16 text-muted-foreground">Loading…</div></AppShell>;
  }

  const sketchups = images.filter(i => i.kind === "sketchup");
  const renderings = images.filter(i => i.kind === "rendering");

  const saveNotes = async (concept: string, notes: string) => {
    await db.updateRoom(roomId, { design_concept: concept, design_notes: notes });
    qc.invalidateQueries({ queryKey: ["room", roomId] });
    toast.success("Saved");
  };

  return (
    <AppShell>
      <div className="px-8 lg:px-16 py-10 max-w-[1500px]">
        <Link to="/projects/$id" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> {project.name}
        </Link>

        <div className="flex items-end justify-between mb-10 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">{project.client_name} · {project.name}</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">{room.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/presentations/$id" params={{ id }} hash={`room-${roomId}`} className="inline-flex items-center gap-2 px-4 py-2.5 border border-ink text-sm hover:bg-ink hover:text-primary-foreground transition-colors">
              <LayoutTemplate className="w-4 h-4" /> Presentation
            </Link>
            <Link to="/specbooks/$id" params={{ id }} className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-primary-foreground text-sm">
              <BookOpen className="w-4 h-4" /> Project Spec Book
            </Link>
          </div>
        </div>

        <Tabs defaultValue="sketchup">
          <TabsList className="bg-transparent border-b border-border w-full justify-start rounded-none h-auto p-0 gap-8 overflow-x-auto">
            {[
              ["sketchup", `SketchUp (${sketchups.length})`],
              ["selections", `Design Selections (${selections.length})`],
              ["materials", `Materials (${materials.length})`],
              ["renderings", `AI Renderings (${renderings.length})`],
              ["concept", "Concept & Notes"],
            ].map(([v, l]) => (
              <TabsTrigger key={v} value={v}
                className="bg-transparent rounded-none border-b-2 border-transparent data-[state=active]:border-ink data-[state=active]:shadow-none px-0 pb-3 text-sm tracking-wide whitespace-nowrap">
                {l}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="sketchup" className="pt-10">
            <ImageGrid title="SketchUp Images" roomId={roomId} kind="sketchup" images={sketchups} />
          </TabsContent>

          <TabsContent value="selections" className="pt-10 space-y-14">
            {PRODUCT_CATEGORIES.map(cat => (
              <SelectionCategory key={cat} category={cat} roomId={roomId}
                selections={selections.filter(s => s.product?.category === cat)} />
            ))}
          </TabsContent>

          <TabsContent value="materials" className="pt-10">
            <MaterialPalette roomId={roomId} materials={materials} />
          </TabsContent>

          <TabsContent value="renderings" className="pt-10">
            <RenderingsPanel roomId={roomId} images={renderings} sketchups={sketchups}
              selections={selections} materials={materials} room={room} project={project} />
          </TabsContent>

          <TabsContent value="concept" className="pt-10">
            <ConceptPanel
              initialConcept={room.design_concept || ""}
              initialNotes={room.design_notes || ""}
              onSave={saveNotes}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

/* ─────────── Images ─────────── */
function ImageGrid({ title, roomId, kind, images }: { title: string; roomId: string; kind: "sketchup" | "rendering"; images: any[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);

  const onFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please select an image file");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image too large (max 8MB)");
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      setUrl(dataUrl);
      toast.success("Image ready");
    } catch {
      toast.error("Failed to read image");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!url.trim()) return toast.error("Upload an image or paste a URL");
    await db.addRoomImage({ room_id: roomId, kind, url, caption });
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
    setOpen(false); setUrl(""); setCaption("");
    toast.success("Image added");
  };

  const remove = async (id: string) => {
    await db.deleteRoomImage(id);
    qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <h2 className="font-display text-3xl">{title}</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button className="text-sm inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add image</button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display text-2xl font-normal">Add {title}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="eyebrow">Upload image</Label>
                <Input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0])} disabled={uploading} />
                {url.startsWith("data:") && (
                  <div className="mt-2 aspect-[4/3] bg-bone overflow-hidden">
                    <img src={url} alt="preview" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground text-center">or paste a URL</div>
              <div><Label className="eyebrow">Image URL</Label><Input value={url.startsWith("data:") ? "" : url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></div>
              <div><Label className="eyebrow">Caption</Label><Input value={caption} onChange={e => setCaption(e.target.value)} /></div>
              <button onClick={submit} disabled={uploading} className="w-full py-3 bg-ink text-primary-foreground text-sm disabled:opacity-50">
                {uploading ? "Processing…" : "Add"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {images.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed border-border p-12 text-center">No {title.toLowerCase()} yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {images.map(img => (
            <div key={img.id} className="group relative">
              <div className="aspect-[4/3] bg-bone overflow-hidden">
                <img src={img.url} alt={img.caption || ""} className="w-full h-full object-cover" loading="lazy" />
              </div>
              {img.caption && <p className="text-xs text-muted-foreground mt-2">{img.caption}</p>}
              <button onClick={() => remove(img.id)} className="absolute top-2 right-2 bg-background/90 p-1.5 opacity-0 group-hover:opacity-100">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Design selections ─────────── */
function SelectionCategory({ category, roomId, selections }: { category: ProductCategory; roomId: string; selections: RoomProduct[] }) {
  return (
    <div>
      <div className="flex items-end justify-between mb-5 border-b border-border pb-3">
        <div>
          <div className="eyebrow">{selections.length} {selections.length === 1 ? "selection" : "selections"}</div>
          <h2 className="font-display text-3xl mt-1">{category}</h2>
        </div>
        <ProductPicker category={category} roomId={roomId} />
      </div>
      {selections.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6">No {category.toLowerCase()} yet. Add from the catalog or create new.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
          {selections.map(s => <SelectionCard key={s.id} sel={s} roomId={roomId} />)}
        </div>
      )}
    </div>
  );
}

function SelectionCard({ sel, roomId }: { sel: RoomProduct; roomId: string }) {
  const qc = useQueryClient();
  const p = sel.product!;
  const remove = async () => {
    await db.removeRoomProduct(sel.id);
    qc.invalidateQueries({ queryKey: ["roomProducts", roomId] });
  };
  const toggleKey = async () => {
    await db.updateRoomProduct(sel.id, { is_key_selection: !sel.is_key_selection });
    qc.invalidateQueries({ queryKey: ["roomProducts", roomId] });
  };
  return (
    <div className="group">
      <div className="aspect-square bg-bone overflow-hidden mb-3 relative">
        {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full" />}
        <button onClick={toggleKey} title="Key selection"
          className={cn("absolute top-2 left-2 p-1.5", sel.is_key_selection ? "bg-brass text-ink" : "bg-background/90 opacity-0 group-hover:opacity-100")}>
          <Star className="w-3.5 h-3.5" fill={sel.is_key_selection ? "currentColor" : "none"} />
        </button>
        <button onClick={remove} className="absolute top-2 right-2 bg-background/90 p-1.5 opacity-0 group-hover:opacity-100">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="eyebrow mb-1">{p.vendor || p.subcategory || "—"}</div>
      <h4 className="font-display text-lg leading-tight">{p.name}</h4>
      {p.finish && <p className="text-xs text-muted-foreground mt-1">{p.finish}</p>}
      {p.sku && <p className="text-[11px] text-muted-foreground mt-0.5">SKU: {p.sku}</p>}
      {p.product_url && (
        <a href={p.product_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-2 hover:text-ink">
          View <ExternalLink className="w-2.5 h-2.5" />
        </a>
      )}
    </div>
  );
}

function ProductPicker({ category, roomId }: { category: ProductCategory; roomId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"catalog" | "create">("catalog");
  const [search, setSearch] = useState("");
  const { data: catalog = [] } = useQuery({
    queryKey: ["catalog", category, search],
    queryFn: async () => (await db.listCatalog(search)) ?? [],
  });
  const filtered = catalog.filter(p => p.category === category);

  const link = async (productId: string) => {
    await db.addRoomProduct({ room_id: roomId, product_id: productId });
    qc.invalidateQueries({ queryKey: ["roomProducts", roomId] });
    qc.invalidateQueries({ queryKey: ["procurement"] });
    toast.success("Added to room");
    setOpen(false);
  };

  const subs = SUBCATEGORIES[category];
  const [f, setF] = useState({ name: "", vendor: "", product_url: "", image_url: "", finish: "", sku: "", notes: "", subcategory: subs[0] });

  const createAndAdd = async () => {
    if (!f.name.trim()) return toast.error("Product name required");
    const prod = await db.createProduct({
      name: f.name, vendor: f.vendor || null, product_url: f.product_url || null, image_url: f.image_url || null,
      finish: f.finish || null, sku: f.sku || null, notes: f.notes || null,
      category, subcategory: f.subcategory || null,
    });
    if (!prod) return;
    await db.addRoomProduct({ room_id: roomId, product_id: prod.id });
    qc.invalidateQueries({ queryKey: ["roomProducts", roomId] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["procurement"] });
    setOpen(false);
    setF({ name: "", vendor: "", product_url: "", image_url: "", finish: "", sku: "", notes: "", subcategory: subs[0] });
    toast.success("Product created and added");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-sm inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add {category}</button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl font-normal">Add {category}</DialogTitle></DialogHeader>
        <div className="flex gap-6 border-b border-border">
          {(["catalog","create"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn("pb-2 text-sm capitalize border-b-2", tab === t ? "border-ink text-ink" : "border-transparent text-muted-foreground")}>
              {t === "catalog" ? "From Catalog" : "Create New"}
            </button>
          ))}
        </div>

        {tab === "catalog" ? (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search catalog" className="pl-9" />
            </div>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No {category.toLowerCase()} in catalog. Create one in the next tab.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filtered.map(p => (
                  <button key={p.id} onClick={() => link(p.id)} className="text-left border border-border p-3 hover:border-ink flex gap-3">
                    <div className="w-14 h-14 bg-bone flex-shrink-0 overflow-hidden">
                      {p.image_url && <img src={p.image_url} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground truncate">{p.vendor || "—"}</div>
                      <div className="font-display text-sm leading-tight truncate">{p.name}</div>
                      {p.finish && <div className="text-[11px] text-muted-foreground truncate">{p.finish}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div>
              <Label className="eyebrow">Subcategory</Label>
              <Select value={f.subcategory} onValueChange={v => setF({ ...f, subcategory: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{subs.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {([["name","Product Name"],["vendor","Vendor"],["product_url","Product URL"],["image_url","Image URL"],["finish","Finish"],["sku","SKU"]] as const).map(([k, l]) => (
              <div key={k}>
                <Label className="eyebrow">{l}</Label>
                <div className="flex gap-2">
                  <Input value={(f as any)[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />
                  {k === "product_url" && (
                    <button type="button" onClick={async () => { const s = await scrapeProductUrl(f.product_url); if (s) setF(prev => mergeScraped(prev, s)); }} className="px-3 text-xs border border-border whitespace-nowrap hover:border-ink">Scrape</button>
                  )}
                </div>
              </div>
            ))}
            <div><Label className="eyebrow">Notes</Label><Textarea rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
            <button onClick={createAndAdd} className="w-full py-3 bg-ink text-primary-foreground text-sm">Create & Add to Room</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Materials ─────────── */
function MaterialPalette({ roomId, materials }: { roomId: string; materials: any[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: "Cabinet Finish" as MaterialCategory, name: "", image_url: "", vendor: "", product_url: "", sku: "", notes: "" });

  const submit = async () => {
    if (!f.name.trim()) return;
    await db.addMaterial({
      room_id: roomId, category: f.category, name: f.name,
      image_url: f.image_url || null, vendor: f.vendor || null, product_url: f.product_url || null, sku: f.sku || null, notes: f.notes || null,
    });
    qc.invalidateQueries({ queryKey: ["materials", roomId] });
    setOpen(false);
    setF({ category: "Cabinet Finish", name: "", image_url: "", vendor: "", product_url: "", sku: "", notes: "" });
    toast.success("Material added");
  };

  const remove = async (id: string) => {
    await db.deleteMaterial(id);
    qc.invalidateQueries({ queryKey: ["materials", roomId] });
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="eyebrow">{materials.length} swatches</div>
          <h2 className="font-display text-3xl mt-1">Material Palette</h2>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button className="text-sm inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Material</button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display text-2xl font-normal">Add Material</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="eyebrow">Category</Label>
                <Select value={f.category} onValueChange={v => setF({ ...f, category: v as MaterialCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MATERIAL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {([["name","Name"],["vendor","Vendor"],["product_url","Product URL"],["image_url","Image URL"],["sku","SKU"]] as const).map(([k, l]) => (
                <div key={k}>
                  <Label className="eyebrow">{l}</Label>
                  <div className="flex gap-2">
                    <Input value={(f as any)[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />
                    {k === "product_url" && (
                      <button type="button" onClick={async () => { const s = await scrapeProductUrl(f.product_url); if (s) setF(prev => mergeScraped(prev, s)); }} className="px-3 text-xs border border-border whitespace-nowrap hover:border-ink">Scrape</button>
                    )}
                  </div>
                </div>
              ))}
              <div><Label className="eyebrow">Notes</Label><Textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
              <button onClick={submit} className="w-full py-3 bg-ink text-primary-foreground text-sm">Add</button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {materials.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed border-border p-12 text-center">No materials yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {materials.map(m => (
            <div key={m.id} className="group">
              <div className="aspect-square bg-bone overflow-hidden mb-3 relative">
                {m.image_url && <img src={m.image_url} alt={m.name} className="w-full h-full object-cover" loading="lazy" />}
                <button onClick={() => remove(m.id)} className="absolute top-2 right-2 bg-background/90 p-1.5 opacity-0 group-hover:opacity-100">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="eyebrow mb-1">{m.category}</div>
              <h4 className="font-display text-lg leading-tight">{m.name}</h4>
              {m.vendor && <p className="text-xs text-muted-foreground mt-1">{m.vendor}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Renderings ─────────── */
function RenderingsPanel({ roomId, images, sketchups, selections, materials, room, project }: {
  roomId: string; images: any[]; sketchups: any[];
  selections: RoomProduct[]; materials: Material[]; room: Room; project: Project;
}) {
  const qc = useQueryClient();
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);

  const buildSelectionsContext = () => {
    const lines: string[] = ["PROJECT SELECTIONS", "", `Room: ${room.name}`, `Project: ${project.name}`];
    if (project.client_name) lines.push(`Client: ${project.client_name}`);
    lines.push("");

    if (materials.length) {
      lines.push("MATERIALS");
      for (const m of materials) {
        const bits = [`${m.category}: ${m.name}`];
        if (m.vendor) bits.push(`Vendor: ${m.vendor}`);
        if (m.sku) bits.push(`SKU: ${m.sku}`);
        if (m.notes) bits.push(`Notes: ${m.notes}`);
        if (m.image_url) bits.push(`Image: ${m.image_url}`);
        lines.push("- " + bits.join(" | "));
      }
      lines.push("");
    }

    if (selections.length) {
      lines.push("PRODUCT SELECTIONS");
      const byCat = new Map<string, RoomProduct[]>();
      for (const s of selections) {
        const k = s.product?.category || "Other";
        (byCat.get(k) ?? byCat.set(k, []).get(k)!).push(s);
      }
      for (const [cat, items] of byCat) {
        lines.push(`# ${cat}`);
        for (const s of items) {
          const p = s.product!;
          const bits = [p.name];
          if (p.subcategory) bits.push(`(${p.subcategory})`);
          if (p.vendor) bits.push(`Vendor: ${p.vendor}`);
          if (p.finish) bits.push(`Finish: ${p.finish}`);
          if (p.sku) bits.push(`SKU: ${p.sku}`);
          if (p.product_url) bits.push(`URL: ${p.product_url}`);
          if (p.image_url) bits.push(`Image: ${p.image_url}`);
          if (p.notes) bits.push(`Notes: ${p.notes}`);
          lines.push("- " + bits.join(" | "));
        }
      }
      lines.push("");
    }

    if (room.design_concept) lines.push("DESIGN CONCEPT", room.design_concept, "");
    if (room.design_notes) lines.push("DESIGN NOTES", room.design_notes, "");
    if (project.design_concept) lines.push("PROJECT DESIGN CONCEPT", project.design_concept, "");
    if (project.design_notes) lines.push("PROJECT DESIGN NOTES", project.design_notes, "");

    return lines.join("\n");
  };

  const generateOne = async (sk: any) => {
    setGeneratingId(sk.id);
    try {
      const resolvedUrl = resolveImage(sk.url);
      let sketchupUrl = resolvedUrl || sk.url;
      if (sk.url?.startsWith("/src-assets/") && resolvedUrl) {
        const blob = await (await fetch(resolvedUrl)).blob();
        sketchupUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      }
      const selectionsBlock = buildSelectionsContext();
      const extraContext = [sk.caption, selectionsBlock].filter(Boolean).join("\n\n");
      const res = await fetch("/api/generate-rendering", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sketchupUrl, extraContext }),
      });
      if (!res.ok) {
        const message = res.headers.get("content-type")?.includes("application/json")
          ? ((await res.json()) as { error?: string }).error
          : await res.text();
        throw new Error(message || "Rendering generation failed");
      }
      const { imageDataUrl } = (await res.json()) as { imageDataUrl: string };
      await db.addRoomImage({
        room_id: roomId, kind: "rendering", url: imageDataUrl,
        caption: `Rendering from ${sk.caption || "SketchUp"}`, linked_sketchup_id: sk.id,
      });
      qc.invalidateQueries({ queryKey: ["roomImages", roomId] });
      toast.success("Rendering generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGeneratingId(null);
    }
  };

  const generateAll = async () => {
    setGeneratingAll(true);
    for (const sk of sketchups) {
      await generateOne(sk);
    }
    setGeneratingAll(false);
  };

  return (
    <div className="space-y-10">
      <div className="border border-border p-6 bg-bone/40">
        <div className="flex items-start gap-4">
          <Sparkles className="w-5 h-5 text-brass mt-1" />
          <div className="flex-1">
            <h3 className="font-display text-2xl mb-2">AI Rendering Generator</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Generates photoreal interior photography from each SketchUp image, preserving exact proportions, layout, camera angle, and architectural details.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 mb-5">
              <li>· {sketchups.length} SketchUp image{sketchups.length === 1 ? "" : "s"} ready to render</li>
              <li>· {selections.length} design selection{selections.length === 1 ? "" : "s"} · {materials.length} material{materials.length === 1 ? "" : "s"} on file</li>
            </ul>
            <button
              disabled={sketchups.length === 0 || generatingAll || generatingId !== null}
              onClick={generateAll}
              className={cn(
                "px-5 py-2.5 text-sm inline-flex items-center gap-2",
                sketchups.length === 0 ? "bg-bone text-muted-foreground cursor-not-allowed" : "bg-ink text-primary-foreground"
              )}
            >
              <Sparkles className="w-4 h-4" />
              {sketchups.length === 0
                ? "Add SketchUp images first"
                : generatingAll
                  ? "Generating all renderings…"
                  : `Generate rendering for all ${sketchups.length} SketchUp${sketchups.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>

      {sketchups.length > 0 && (
        <div>
          <h3 className="font-display text-2xl mb-4">SketchUp Sources</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sketchups.map(sk => {
              const isThis = generatingId === sk.id;
              const linked = images.filter((r: any) => r.linked_sketchup_id === sk.id);
              return (
                <div key={sk.id} className="border border-border p-3">
                  <div className="aspect-[4/3] bg-bone overflow-hidden mb-3">
                    <img src={sk.url} alt={sk.caption || ""} className="w-full h-full object-cover" />
                  </div>
                  {sk.caption && <p className="text-xs text-muted-foreground mb-2">{sk.caption}</p>}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{linked.length} rendering{linked.length === 1 ? "" : "s"}</span>
                    <button
                      disabled={isThis || generatingAll}
                      onClick={() => generateOne(sk)}
                      className={cn(
                        "px-3 py-1.5 text-xs inline-flex items-center gap-1.5",
                        isThis || generatingAll ? "bg-bone text-muted-foreground" : "bg-ink text-primary-foreground"
                      )}
                    >
                      <Sparkles className="w-3 h-3" /> {isThis ? "Generating…" : "Generate"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ImageGrid title="Renderings" roomId={roomId} kind="rendering" images={images} />
    </div>
  );
}

/* ─────────── Concept ─────────── */
function ConceptPanel({ initialConcept, initialNotes, onSave }: { initialConcept: string; initialNotes: string; onSave: (c: string, n: string) => void }) {
  const [concept, setConcept] = useState(initialConcept);
  const [notes, setNotes] = useState(initialNotes);
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Label className="eyebrow">Design Concept</Label>
        <Textarea rows={4} value={concept} onChange={e => setConcept(e.target.value)} placeholder="The defining mood and vision for this room…" />
      </div>
      <div>
        <Label className="eyebrow">Design Notes</Label>
        <Textarea rows={6} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Client priorities, dimensions, references, constraints…" />
      </div>
      <button onClick={() => onSave(concept, notes)} className="px-6 py-2.5 bg-ink text-primary-foreground text-sm">Save</button>
    </div>
  );
}
