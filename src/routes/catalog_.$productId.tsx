import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowLeft, ExternalLink, ImagePlus, Save, Trash2, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, SUBCATEGORIES, type Product, type ProductCategory } from "@/lib/db";
import {
  ALL_CATEGORIES,
  productDisplayCategory,
  sampleAppliesToCategory,
  toProductCategory,
  type ItemCategory,
} from "@/lib/roomTemplates";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { normalizeMoneyInput } from "@/lib/money";
import { cleanUuid } from "@/lib/ids";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";

type SampleFilter = "Sample" | "No sample";
type ProductCatalogSearch = {
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

export const Route = createFileRoute("/catalog_/$productId")({
  head: () => ({ meta: [{ title: "Product — MERAV Studio" }] }),
  validateSearch: (search: Record<string, unknown>): ProductCatalogSearch => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    category: isItemCategory(search.category) ? search.category : undefined,
    vendor: typeof search.vendor === "string" && search.vendor.trim() ? search.vendor : undefined,
    sample: isSampleFilter(search.sample) ? search.sample : undefined,
    project: typeof search.project === "string" && search.project.trim() ? search.project : undefined,
  }),
  component: ProductPage,
});

type ProductForm = Pick<Product,
  "name" | "category" | "subcategory" | "vendor" | "product_url" | "image_url" | "finish" | "sku" | "dimensions" | "price" | "unit_cost" | "shipping" | "notes" | "description" | "has_sample"
>;

const PRODUCT_IMAGE_BUCKET = "product-images";

function ProductPage() {
  const { productId } = Route.useParams();
  const catalogSearch = Route.useSearch();
  const safeProductId = cleanUuid(productId);
  const qc = useQueryClient();
  const { data: product, isLoading } = useQuery({
    queryKey: ["product", safeProductId],
    queryFn: () => db.getProduct(safeProductId!),
    enabled: !!safeProductId,
  });
  const [form, setForm] = useState<ProductForm | null>(null);
  const [displayCategory, setDisplayCategory] = useState<ItemCategory>("Lighting");

  useEffect(() => {
    if (product) {
      setDisplayCategory(productDisplayCategory(product));
      setForm({
        name: product.name,
        category: product.category,
        subcategory: product.subcategory,
        vendor: product.vendor,
        product_url: product.product_url,
        image_url: product.image_url,
        finish: product.finish,
        sku: product.sku,
        dimensions: product.dimensions,
        price: product.price,
        unit_cost: product.unit_cost,
        shipping: product.shipping,
        notes: product.notes,
        description: product.description,
        has_sample: product.has_sample,
      });
    }
  }, [product]);

  if (!safeProductId) return <AppShell><div className="p-16 text-muted-foreground">Product not found.</div></AppShell>;
  if (isLoading) return <AppShell><div className="p-16 text-muted-foreground">Loading…</div></AppShell>;
  if (!product) return <AppShell><div className="p-16 text-muted-foreground">Product not found.</div></AppShell>;
  if (!form) return <AppShell><div className="p-16 text-muted-foreground">Loading…</div></AppShell>;

  const update = (patch: Partial<ProductForm>) => setForm((prev) => prev ? { ...prev, ...patch } : prev);
  const category = form.category as ProductCategory;
  const showSampleField = sampleAppliesToCategory(displayCategory);

  const save = async () => {
    if (!form.name.trim()) return toast.error("Product name required");
    const price = normalizeMoneyInput(form.price);
    const unit_cost = normalizeMoneyInput(form.unit_cost);
    const shipping = normalizeMoneyInput(form.shipping);
    await db.updateProduct(safeProductId, {
      ...form,
      name: form.name.trim(),
      vendor: clean(form.vendor),
      subcategory: clean(form.subcategory),
      product_url: clean(form.product_url),
      image_url: clean(form.image_url),
      finish: clean(form.finish),
      sku: clean(form.sku),
      dimensions: clean(form.dimensions),
      price,
      unit_cost,
      shipping,
      notes: clean(form.notes),
      description: clean(form.description),
    });
    await db.updateMaterialItemsByProduct(safeProductId, {
      category: displayCategory,
    });
    setForm((prev) => prev ? { ...prev, price, unit_cost, shipping } : prev);
    qc.invalidateQueries({ queryKey: ["product", safeProductId] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["materialItems"] });
    qc.invalidateQueries({ queryKey: ["procurement"] });
    toast.success("Product updated");
  };

  return (
    <AppShell>
      <div className="page-pad max-w-[1400px]">
        <Link to="/catalog" search={catalogSearch} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink mb-8">
          <ArrowLeft className="w-3.5 h-3.5" /> Product Catalog
        </Link>

        <div className="grid lg:grid-cols-[360px_1fr] gap-12 items-start">
          <div>
            <ProductImageEditor productId={safeProductId} form={form} onChange={update} />
            {form.product_url && (
              <a href={form.product_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm hover:underline">
                Vendor product page <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div>
            <div className="eyebrow mb-3">{displayCategory}{form.subcategory ? ` · ${form.subcategory}` : ""}</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl mb-10">{form.name || "Untitled Product"}</h1>

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Product Name" value={form.name} onChange={(value) => update({ name: value })} />
              <Field label="Vendor" value={form.vendor ?? ""} onChange={(value) => update({ vendor: value })} />
              <div>
                <Label className="eyebrow">Category</Label>
                <Select value={displayCategory} onValueChange={(value) => {
                  const nextDisplayCategory = value as ItemCategory;
                  const nextProductCategory = toProductCategory(nextDisplayCategory);
                  setDisplayCategory(nextDisplayCategory);
                  update({
                    category: nextProductCategory,
                    subcategory: SUBCATEGORIES[nextProductCategory][0],
                    has_sample: sampleAppliesToCategory(nextDisplayCategory) ? form.has_sample : false,
                  });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ALL_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="eyebrow">Subcategory</Label>
                <Select value={form.subcategory ?? SUBCATEGORIES[category][0]} onValueChange={(value) => update({ subcategory: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SUBCATEGORIES[category].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Field label="Client Price" value={form.price ?? ""} onChange={(value) => update({ price: value })} />
              <Field label="Unit Cost" value={form.unit_cost ?? ""} onChange={(value) => update({ unit_cost: value })} />
              <Field label="Shipping" value={form.shipping ?? ""} onChange={(value) => update({ shipping: value })} />
              <Field label="Dimensions" value={form.dimensions ?? ""} onChange={(value) => update({ dimensions: value })} />
              <Field label="Finish" value={form.finish ?? ""} onChange={(value) => update({ finish: value })} />
              <Field label="SKU" value={form.sku ?? ""} onChange={(value) => update({ sku: value })} />
              {showSampleField && (
                <div>
                  <Label className="eyebrow">Sample</Label>
                  <Select value={form.has_sample ? "yes" : "no"} onValueChange={(value) => update({ has_sample: value === "yes" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Sample</SelectItem>
                      <SelectItem value="no">No sample</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Field label="Product URL" value={form.product_url ?? ""} onChange={(value) => update({ product_url: value })} className="md:col-span-2" />
              <Field label="Image URL" value={form.image_url ?? ""} onChange={(value) => update({ image_url: value })} className="md:col-span-2" />
              <LongField label="Notes" value={form.notes ?? ""} onChange={(value) => update({ notes: value })} />
              <LongField label="Description" value={form.description ?? ""} onChange={(value) => update({ description: value })} />
            </div>

            <button onClick={save} className="mt-8 inline-flex items-center gap-2 px-6 py-3 bg-ink text-primary-foreground text-sm">
              <Save className="w-4 h-4" /> Save Product
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ProductImageEditor({
  productId,
  form,
  onChange,
}: {
  productId: string;
  form: ProductForm;
  onChange: (patch: Partial<ProductForm>) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);

  const syncImageUrl = async (imageUrl: string | null) => {
    await db.updateProduct(productId, { image_url: imageUrl });
    onChange({ image_url: imageUrl });
    qc.invalidateQueries({ queryKey: ["product", productId] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["procurement"] });
  };

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be smaller than 10MB.");
      return;
    }

    setWorking(true);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || file.type.split("/").pop() || "jpg";
      const safeName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "product-image";
      const path = `${productId}/${Date.now()}-${safeName}.${extension}`;
      const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;

      const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);
      await syncImageUrl(data.publicUrl);
      toast.success("Product image updated");
    } catch (e: any) {
      toast.error(e?.message || "Unable to upload image.");
    } finally {
      setWorking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeImage = async () => {
    if (!form.image_url) return;
    setWorking(true);
    try {
      const storagePath = getProductImageStoragePath(form.image_url);
      await syncImageUrl(null);
      if (storagePath) await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]);
      toast.success("Product image removed");
    } catch (e: any) {
      toast.error(e?.message || "Unable to remove image.");
    } finally {
      setWorking(false);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) await uploadFile(file);
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOptionsOpen(true)}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        disabled={working}
        className={`group relative aspect-square w-full overflow-hidden border bg-bone text-left transition-colors disabled:cursor-wait disabled:opacity-70 ${dragging ? "border-ink" : "border-border hover:border-ink"}`}
        title="Edit product image"
      >
        {form.image_url ? (
          <img src={normalizeSupabaseImageUrl(form.image_url)} alt={form.name} className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
        ) : (
          <div className="w-full h-full grid place-items-center text-center text-sm text-muted-foreground">
            <div>
              <ImagePlus className="w-8 h-8 mx-auto mb-3 text-ink" />
              <div className="font-display text-2xl text-ink">Add product image</div>
              <p className="mt-2 px-8">Click to upload or drag a screenshot/image here.</p>
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-4 text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex items-center gap-2 text-sm">
            <Upload className="w-4 h-4" />
            {working ? "Updating image..." : "Click for image options or drag to replace"}
          </div>
        </div>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) uploadFile(file);
        }}
      />

      <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-normal">Product image</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setOptionsOpen(false);
                inputRef.current?.click();
              }}
              disabled={working}
              className="flex w-full items-center gap-3 border border-border p-4 text-left transition-colors hover:border-ink hover:bg-bone/60 disabled:opacity-50"
            >
              <span className="grid h-10 w-10 place-items-center bg-bone">
                <ImagePlus className="w-5 h-5" />
              </span>
              <span>
                <span className="block font-display text-xl">Replace image</span>
                <span className="block text-sm text-muted-foreground">Upload a new screenshot or product photo.</span>
              </span>
            </button>

            {form.image_url && (
              <button
                type="button"
                onClick={async () => {
                  setOptionsOpen(false);
                  await removeImage();
                }}
                disabled={working}
                className="flex w-full items-center gap-3 border border-destructive/30 p-4 text-left text-destructive transition-colors hover:border-destructive hover:bg-destructive/5 disabled:opacity-50"
              >
                <span className="grid h-10 w-10 place-items-center bg-destructive/10">
                  <Trash2 className="w-5 h-5" />
                </span>
                <span>
                  <span className="block font-display text-xl">Remove image</span>
                  <span className="block text-sm text-destructive/75">Clear this product image from the catalog.</span>
                </span>
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Tip: click the image for options, or drag a saved screenshot onto it to replace instantly.
      </p>
    </div>
  );
}

function Field({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <div className={className}>
      <Label className="eyebrow">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function LongField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="md:col-span-2">
      <Label className="eyebrow">{label}</Label>
      <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function clean(value?: string | null) {
  return value?.trim() || null;
}

function getProductImageStoragePath(imageUrl: string) {
  const marker = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
  const index = imageUrl.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(imageUrl.slice(index + marker.length));
}
