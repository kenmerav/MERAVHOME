import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Save } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, PRODUCT_CATEGORIES, SUBCATEGORIES, type Product, type ProductCategory } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/catalog_/$productId")({
  head: () => ({ meta: [{ title: "Product — MERAV Studio" }] }),
  component: ProductPage,
});

type ProductForm = Pick<Product,
  "name" | "category" | "subcategory" | "vendor" | "product_url" | "image_url" | "finish" | "sku" | "dimensions" | "price" | "unit_cost" | "shipping" | "notes" | "description"
>;

function ProductPage() {
  const { productId } = Route.useParams();
  const qc = useQueryClient();
  const { data: product, isLoading } = useQuery({
    queryKey: ["product", productId],
    queryFn: () => db.getProduct(productId),
  });
  const [form, setForm] = useState<ProductForm | null>(null);

  useEffect(() => {
    if (product) {
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
      });
    }
  }, [product]);

  if (isLoading) return <AppShell><div className="p-16 text-muted-foreground">Loading…</div></AppShell>;
  if (!product) return <AppShell><div className="p-16 text-muted-foreground">Product not found.</div></AppShell>;
  if (!form) return <AppShell><div className="p-16 text-muted-foreground">Loading…</div></AppShell>;

  const update = (patch: Partial<ProductForm>) => setForm((prev) => prev ? { ...prev, ...patch } : prev);
  const category = form.category as ProductCategory;

  const save = async () => {
    if (!form.name.trim()) return toast.error("Product name required");
    await db.updateProduct(productId, {
      ...form,
      name: form.name.trim(),
      vendor: clean(form.vendor),
      subcategory: clean(form.subcategory),
      product_url: clean(form.product_url),
      image_url: clean(form.image_url),
      finish: clean(form.finish),
      sku: clean(form.sku),
      dimensions: clean(form.dimensions),
      price: clean(form.price),
      unit_cost: clean(form.unit_cost),
      shipping: clean(form.shipping),
      notes: clean(form.notes),
      description: clean(form.description),
    });
    qc.invalidateQueries({ queryKey: ["product", productId] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["procurement"] });
    toast.success("Product updated");
  };

  return (
    <AppShell>
      <div className="page-pad max-w-[1400px]">
        <Link to="/catalog" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink mb-8">
          <ArrowLeft className="w-3.5 h-3.5" /> Product Catalog
        </Link>

        <div className="grid lg:grid-cols-[360px_1fr] gap-12 items-start">
          <div>
            <div className="aspect-square bg-bone border border-border overflow-hidden">
              {form.image_url ? (
                <img src={form.image_url} alt={form.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-sm text-muted-foreground">No image</div>
              )}
            </div>
            {form.product_url && (
              <a href={form.product_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm hover:underline">
                Vendor product page <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div>
            <div className="eyebrow mb-3">{form.category}{form.subcategory ? ` · ${form.subcategory}` : ""}</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl mb-10">{form.name || "Untitled Product"}</h1>

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Product Name" value={form.name} onChange={(value) => update({ name: value })} />
              <Field label="Vendor" value={form.vendor ?? ""} onChange={(value) => update({ vendor: value })} />
              <div>
                <Label className="eyebrow">Category</Label>
                <Select value={form.category} onValueChange={(value) => update({ category: value as ProductCategory, subcategory: SUBCATEGORIES[value as ProductCategory][0] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRODUCT_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
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
