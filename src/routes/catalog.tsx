import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Search, ExternalLink, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, PRODUCT_CATEGORIES, SUBCATEGORIES, type ProductCategory } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/catalog")({
  head: () => ({ meta: [{ title: "Product Catalog — MERAV Studio" }] }),
  component: CatalogPage,
});

function CatalogPage() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<ProductCategory | "All">("All");
  const { data: products = [] } = useQuery({
    queryKey: ["catalog", search],
    queryFn: async () => (await db.listCatalog(search)) ?? [],
  });
  const filtered = cat === "All" ? products : products.filter(p => p.category === cat);

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <div className="flex items-end justify-between mb-10 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">Single source of truth</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">Product Catalog</h1>
            <p className="mt-4 text-muted-foreground max-w-xl">
              Reusable across every project and room. Enter once, flow through selections, renderings, presentations, spec books, and procurement.
            </p>
          </div>
          <NewProductDialog />
        </div>

        <div className="flex items-center gap-3 mb-8 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products" className="pl-9" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["All", ...PRODUCT_CATEGORIES] as const).map(c => (
              <button key={c} onClick={() => setCat(c)}
                className={cn("text-xs px-3 py-1.5 border", cat === c ? "border-ink bg-ink text-primary-foreground" : "border-border text-muted-foreground hover:border-ink")}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="border border-dashed border-border py-20 text-center text-sm text-muted-foreground">No products yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
            {filtered.map(p => <CatalogCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function CatalogCard({ p }: { p: any }) {
  const qc = useQueryClient();
  const remove = async () => {
    if (!confirm(`Delete "${p.name}"? It will be removed from any room using it.`)) return;
    await db.deleteProduct(p.id);
    qc.invalidateQueries({ queryKey: ["catalog"] });
    toast.success("Deleted");
  };
  return (
    <div className="group">
      <div className="aspect-square bg-bone overflow-hidden mb-3 relative">
        <Link to="/catalog/$productId" params={{ productId: p.id }} className="block w-full h-full" title={`Open ${p.name}`}>
          {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" loading="lazy" /> : <div className="w-full h-full" />}
        </Link>
        <button onClick={remove} className="absolute top-2 right-2 bg-background/90 p-1.5 opacity-0 group-hover:opacity-100">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <Link to="/catalog/$productId" params={{ productId: p.id }} className="block hover:text-ink/70 transition-colors">
        <div className="eyebrow mb-1">{p.category}{p.subcategory ? ` · ${p.subcategory}` : ""}</div>
        <h4 className="font-display text-lg leading-tight">{p.name}</h4>
        {p.vendor && <p className="text-xs text-muted-foreground mt-1">{p.vendor}</p>}
        {p.finish && <p className="text-xs text-muted-foreground">{p.finish}</p>}
        {(p.price || p.unit_cost || p.shipping) && (
          <p className="text-[11px] text-muted-foreground mt-1">
            {[p.price && `Client ${p.price}`, p.unit_cost && `Cost ${p.unit_cost}`, p.shipping && `Ship ${p.shipping}`].filter(Boolean).join(" · ")}
          </p>
        )}
        {p.sku && <p className="text-[11px] text-muted-foreground mt-0.5">SKU: {p.sku}</p>}
      </Link>
      {p.product_url && (
        <a href={p.product_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-2 hover:text-ink">
          View <ExternalLink className="w-2.5 h-2.5" />
        </a>
      )}
    </div>
  );
}

function NewProductDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ProductCategory>("Lighting");
  const [f, setF] = useState({ name: "", vendor: "", product_url: "", image_url: "", finish: "", sku: "", dimensions: "", price: "", unit_cost: "", shipping: "", notes: "", subcategory: SUBCATEGORIES.Lighting[0] });

  const submit = async () => {
    if (!f.name.trim()) return toast.error("Name required");
    await db.createProduct({
      name: f.name, vendor: f.vendor || null, product_url: f.product_url || null, image_url: f.image_url || null,
      finish: f.finish || null, sku: f.sku || null, dimensions: f.dimensions || null, price: f.price || null,
      unit_cost: f.unit_cost || null, shipping: f.shipping || null, notes: f.notes || null,
      category, subcategory: f.subcategory || null,
    });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    setOpen(false);
    setF({ name: "", vendor: "", product_url: "", image_url: "", finish: "", sku: "", dimensions: "", price: "", unit_cost: "", shipping: "", notes: "", subcategory: SUBCATEGORIES[category][0] });
    toast.success("Product added to catalog");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-primary-foreground text-sm">
          <Plus className="w-4 h-4" /> New Product
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-2xl font-normal">New Product</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <Label className="eyebrow">Category</Label>
            <Select value={category} onValueChange={v => { setCategory(v as ProductCategory); setF(prev => ({ ...prev, subcategory: SUBCATEGORIES[v as ProductCategory][0] })); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRODUCT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="eyebrow">Subcategory</Label>
            <Select value={f.subcategory} onValueChange={v => setF({ ...f, subcategory: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SUBCATEGORIES[category].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {([["name","Product Name"],["vendor","Vendor"],["product_url","Product URL"],["image_url","Image URL"],["finish","Finish"],["sku","SKU"],["dimensions","Dimensions"],["price","Client Price"],["unit_cost","Unit Cost"],["shipping","Shipping"]] as const).map(([k,l]) => (
            <div key={k}>
              <Label className="eyebrow">{l}</Label>
              <Input value={(f as any)[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />
            </div>
          ))}
          <div><Label className="eyebrow">Notes</Label><Textarea rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
          <button onClick={submit} className="w-full py-3 bg-ink text-primary-foreground text-sm">Add to Catalog</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
