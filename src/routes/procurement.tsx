import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { db, type FinancialInvoice } from "@/lib/db";
import { AlertTriangle, Check, ChevronDown, DollarSign, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { canViewProcurement } from "@/lib/permissions";
import { formatMoney, moneyValue, normalizeMoneyInput, procurementTotals } from "@/lib/money";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { ProductInvoiceCreator } from "@/components/ProductInvoiceCreator";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ProcurementMaterialDetails = {
  id: string;
  client_product_name: string | null;
  quantity: number | null;
  color: string | null;
  image_url: string | null;
  product_url: string | null;
  cad_label: string | null;
};

type ProductInvoiceSummary = {
  id: string;
  projectId: string | null;
  name: string;
  total: number;
  sortDate: string;
  sourceIds: Set<string>;
};

function externalHref(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!/\s/.test(trimmed) && /^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function NeedsReselectionBadge() {
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-800">
      <AlertTriangle className="h-3 w-3" />
      Needs re-selection
    </span>
  );
}

export const Route = createFileRoute("/procurement")({
  head: () => ({ meta: [{ title: "Procurement — MERAV Studio" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    project: typeof search.project === "string" ? search.project : undefined,
  }),
  component: ProcurementPage,
});

function ProcurementPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [projectFilter, setProjectFilter] = useState(search.project ?? "__overall");
  const [roomFilters, setRoomFilters] = useState<string[]>([]);
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [vendorFilters, setVendorFilters] = useState<string[]>([]);
  const [invoiceFilter, setInvoiceFilter] = useState("__all");
  const [approvalFilter, setApprovalFilter] = useState<"all" | "needs_reselection">("all");
  const [taxRate, setTaxRate] = useState(() => {
    if (typeof window === "undefined") return "0";
    return window.localStorage.getItem("merav.procurement.taxRate") ?? "0";
  });
  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentProfile"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) return null;
      return (await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle()).data;
    },
  });
  const allowed = canViewProcurement(profile);
  const { data: procurementItems = [] } = useQuery({
    queryKey: ["procurement"],
    queryFn: async () => (await db.listProcurement()) ?? [],
    enabled: allowed,
  });
  const { data: financialInvoices = [] } = useQuery({
    queryKey: ["financialInvoices", "all"],
    queryFn: async () => (await db.listAllFinancialInvoices()) ?? [],
    enabled: allowed,
  });
  const projectOptions = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; client_name: string; status: string }
    >();
    procurementItems.forEach((item) => {
      const project = item.room_product?.room?.project;
      if (project?.id) map.set(project.id, project);
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.status === "Complete" && b.status !== "Complete") return 1;
      if (a.status !== "Complete" && b.status === "Complete") return -1;
      return a.name.localeCompare(b.name);
    });
  }, [procurementItems]);
  useEffect(() => {
    window.localStorage.setItem("merav.procurement.taxRate", taxRate);
  }, [taxRate]);
  useEffect(() => {
    setProjectFilter(search.project ?? "__overall");
    setRoomFilters([]);
    setCategoryFilters([]);
    setVendorFilters([]);
    setInvoiceFilter("__all");
    setApprovalFilter("all");
  }, [search.project]);

  const projectItems =
    projectFilter === "__overall"
      ? procurementItems
      : procurementItems.filter((item) => item.room_product?.room?.project?.id === projectFilter);

  const roomOptions = useMemo(() => {
    const map = new Map<string, string>();
    projectItems.forEach((item) => {
      const room = item.room_product?.room;
      if (room?.id && room.name) map.set(room.id, room.name);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projectItems]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    projectItems.forEach((item) => {
      const category = item.room_product?.product?.category;
      if (category) set.add(category);
    });
    return Array.from(set).sort();
  }, [projectItems]);

  const vendorOptions = useMemo(() => {
    const set = new Set<string>();
    projectItems.forEach((item) => {
      const vendor = item.room_product?.product?.vendor;
      if (vendor) set.add(vendor);
    });
    return Array.from(set).sort();
  }, [projectItems]);

  const productInvoices = useMemo(
    () =>
      financialInvoices
        .map(productInvoiceFromFinancialInvoice)
        .filter((invoice): invoice is ProductInvoiceSummary => !!invoice),
    [financialInvoices],
  );

  const selectedProjectInvoices = useMemo(
    () =>
      productInvoices
        .filter((invoice) => projectFilter === "__overall" || invoice.projectId === projectFilter)
        .sort((a, b) => b.sortDate.localeCompare(a.sortDate)),
    [productInvoices, projectFilter],
  );

  const selectedInvoiceItemIds = useMemo(() => {
    if (invoiceFilter === "__all") return null;
    return (
      selectedProjectInvoices.find((invoice) => invoice.id === invoiceFilter)?.sourceIds ?? null
    );
  }, [invoiceFilter, selectedProjectInvoices]);

  const visibleItems = useMemo(
    () =>
      projectItems.filter((item) => {
        const product = item.room_product?.product;
        const room = item.room_product?.room;
        if (roomFilters.length > 0 && (!room?.id || !roomFilters.includes(room.id))) return false;
        if (
          categoryFilters.length > 0 &&
          (!product?.category || !categoryFilters.includes(product.category))
        )
          return false;
        if (
          vendorFilters.length > 0 &&
          (!product?.vendor || !vendorFilters.includes(product.vendor))
        )
          return false;
        if (approvalFilter === "needs_reselection" && item.room_product?.approval_status !== "declined") {
          return false;
        }
        if (selectedInvoiceItemIds && !selectedInvoiceItemIds.has(item.id)) return false;
        return true;
      }),
    [approvalFilter, projectItems, roomFilters, categoryFilters, selectedInvoiceItemIds, vendorFilters],
  );

  const toggle = async (
    materialItemId: string,
    key: "ordered" | "received" | "installed",
    value: boolean,
  ) => {
    await db.updateProcurement(materialItemId, { [key]: value });
    qc.invalidateQueries({ queryKey: ["procurement"] });
  };

  const updateProductPricing = async (
    productId: string,
    values: { price: string; unit_cost: string; shipping: string },
  ) => {
    await db.updateProduct(productId, {
      price: normalizeMoneyInput(values.price),
      unit_cost: normalizeMoneyInput(values.unit_cost),
      shipping: normalizeMoneyInput(values.shipping),
    });
    qc.invalidateQueries({ queryKey: ["procurement"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["product", productId] });
  };

  const updateProductText = async (
    productId: string,
    key: "name" | "vendor" | "product_url" | "finish" | "dimensions",
    value: string,
  ) => {
    const next = value.trim();
    if (key === "name" && !next) return;
    await db.updateProduct(productId, { [key]: next || null });
    qc.invalidateQueries({ queryKey: ["procurement"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["product", productId] });
  };

  const updateMaterialText = async (
    materialId: string,
    key: "client_product_name" | "product_url" | "color",
    value: string,
  ) => {
    await db.updateMaterialItem(materialId, { [key]: value.trim() || null });
    qc.invalidateQueries({ queryKey: ["procurement"] });
  };

  const updateMaterialQuantity = async (materialId: string, value: string) => {
    const trimmed = value.trim();
    const quantity = trimmed === "" ? null : Number(trimmed);
    if (quantity !== null && !Number.isFinite(quantity)) return;
    await db.updateMaterialItem(materialId, { quantity });
    qc.invalidateQueries({ queryKey: ["procurement"] });
  };

  const total = visibleItems.length;
  const ordered = visibleItems.filter((i) => i.ordered).length;
  const received = visibleItems.filter((i) => i.received).length;
  const installed = visibleItems.filter((i) => i.installed).length;
  const approvedVisibleItems = visibleItems.filter(
    (item) => item.room_product?.approval_status === "approved",
  );
  const orderableVisibleItems = visibleItems.filter(
    (item) => item.room_product?.approval_status !== "declined",
  );
  const needsReselectionCount = projectItems.filter(
    (item) => item.room_product?.approval_status === "declined",
  ).length;
  const money = procurementTotals(orderableVisibleItems, taxRate);
  const selectedProject =
    projectFilter === "__overall"
      ? null
      : (projectOptions.find((project) => project.id === projectFilter) ?? null);

  if (loadingProfile) {
    return (
      <AppShell>
        <div className="p-16 text-muted-foreground">Checking access...</div>
      </AppShell>
    );
  }

  if (!allowed) {
    return (
      <AppShell>
        <div className="page-pad max-w-[900px]">
          <div className="eyebrow mb-3">Restricted</div>
          <h1 className="editorial-hero text-5xl lg:text-6xl">Procurement</h1>
          <p className="mt-4 text-muted-foreground max-w-xl">
            Procurement is currently available only to Ken and Katie.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-pad max-w-[1700px]">
        <div className="mb-12">
          <div className="eyebrow mb-3">Workflow</div>
          <h1 className="editorial-hero text-5xl lg:text-7xl">Procurement</h1>
          <p className="mt-4 text-muted-foreground max-w-xl">
            Everything needed to place an order — product, vendor, link, quantity, color,
            dimensions, and pricing.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
          <MoneyStat label="Subtotal" value={money.subtotal} />
          <MoneyStat label="Tax" value={money.tax}>
            <label className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              Rate
              <input
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="h-7 w-16 border border-input bg-background px-2 text-right text-xs text-ink"
                inputMode="decimal"
              />
              %
            </label>
          </MoneyStat>
          <MoneyStat label="Shipping" value={money.shipping} />
          <MoneyStat label="Client Total" value={money.total} />
          <MoneyStat label="Studio Cost" value={money.cost} />
          <MoneyStat label="Profit" value={money.profit} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-12">
          <Stat label="Total Items" n={total} />
          <Stat label="Ordered" n={ordered} total={total} />
          <Stat label="Received" n={received} total={total} />
          <Stat label="Installed" n={installed} total={total} />
        </div>

        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div className="w-full sm:min-w-[280px] sm:w-auto">
            <label className="eyebrow block mb-2">Project</label>
            <select
              value={projectFilter}
              onChange={(e) => {
                setProjectFilter(e.target.value);
                setRoomFilters([]);
                setCategoryFilters([]);
                setVendorFilters([]);
                setInvoiceFilter("__all");
              }}
              className="h-10 w-full border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="__overall">Overall · All Projects</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} · {project.client_name}
                  {project.status === "Complete" ? " · Archived" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:min-w-[200px] sm:w-auto">
            <MultiFilter
              label="Room"
              allLabel="All Rooms"
              options={roomOptions}
              selected={roomFilters}
              onChange={setRoomFilters}
            />
          </div>
          <div className="w-full sm:min-w-[200px] sm:w-auto">
            <MultiFilter
              label="Category"
              allLabel="All Categories"
              options={categoryOptions.map((category) => ({ id: category, name: category }))}
              selected={categoryFilters}
              onChange={setCategoryFilters}
            />
          </div>
          <div className="w-full sm:min-w-[220px] sm:w-auto">
            <MultiFilter
              label="Vendor"
              allLabel="All Vendors"
              options={vendorOptions.map((vendor) => ({ id: vendor, name: vendor }))}
              selected={vendorFilters}
              onChange={setVendorFilters}
            />
          </div>
          <div className="w-full sm:min-w-[240px] sm:w-auto">
            <label className="eyebrow block mb-2">Invoice</label>
            <select
              value={invoiceFilter}
              onChange={(e) => setInvoiceFilter(e.target.value)}
              className="h-10 w-full border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="__all">All Product Invoices</option>
              {selectedProjectInvoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.name} · {formatMoney(invoice.total)}
                </option>
              ))}
            </select>
          </div>
          {needsReselectionCount > 0 && (
            <div className="w-full sm:w-auto">
              <label className="eyebrow block mb-2">Approval</label>
              <button
                type="button"
                onClick={() =>
                  setApprovalFilter((current) =>
                    current === "needs_reselection" ? "all" : "needs_reselection",
                  )
                }
                className={cn(
                  "h-10 border px-3 text-xs tracking-[0.16em] uppercase",
                  approvalFilter === "needs_reselection"
                    ? "border-red-700 bg-red-50 text-red-800"
                    : "border-border text-red-700 hover:border-red-700",
                )}
              >
                Needs re-selection ({needsReselectionCount})
              </button>
            </div>
          )}
          <div className="w-full sm:w-auto sm:ml-auto">
            <label className="eyebrow block mb-2">Invoice</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <ProductInvoiceCreator
                projectId={selectedProject?.id ?? null}
                projectName={selectedProject?.name ?? ""}
                clientName={selectedProject?.client_name ?? ""}
                items={orderableVisibleItems}
                defaultTaxRate={taxRate}
                disabled={!selectedProject || orderableVisibleItems.length === 0}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["financialInvoices", selectedProject?.id] });
                  qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
                }}
              />
              <ProductInvoiceCreator
                projectId={selectedProject?.id ?? null}
                projectName={selectedProject?.name ?? ""}
                clientName={selectedProject?.client_name ?? ""}
                items={visibleItems}
                defaultTaxRate={taxRate}
                onlyApproved
                buttonLabel="Invoice Approved"
                disabled={!selectedProject || approvedVisibleItems.length === 0}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["financialInvoices", selectedProject?.id] });
                  qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
                }}
              />
            </div>
            {!selectedProject && (
              <div className="mt-2 text-xs text-muted-foreground">
                Choose one project to create an invoice.
              </div>
            )}
          </div>
        </div>

        <div className="mobile-card-scroll border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] tracking-[0.15em] uppercase text-muted-foreground border-b border-border bg-bone/30">
                <th className="px-3 py-3 min-w-[240px]">Client Product Name</th>
                <th className="px-3 py-3">Vendor</th>
                <th className="px-3 py-3">Link</th>
                <th className="px-3 py-3 text-center w-[60px]">Qty</th>
                <th className="px-3 py-3">Color</th>
                <th className="px-3 py-3">Dimensions</th>
                <th className="px-3 py-3 min-w-[190px]">Pricing</th>
                <th className="px-3 py-3">Project · Room</th>
                <th className="px-3 py-3 text-center w-[70px]">Ordered</th>
                <th className="px-3 py-3 text-center w-[70px]">Received</th>
                <th className="px-3 py-3 text-center w-[70px]">Installed</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-20 text-center text-sm text-muted-foreground">
                    No procurement items for this view yet. Add products to a room to populate.
                  </td>
                </tr>
              )}
              {visibleItems.map((item) => {
                const p = item.room_product?.product;
                const r = item.room_product?.room;
                const m = (item as typeof item & { material?: ProcurementMaterialDetails | null })
                  .material;
                const link = m?.product_url || p?.product_url || null;
                const linkHref = externalHref(link);
                const imageUrl = m?.image_url || p?.image_url || null;
                const clientName =
                  m?.client_product_name ||
                  [r?.name, p?.category].filter(Boolean).join(" ") ||
                  p?.name ||
                  "—";
                const needsReselection = item.room_product?.approval_status === "declined";
                return (
                  <tr key={item.id} className={cn("border-b border-border align-top", needsReselection && "bg-red-50/35")}>
                    <td className="px-3 py-3">
                      <div className="flex items-start gap-3 text-left">
                        <div className="w-12 h-12 bg-bone overflow-hidden flex-shrink-0 border border-border">
                          {p?.id ? (
                            <Link
                              to="/catalog/$productId"
                              params={{ productId: p.id }}
                              title={`Open ${clientName}`}
                            >
                              {imageUrl && (
                                <img
                                  src={normalizeSupabaseImageUrl(imageUrl)}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              )}
                            </Link>
                          ) : imageUrl ? (
                            <img
                              src={normalizeSupabaseImageUrl(imageUrl)}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <EditableTextCell
                            value={clientName === "—" ? "" : clientName}
                            disabled={!p?.id && !m?.id}
                            placeholder="Client product name"
                            displayClassName="font-display text-base leading-tight max-w-[220px]"
                            inputClassName="w-56"
                            onSave={(value) =>
                              m?.id
                                ? updateMaterialText(m.id, "client_product_name", value)
                                : p?.id
                                  ? updateProductText(p.id, "name", value)
                                  : Promise.resolve()
                            }
                          />
                          <div className="text-[10px] text-muted-foreground truncate max-w-[220px]">
                            {[p?.name, m?.cad_label, p?.sku && `SKU ${p.sku}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                          {needsReselection && <NeedsReselectionBadge />}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <EditableTextCell
                        value={p?.vendor ?? ""}
                        disabled={!p?.id}
                        placeholder="Vendor"
                        onSave={(value) =>
                          p?.id ? updateProductText(p.id, "vendor", value) : Promise.resolve()
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <EditableLinkCell
                        value={link ?? ""}
                        href={linkHref}
                        disabled={!p?.id && !m?.id}
                        onSave={(value) =>
                          m?.id
                            ? updateMaterialText(m.id, "product_url", value)
                            : p?.id
                              ? updateProductText(p.id, "product_url", value)
                              : Promise.resolve()
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-center font-display text-base">
                      <EditableNumberCell
                        value={m?.quantity?.toString() ?? ""}
                        disabled={!m?.id}
                        onSave={(value) =>
                          m?.id ? updateMaterialQuantity(m.id, value) : Promise.resolve()
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <EditableTextCell
                        value={m?.color || p?.finish || ""}
                        disabled={!p?.id && !m?.id}
                        placeholder="Color / finish"
                        onSave={(value) =>
                          m?.id
                            ? updateMaterialText(m.id, "color", value)
                            : p?.id
                              ? updateProductText(p.id, "finish", value)
                              : Promise.resolve()
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <EditableTextCell
                        value={p?.dimensions ?? ""}
                        disabled={!p?.id}
                        placeholder="Dimensions"
                        onSave={(value) =>
                          p?.id ? updateProductText(p.id, "dimensions", value) : Promise.resolve()
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <PricingEditor
                        productName={clientName}
                        price={p?.price ?? ""}
                        unitCost={p?.unit_cost ?? ""}
                        shipping={p?.shipping ?? ""}
                        disabled={!p?.id}
                        onSave={(values) =>
                          p?.id ? updateProductPricing(p.id, values) : Promise.resolve()
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      <div className="truncate max-w-[140px]">{r?.project?.name}</div>
                      <div className="text-ink truncate max-w-[140px]">{r?.name}</div>
                    </td>
                    {(["ordered", "received", "installed"] as const).map((k) => (
                      <td key={k} className="px-3 py-3">
                        <div className="flex justify-center">
                          <button
                            disabled={needsReselection}
                            onClick={() => m?.id && toggle(m.id, k, !item[k])}
                            className={cn(
                              "w-6 h-6 border flex items-center justify-center transition-colors",
                              needsReselection && "cursor-not-allowed opacity-40",
                              item[k]
                                ? "bg-ink border-ink text-primary-foreground"
                                : "border-border hover:border-ink",
                            )}
                          >
                            {item[k] && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
                          </button>
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function PricingEditor({
  productName,
  price,
  unitCost,
  shipping,
  disabled,
  onSave,
}: {
  productName: string;
  price: string;
  unitCost: string;
  shipping: string;
  disabled?: boolean;
  onSave: (values: { price: string; unit_cost: string; shipping: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => ({
    price: moneyDraft(price),
    unit_cost: moneyDraft(unitCost),
    shipping: moneyDraft(shipping),
  }));

  useEffect(() => {
    if (!open) {
      setDraft({
        price: moneyDraft(price),
        unit_cost: moneyDraft(unitCost),
        shipping: moneyDraft(shipping),
      });
    }
  }, [open, price, shipping, unitCost]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "min-w-[170px] border border-border bg-background px-3 py-2 text-left transition-colors",
            disabled ? "cursor-not-allowed text-muted-foreground" : "hover:border-ink",
          )}
          title={disabled ? undefined : "Edit client price, studio cost, and shipping"}
        >
          <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <DollarSign className="h-3 w-3" /> Edit Pricing
          </span>
          <PricingSummary label="Client" value={price} />
          <PricingSummary label="Studio Cost" value={unitCost} />
          <PricingSummary label="Shipping" value={shipping} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="mb-4">
          <div className="eyebrow mb-1">Edit Pricing</div>
          <div className="font-display text-lg leading-tight">{productName}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            These values also update the Product Catalog.
          </p>
        </div>
        <div className="space-y-3">
          <MoneyInput
            label="Client Price"
            value={draft.price}
            onChange={(value) => setDraft((current) => ({ ...current, price: value }))}
          />
          <MoneyInput
            label="Studio Cost"
            value={draft.unit_cost}
            onChange={(value) => setDraft((current) => ({ ...current, unit_cost: value }))}
          />
          <MoneyInput
            label="Shipping"
            value={draft.shipping}
            onChange={(value) => setDraft((current) => ({ ...current, shipping: value }))}
          />
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-9 border border-border px-4 text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-9 bg-ink px-4 text-xs text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Pricing"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function moneyDraft(value: string) {
  return value.replace(/[^0-9.-]/g, "");
}

function displayMoney(value: string) {
  return value.trim() ? formatMoney(moneyValue(value)) : "—";
}

function PricingSummary({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center justify-between gap-3 text-xs leading-5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-ink">{displayMoney(value)}</span>
    </span>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      <span className="flex h-10 items-center border border-input bg-background focus-within:border-ink">
        <span className="px-3 text-sm text-muted-foreground">$</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          className="h-full min-w-0 flex-1 bg-transparent pr-3 text-right text-sm outline-none"
          placeholder="0.00"
        />
      </span>
    </label>
  );
}

function EditableTextCell({
  value,
  disabled,
  placeholder,
  displayClassName,
  inputClassName,
  onSave,
}: {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  displayClassName?: string;
  inputClassName?: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const save = async () => {
    const next = draft.trim();
    const current = value.trim();
    setEditing(false);
    if (next === current) return;
    await onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setEditing(true)}
        className={cn(
          "max-w-[150px] truncate text-left underline-offset-4",
          displayClassName,
          disabled ? "text-muted-foreground" : "hover:underline hover:text-ink",
        )}
        title={disabled ? undefined : "Click to edit"}
      >
        {value.trim() || "—"}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cn("h-8 w-40 border border-input bg-background px-2 text-xs", inputClassName)}
      placeholder={placeholder}
    />
  );
}

function EditableNumberCell({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const save = async () => {
    const next = draft.trim();
    const current = value.trim();
    setEditing(false);
    if (next === current) return;
    await onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setEditing(true)}
        className={cn(
          "min-w-10 text-center underline-offset-4",
          disabled ? "text-muted-foreground" : "hover:underline hover:text-ink",
        )}
        title={disabled ? undefined : "Click to edit"}
      >
        {value.trim() || "—"}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="h-8 w-16 border border-input bg-background px-2 text-center text-xs"
      inputMode="decimal"
      placeholder="Qty"
    />
  );
}

function EditableLinkCell({
  value,
  href,
  disabled,
  onSave,
}: {
  value: string;
  href: string | null;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  return (
    <div className="flex max-w-[210px] items-center gap-2">
      <EditableTextCell
        value={value}
        disabled={disabled}
        placeholder="Product link"
        displayClassName="max-w-[170px]"
        inputClassName="w-64"
        onSave={onSave}
      />
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-ink"
          title="Open link"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function MultiFilter({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: Array<{ id: string; name: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const selectedNames = options
    .filter((option) => selected.includes(option.id))
    .map((option) => option.name);
  const display =
    selectedNames.length === 0
      ? allLabel
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames.length} selected`;

  const toggleOption = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  };

  return (
    <div>
      <label className="eyebrow block mb-2">{label}</label>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-10 w-full border border-input bg-background px-3 py-2 text-sm flex items-center justify-between gap-3"
          >
            <span className="truncate">{display}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="border-b border-border p-3 flex items-center justify-between gap-3">
            <div className="eyebrow">{label}</div>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {options.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                No options yet.
              </div>
            ) : (
              options.map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-center gap-3 px-2 py-2 text-sm hover:bg-bone"
                >
                  <Checkbox
                    checked={selected.includes(option.id)}
                    onCheckedChange={() => toggleOption(option.id)}
                  />
                  <span className="truncate">{option.name}</span>
                </label>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function MoneyStat({
  label,
  value,
  children,
}: {
  label: string;
  value: number;
  children?: ReactNode;
}) {
  return (
    <div className="border border-border p-5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="font-display text-3xl">{formatMoney(value)}</div>
      {children}
    </div>
  );
}

function Stat({ label, n, total }: { label: string; n: number; total?: number }) {
  const pct = total ? Math.round((n / total) * 100) : null;
  return (
    <div className="border border-border p-5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="font-display text-4xl">{n}</div>
        {pct !== null && <div className="text-xs text-muted-foreground">{pct}%</div>}
      </div>
      {total !== undefined && (
        <div className="mt-3 h-px bg-border relative">
          <div
            className="absolute inset-y-0 left-0 bg-brass"
            style={{ width: `${pct ?? 0}%`, height: 1 }}
          />
        </div>
      )}
    </div>
  );
}

function productInvoiceFromFinancialInvoice(
  invoice: FinancialInvoice,
): ProductInvoiceSummary | null {
  if (!invoice.raw_text) return null;
  try {
    const parsed = JSON.parse(invoice.raw_text) as {
      type?: string;
      draft?: {
        invoiceName?: string;
        lines?: Array<{ sourceId?: string; selected?: boolean }>;
      };
    };
    if (parsed.type !== "product_invoice") return null;
    const sourceIds = new Set(
      (parsed.draft?.lines ?? [])
        .filter((line) => line.selected !== false && line.sourceId)
        .map((line) => line.sourceId as string),
    );
    return {
      id: invoice.id,
      projectId: invoice.project_id,
      name: invoice.file_name || parsed.draft?.invoiceName || "Product Invoice",
      total: Number(invoice.total_amount || 0),
      sortDate: invoice.invoice_date || invoice.created_at || "",
      sourceIds,
    };
  } catch {
    return null;
  }
}
