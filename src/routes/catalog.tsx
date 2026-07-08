import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, ExternalLink, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, SUBCATEGORIES, type Product, type ProductCategory } from "@/lib/db";
import {
  ALL_CATEGORIES,
  productDisplayCategory,
  productMatchesItemCategory,
  sampleAppliesToCategory,
  toProductCategory,
  type ItemCategory,
} from "@/lib/roomTemplates";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { normalizeMoneyInput } from "@/lib/money";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { canViewProductCatalog } from "@/lib/permissions";
import { inferVendorFromUrl } from "@/lib/vendorInference";
import { toast } from "sonner";

type SampleFilter = "All" | "Sample" | "No sample";
type CatalogSearch = {
  q?: string;
  category?: ItemCategory;
  vendor?: string;
  sample?: SampleFilter;
  project?: string;
};

const isItemCategory = (value: unknown): value is ItemCategory =>
  typeof value === "string" && (ALL_CATEGORIES as readonly string[]).includes(value);

const isSampleFilter = (value: unknown): value is SampleFilter =>
  value === "Sample" || value === "No sample";

function externalHref(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!/\s/.test(trimmed) && /^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

export const Route = createFileRoute("/catalog")({
  head: () => ({ meta: [{ title: "Product Catalog — MERAV Studio" }] }),
  validateSearch: (search: Record<string, unknown>): CatalogSearch => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    category: isItemCategory(search.category) ? search.category : undefined,
    vendor: typeof search.vendor === "string" && search.vendor.trim() ? search.vendor : undefined,
    sample: isSampleFilter(search.sample) ? search.sample : undefined,
    project: typeof search.project === "string" && search.project.trim() ? search.project : undefined,
  }),
  component: CatalogPage,
});

function CatalogPage() {
  const routeSearch = Route.useSearch();
  const [search, setSearch] = useState(routeSearch.q ?? "");
  const [cat, setCat] = useState<ItemCategory | "All">(routeSearch.category ?? "All");
  const [vendor, setVendor] = useState(routeSearch.vendor ?? "All");
  const [sampleFilter, setSampleFilter] = useState<SampleFilter>(routeSearch.sample ?? "All");
  const [projectFilter, setProjectFilter] = useState(routeSearch.project ?? "All");
  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentUserProfile"],
    queryFn: () => db.getCurrentUserProfile(),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await db.listProjects()) ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["catalog", search],
    queryFn: async () => (await db.listCatalog(search)) ?? [],
  });
  const { data: projectProductIds = [], isFetching: loadingProjectProducts } = useQuery({
    queryKey: ["catalogProjectProductIds", projectFilter],
    queryFn: async () => (await db.listProjectCatalogProductIds(projectFilter)) ?? [],
    enabled: projectFilter !== "All",
  });
  const projectProductIdSet = useMemo(() => new Set(projectProductIds), [projectProductIds]);
  const showSampleFilter = cat !== "All" && sampleAppliesToCategory(cat);
  const projectFiltered =
    projectFilter === "All" ? products : products.filter((p) => projectProductIdSet.has(p.id));
  const categoryFiltered = cat === "All" ? projectFiltered : projectFiltered.filter(p => productMatchesItemCategory(p, cat));
  const sampleFiltered =
    showSampleFilter && sampleFilter !== "All"
      ? categoryFiltered.filter((p) => sampleFilter === "Sample" ? p.has_sample : !p.has_sample)
      : categoryFiltered;
  const vendors = Array.from(
    new Set(sampleFiltered.map((p) => p.vendor?.trim()).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b));
  const filtered = vendor === "All" ? sampleFiltered : sampleFiltered.filter(p => p.vendor === vendor);
  const setCategory = (category: ItemCategory | "All") => {
    setCat(category);
    setVendor("All");
    setSampleFilter("All");
  };
  const setProject = (projectId: string) => {
    setProjectFilter(projectId);
    setVendor("All");
  };
  const catalogSearch = useMemo(
    () => ({
      q: search.trim() || undefined,
      category: cat === "All" ? undefined : cat,
      vendor: vendor === "All" ? undefined : vendor,
      sample: sampleFilter === "All" ? undefined : sampleFilter,
      project: projectFilter === "All" ? undefined : projectFilter,
    }),
    [cat, projectFilter, sampleFilter, search, vendor],
  );

  useEffect(() => {
    if (vendor !== "All" && !vendors.includes(vendor)) setVendor("All");
  }, [vendor, vendors]);

  if (loadingProfile) {
    return (
      <AppShell>
        <div className="page-pad text-muted-foreground">Loading product catalog...</div>
      </AppShell>
    );
  }

  if (!canViewProductCatalog(profile)) {
    return (
      <AppShell>
        <div className="page-pad max-w-3xl">
          <h1 className="editorial-hero text-5xl">Product Catalog</h1>
          <p className="mt-4 text-muted-foreground">Product Catalog is available to MERAV team members only.</p>
        </div>
      </AppShell>
    );
  }

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
          <Select value={projectFilter} onValueChange={setProject}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1 flex-wrap">
            {(["All", ...ALL_CATEGORIES] as const).map(c => (
              <button key={c} onClick={() => setCategory(c)}
                className={cn("text-xs px-3 py-1.5 border", cat === c ? "border-ink bg-ink text-primary-foreground" : "border-border text-muted-foreground hover:border-ink")}>
                {c}
              </button>
            ))}
          </div>
          {showSampleFilter && (
            <Select value={sampleFilter} onValueChange={(value) => setSampleFilter(value as SampleFilter)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Sample" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Samples</SelectItem>
                <SelectItem value="Sample">Sample</SelectItem>
                <SelectItem value="No sample">No sample</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={vendor} onValueChange={setVendor}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Vendors</SelectItem>
              {vendors.map((vendorName) => (
                <SelectItem key={vendorName} value={vendorName}>{vendorName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <div className="border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
            {loadingProjectProducts ? "Loading project products..." : "No products found."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
            {filtered.map(p => <CatalogCard key={p.id} p={p} catalogSearch={catalogSearch} />)}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function CatalogCard({ p, catalogSearch }: { p: Product; catalogSearch: CatalogSearch }) {
  const qc = useQueryClient();
  const displayCategory = productDisplayCategory(p);
  const showSampleBadge = sampleAppliesToCategory(displayCategory);
  const remove = async () => {
    if (!confirm(`Delete "${p.name}"? It will be removed from any room using it.`)) return;
    await db.deleteProduct(p.id);
    qc.invalidateQueries({ queryKey: ["catalog"] });
    toast.success("Deleted");
  };
  return (
    <div className="group">
      <div className="aspect-square bg-bone overflow-hidden mb-3 relative">
        <Link to="/catalog/$productId" params={{ productId: p.id }} search={catalogSearch} className="block w-full h-full" title={`Open ${p.name}`}>
          {p.image_url ? <img src={normalizeSupabaseImageUrl(p.image_url)} alt={p.name} className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" loading="lazy" /> : <div className="w-full h-full" />}
        </Link>
        <button onClick={remove} className="absolute top-2 right-2 bg-background/90 p-1.5 opacity-0 group-hover:opacity-100">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <Link to="/catalog/$productId" params={{ productId: p.id }} search={catalogSearch} className="block hover:text-ink/70 transition-colors">
        <div className="eyebrow mb-1">{displayCategory}{p.subcategory ? ` · ${p.subcategory}` : ""}</div>
        <h4 className="font-display text-lg leading-tight">{p.name}</h4>
        <p className="text-[11px] text-muted-foreground mt-1">Product name: {p.name}</p>
        {p.vendor && <p className="text-xs text-muted-foreground mt-1">{p.vendor}</p>}
        {p.finish && <p className="text-xs text-muted-foreground">{p.finish}</p>}
        {showSampleBadge && (
          <p className={cn("text-[11px] mt-1", p.has_sample ? "text-emerald-700" : "text-amber-700")}>
            {p.has_sample ? "Sample on hand" : "No sample"}
          </p>
        )}
        {(p.price || p.unit_cost || p.shipping) && (
          <p className="text-[11px] text-muted-foreground mt-1">
            {[p.price && `Client ${p.price}`, p.unit_cost && `Cost ${p.unit_cost}`, p.shipping && `Ship ${p.shipping}`].filter(Boolean).join(" · ")}
          </p>
        )}
        {p.sku && <p className="text-[11px] text-muted-foreground mt-0.5">SKU: {p.sku}</p>}
      </Link>
      {p.product_url && externalHref(p.product_url) ? (
        <a href={externalHref(p.product_url) ?? undefined} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-2 hover:text-ink">
          View <ExternalLink className="w-2.5 h-2.5" />
        </a>
      ) : p.product_url ? (
        <p className="text-xs text-muted-foreground mt-2 break-words">{p.product_url}</p>
      ) : null}
    </div>
  );
}

function NewProductDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ItemCategory>("Lighting");
  const strictCategory = toProductCategory(category);
  const [f, setF] = useState({ name: "", vendor: "", product_url: "", image_url: "", finish: "", sku: "", dimensions: "", price: "", unit_cost: "", shipping: "", notes: "", subcategory: SUBCATEGORIES.Lighting[0], has_sample: false });

  const submit = async () => {
    if (!f.name.trim()) return toast.error("Name required");
    await db.createProduct({
      name: f.name, vendor: f.vendor || inferVendorFromUrl(f.product_url) || null, product_url: f.product_url || null, image_url: f.image_url || null,
      finish: f.finish || null, sku: f.sku || null, dimensions: f.dimensions || null, price: normalizeMoneyInput(f.price),
      unit_cost: normalizeMoneyInput(f.unit_cost), shipping: normalizeMoneyInput(f.shipping), notes: f.notes || null,
      category: strictCategory, subcategory: f.subcategory || null, has_sample: sampleAppliesToCategory(category) ? f.has_sample : false,
    });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    setOpen(false);
    setF({ name: "", vendor: "", product_url: "", image_url: "", finish: "", sku: "", dimensions: "", price: "", unit_cost: "", shipping: "", notes: "", subcategory: SUBCATEGORIES[strictCategory][0], has_sample: false });
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
            <Select value={category} onValueChange={v => {
              const nextCategory = v as ItemCategory;
              const nextStrictCategory = toProductCategory(nextCategory);
              setCategory(nextCategory);
              setF(prev => ({ ...prev, subcategory: SUBCATEGORIES[nextStrictCategory][0], has_sample: sampleAppliesToCategory(nextCategory) ? prev.has_sample : false }));
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ALL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="eyebrow">Subcategory</Label>
            <Select value={f.subcategory} onValueChange={v => setF({ ...f, subcategory: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SUBCATEGORIES[strictCategory].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {sampleAppliesToCategory(category) && (
            <div>
              <Label className="eyebrow">Sample</Label>
              <Select value={f.has_sample ? "yes" : "no"} onValueChange={v => setF({ ...f, has_sample: v === "yes" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Sample</SelectItem>
                  <SelectItem value="no">No sample</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
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
