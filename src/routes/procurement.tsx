import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { db, type FinancialInvoice, type Product, type ProcurementItem } from "@/lib/db";
import { saveMaterialProductDetails } from "@/lib/materialProductEdit";
import { productPricingPatch, type ProductPricingDraft } from "@/lib/productPricingEdit";
import { materialPriceUnit, type ProductPriceUnit } from "@/lib/productPriceUnit";
import { AlertTriangle, Check, ChevronDown, DollarSign, ExternalLink, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { canViewProcurement } from "@/lib/permissions";
import {
  clientPriceFromMarkup,
  formatMoney,
  moneyValue,
  normalizeMoneyInput,
  procurementTotals,
  type MarkupBasis,
} from "@/lib/money";
import { normalizeSupabaseImageUrl } from "@/lib/local-assets";
import { ProductInvoiceCreator } from "@/components/ProductInvoiceCreator";
import { ProductInvoiceCosts } from "@/components/ProductInvoiceCosts";
import type { ProductInvoiceCostLine, ProductInvoiceFee } from "@/lib/productInvoiceProfit";
import { SpecQuantityEditor } from "@/components/SpecQuantityEditor";
import type { SpecQuantityPatch, SpecQuantityUnit } from "@/lib/specQuantity";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { financialInvoiceLedger } from "@/lib/financialInvoiceLedger";
import { saveDesignAccuracyPrice } from "@/lib/designAccuracyPricing";
import { downloadInvoiceDocument, openInvoiceDocument } from "@/lib/invoiceDocuments";

type ProcurementMaterialDetails = {
  id: string;
  client_product_name: string | null;
  category: string | null;
  quantity: number | null;
  quantity_tbd?: boolean;
  quantity_unit?: SpecQuantityUnit;
  color: string | null;
  image_url: string | null;
  product_url: string | null;
  cad_label: string | null;
};

const procurementStatuses = {
  ordered: "Ordered",
  received: "Received",
  installed: "Installed",
  out_of_stock: "Out of stock",
} as const;
type ProcurementStatus = keyof typeof procurementStatuses;
type StatusFilter = "all" | "yes" | "no";
type StatusFilters = Record<ProcurementStatus, StatusFilter>;
const allStatuses: StatusFilters = { ordered: "all", received: "all", installed: "all", out_of_stock: "all" };

type ProductInvoiceSummary = {
  id: string;
  projectId: string | null;
  name: string;
  documentUrl: string | null;
  paymentUrl: string | null;
  documentOptions: Parameters<typeof openInvoiceDocument>[2];
  total: number;
  amounts: {
    subtotal?: number;
    shipping?: number;
    tax?: number;
    fees: ProductInvoiceFee[];
    adjustment: number;
  };
  sortDate: string;
  sourceIds: Set<string>;
  sourceLineCount: number;
  costLines: ProductInvoiceCostLine[];
  sourceDraft: unknown;
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
  const [statusFilters, setStatusFilters] = useState<StatusFilters>(allStatuses);
  const [pendingStatuses, setPendingStatuses] = useState<Record<string, Partial<Record<ProcurementStatus, boolean>>>>({});
  const statusWrites = useRef(new Set<string>());
  const [showDesignerDiscount, setShowDesignerDiscount] = useState(false);
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
  const { data: procurementItems = [], error: procurementError, refetch: retryProcurement } = useQuery({
    queryKey: ["procurement"],
    queryFn: async () => (await db.listProcurement()) ?? [],
    enabled: allowed,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
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
    setStatusFilters(allStatuses);
  }, [search.project]);

  const displayedItems = useMemo(() => procurementItems.map((item) => {
    const pending = item.material?.id ? pendingStatuses[item.material.id] : undefined;
    return pending ? { ...item, ...pending } : item;
  }), [procurementItems, pendingStatuses]);

  const projectItems =
    projectFilter === "__overall"
      ? displayedItems
      : displayedItems.filter((item) => item.room_product?.room?.project?.id === projectFilter);

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
      const category = item.material?.category || item.room_product?.product?.category;
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

  const selectedProductInvoice = useMemo(
    () => selectedProjectInvoices.find((invoice) => invoice.id === invoiceFilter) ?? null,
    [invoiceFilter, selectedProjectInvoices],
  );

  const selectedInvoiceItemIds = selectedProductInvoice?.sourceIds ?? null;

  const viewSelectedInvoice = async () => {
    if (!selectedProductInvoice?.documentUrl)
      return toast.error("This invoice does not have a saved document.");
    try {
      await openInvoiceDocument(selectedProductInvoice.documentUrl, selectedProductInvoice.name, {
        paymentUrl: selectedProductInvoice.paymentUrl,
        ...selectedProductInvoice.documentOptions,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the invoice.");
    }
  };

  const downloadSelectedInvoice = async () => {
    if (!selectedProductInvoice?.documentUrl)
      return toast.error("This invoice does not have a saved document.");
    try {
      await downloadInvoiceDocument(
        selectedProductInvoice.documentUrl,
        selectedProductInvoice.name,
        {
          paymentUrl: selectedProductInvoice.paymentUrl,
          ...selectedProductInvoice.documentOptions,
        },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the invoice.");
    }
  };

  const visibleItems = useMemo(
    () =>
      projectItems.filter((item) => {
        const product = item.room_product?.product;
        const room = item.room_product?.room;
        const category = item.material?.category || product?.category;
        if (roomFilters.length > 0 && (!room?.id || !roomFilters.includes(room.id))) return false;
        if (categoryFilters.length > 0 && (!category || !categoryFilters.includes(category)))
          return false;
        if (
          vendorFilters.length > 0 &&
          (!product?.vendor || !vendorFilters.includes(product.vendor))
        )
          return false;
        if (
          approvalFilter === "needs_reselection" &&
          item.room_product?.approval_status !== "declined"
        ) {
          return false;
        }
        if (selectedInvoiceItemIds && !selectedInvoiceItemIds.has(item.id)) return false;
        if (Object.entries(statusFilters).some(([key, filter]) =>
          filter !== "all" && Boolean(item[key as ProcurementStatus]) !== (filter === "yes")
        )) return false;
        return true;
      }),
    [
      approvalFilter,
      projectItems,
      roomFilters,
      categoryFilters,
      selectedInvoiceItemIds,
      vendorFilters,
      statusFilters,
    ],
  );

  const visibleProducts = useMemo(() => {
    const productsById = new Map<string, Product>();
    visibleItems.forEach((item) => {
      const product = item.room_product?.product;
      if (product?.id) productsById.set(product.id, product);
    });
    return Array.from(productsById.values());
  }, [visibleItems]);

  const toggle = async (
    materialItemId: string,
    key: ProcurementStatus,
    value: boolean,
  ) => {
    const writeKey = `${materialItemId}:${key}`;
    if (statusWrites.current.has(writeKey)) return;
    statusWrites.current.add(writeKey);
    setPendingStatuses((current) => ({
      ...current,
      [materialItemId]: { ...current[materialItemId], [key]: value },
    }));
    try {
      await qc.cancelQueries({ queryKey: ["procurement"] });
      const saved: Pick<ProcurementItem, "id"> & Partial<ProcurementItem> = key === "out_of_stock"
        ? await db.updateProcurementAvailability(materialItemId, value)
        : await db.updateProcurement(materialItemId, { [key]: value });
      const savedValue = saved[key];
      if (typeof savedValue !== "boolean") throw new Error("Could not confirm the saved status. Please try again.");
      // Cancel any refresh started during the save before applying the confirmed field.
      await qc.cancelQueries({ queryKey: ["procurement"] });
      qc.setQueryData<typeof procurementItems>(["procurement"], (current) => current?.map((item) =>
        item.material?.id === saved.id ? {
          ...item,
          [key]: savedValue,
          updated_at: saved.updated_at ?? item.updated_at,
          material: key === "out_of_stock"
            ? { ...item.material, availability: { ...item.material.availability, out_of_stock: savedValue } }
            : { ...item.material, [key]: savedValue },
        } : item
      ));
      void qc.invalidateQueries({ queryKey: ["materialItems"], refetchType: "none" });
      void qc.invalidateQueries({ queryKey: ["procurement"], refetchType: "none" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not save ${procurementStatuses[key].toLowerCase()} status. Please try again.`);
    } finally {
      statusWrites.current.delete(writeKey);
      setPendingStatuses((current) => {
        const next = { ...current };
        const remaining = { ...next[materialItemId] };
        delete remaining[key];
        if (Object.keys(remaining).length) next[materialItemId] = remaining;
        else delete next[materialItemId];
        return next;
      });
    }
  };

  const saveProcurementNote = async (materialItemId: string, notes: string) => {
    const saved = await db.updateProcurementNote(materialItemId, notes);
    if (typeof saved.notes !== "string") throw new Error("Could not confirm the saved note. Please try again.");
    await qc.cancelQueries({ queryKey: ["procurement"] });
    qc.setQueryData<typeof procurementItems>(["procurement"], (current) => current?.map((item) =>
      item.material?.id === saved.id ? {
        ...item,
        notes: saved.notes,
        material: { ...item.material, availability: { ...item.material.availability, out_of_stock: Boolean(item.out_of_stock), notes: saved.notes } },
      } : item
    ));
    void qc.invalidateQueries({ queryKey: ["procurement"], refetchType: "none" });
  };

  const saveProductPatch = async (productId: string | undefined, materialId: string | undefined, patch: Partial<Product>) => {
    const savedId = materialId ? await saveMaterialProductDetails(materialId, patch) : productId;
    if (!savedId) throw new Error("Could not find this item.");
    if (!materialId && !await db.updateProduct(savedId, patch)) throw new Error("Could not save this item.");
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["procurement"] }),
      qc.invalidateQueries({ queryKey: ["materialItems"] }),
      qc.invalidateQueries({ queryKey: ["catalog"] }),
      qc.invalidateQueries({ queryKey: ["products"] }),
      qc.invalidateQueries({ queryKey: ["product", savedId] }),
      qc.invalidateQueries({ queryKey: ["roomProducts"] }),
    ]);
  };

  const syncDecisionPrice = async (item: (typeof visibleItems)[number], price: string | null | undefined, priceUnit?: ProductPriceUnit | null) => {
    const fact = item.material?.design_accuracy_fact;
    if (!fact) return;
    const projectId = item.room_product?.room?.project?.id;
    const roomId = item.room_product?.room?.id;
    const materialId = item.material?.id;
    if (!projectId || !roomId || !materialId) throw new Error("Could not find the linked Room Design selection.");
    const { data } = await supabase.auth.getSession();
    await saveDesignAccuracyPrice({ projectId, roomId, materialId, sourceId: fact.sourceId, selectionVersion: fact.selectionVersion, previousPrice: fact.price, previousPriceUnit: fact.priceUnit }, price, data.session?.access_token || "", priceUnit);
  };

  const updateProductPricing = async (item: (typeof visibleItems)[number], values: ProductPricingDraft, initial: ProductPricingDraft) => {
    const patch = productPricingPatch(values, initial);
    if (!Object.keys(patch).length) return;
    let decisionSaved = false;
    try {
      if (("price" in patch || "price_unit" in patch) && item.material?.design_accuracy_fact) {
        await syncDecisionPrice(item, "price" in patch ? patch.price ?? null : undefined, "price_unit" in patch ? patch.price_unit ?? null : undefined);
        decisionSaved = true;
      }
      await saveProductPatch(item.room_product?.product?.id, item.material?.id, patch);
      if (decisionSaved) toast.info("Pricing saved. Confirm the updated price and basis in Room Design before ordering.");
    } catch (error) {
      if (decisionSaved) throw new Error("The Spec Book price was saved, but the catalog pricing could not be saved. Refresh and check the other pricing fields.");
      throw error;
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["procurement"] }),
        qc.invalidateQueries({ queryKey: ["materialItems"] }),
      ]);
    }
  };

  const applyBulkMarkup = async (markupBasis: MarkupBasis, markupPercent: number) => {
    const updates = visibleProducts.flatMap((product) => {
      const retailPrice =
        product.retail_price || (product.markup_percent == null ? product.price : null);
      const clientPrice = clientPriceFromMarkup({
        retailPrice,
        ourPrice: product.unit_cost,
        markupPercent,
        markupBasis,
      });

      if (clientPrice == null) return [];

      return [
        {
          product,
          patch: {
            markup_percent: markupPercent,
            markup_basis: markupBasis,
            price: normalizeMoneyInput(clientPrice.toFixed(2)),
            ...(markupBasis === "retail_price" && !product.retail_price && retailPrice
              ? { retail_price: normalizeMoneyInput(retailPrice) }
              : {}),
          },
        },
      ];
    });

    let decisionsUpdated = 0;
    try {
    for (const item of visibleItems) {
      if (!item.material?.design_accuracy_fact) continue;
      const update = updates.find(({ product }) => product.id === item.room_product?.product?.id);
      if (update) {
        await syncDecisionPrice(item, update.patch.price);
        decisionsUpdated++;
      }
    }
    for (let start = 0; start < updates.length; start += 20) {
      const chunk = updates.slice(start, start + 20);
      await Promise.all(
        chunk.map(async ({ product, patch }) => {
          const saved = await db.updateProduct(product.id, patch);
          if (!saved) throw new Error(`Could not update ${product.name}.`);
        }),
      );
    }
    } catch (error) {
      if (decisionsUpdated) throw new Error("Some Room Design prices were saved before the update stopped. Refresh and review prices before retrying.");
      throw error;
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["procurement"] }),
        qc.invalidateQueries({ queryKey: ["materialItems"] }),
      ]);
    }

    if (updates.length > 0) {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["procurement"] }),
        qc.invalidateQueries({ queryKey: ["catalog"] }),
        qc.invalidateQueries({ queryKey: ["product"] }),
      ]);
    }
    if (decisionsUpdated) toast.info("Room Design prices changed. Confirm them in Room Design before ordering.");

    return {
      updated: updates.length,
      skipped: visibleProducts.length - updates.length,
    };
  };

  const updateProductText = async (
    productId: string | undefined,
    key: "name" | "vendor" | "product_url" | "finish" | "dimensions",
    value: string,
    materialId?: string,
  ) => {
    const next = value.trim();
    if (key === "name" && !next) return;
    await saveProductPatch(productId, materialId, { [key]: next || null });
  };

  const updateMaterialText = async (
    materialId: string,
    key: "client_product_name" | "product_url" | "color",
    value: string,
  ) => {
    const result = await db.updateMaterialItem(materialId, { [key]: value.trim() || null });
    if (result.error) throw result.error;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["procurement"] }),
      qc.invalidateQueries({ queryKey: ["materialItems"] }),
    ]);
  };

  const updateMaterialQuantity = async (materialId: string, patch: SpecQuantityPatch) => {
    await db.updateMaterialQuantity(materialId, patch);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["procurement"] }),
      qc.invalidateQueries({ queryKey: ["materialItems"] }),
    ]);
  };

  const total = visibleItems.length;
  const ordered = visibleItems.filter((i) => i.ordered).length;
  const received = visibleItems.filter((i) => i.received).length;
  const installed = visibleItems.filter((i) => i.installed).length;
  const approvedVisibleItems = visibleItems.filter(
    (item) => item.room_product?.product && item.room_product.approval_status === "approved",
  );
  const orderableVisibleItems = visibleItems.filter(
    (item) => item.room_product?.approval_status !== "declined",
  );
  const needsReselectionCount = projectItems.filter(
    (item) => item.room_product?.approval_status === "declined",
  ).length;
  const money = procurementTotals(orderableVisibleItems, taxRate, { unknownAsZero: true });
  const selectedProject =
    projectFilter === "__overall"
      ? null
      : (projectOptions.find((project) => project.id === projectFilter) ?? null);
  const handleProductInvoiceSaved = (invoiceId: string) => {
    setInvoiceFilter(invoiceId);
    void Promise.all([
      qc.invalidateQueries({ queryKey: ["financialInvoices", selectedProject?.id] }),
      qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] }),
    ]);
  };

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

  if (procurementError) {
    return (
      <AppShell>
        <div className="page-pad max-w-[900px]">
          <h1 className="editorial-hero text-5xl">Procurement</h1>
          <p role="alert" className="mt-4 text-muted-foreground">Could not verify the current Spec Book selections. Please try again.</p>
          <button className="mt-4 border border-border px-4 py-2" onClick={() => retryProcurement()}>Retry</button>
        </div>
      </AppShell>
    );
  }

  const productPricing = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
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
        <MoneyStat label="Our Price" value={money.cost} />
        <MoneyStat label="Product Profit" value={money.profit} />
      </div>

      {(money.unknownQuantities > 0 || money.missingPrices > 0 || money.missingCosts > 0 || money.incompatibleUnits > 0) && (
        <p className="mt-4 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Totals count TBD amounts as $0 until the missing information is filled in. Totals and profit may change.
          {money.unknownQuantities > 0 && ` ${money.unknownQuantities} missing or TBD quantities.`}
          {money.missingPrices > 0 && ` ${money.missingPrices} missing prices.`}
          {money.missingCosts > 0 && ` ${money.missingCosts} missing our prices.`}
          {money.incompatibleUnits > 0 && ` ${money.incompatibleUnits} price and quantity units need review and are excluded from price totals.`}
        </p>
      )}
    </>
  );

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

        {selectedProductInvoice && (
          <div className="mb-6">
            <SavedProductInvoiceTotals invoice={selectedProductInvoice} />
            <ProductInvoiceCosts
              key={selectedProductInvoice.id}
              invoiceId={selectedProductInvoice.id}
              subtotal={selectedProductInvoice.amounts.subtotal}
              shipping={selectedProductInvoice.amounts.shipping}
              fees={selectedProductInvoice.amounts.fees}
              lines={selectedProductInvoice.costLines}
              hasAdjustments={selectedProductInvoice.amounts.adjustment !== 0}
            />
          </div>
        )}

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
                setStatusFilters(allStatuses);
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
            {selectedProject && (
              <Link
                to="/projects/$id/financials"
                params={{ id: selectedProject.id }}
                className="mt-2 inline-flex text-xs text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
              >
                Manage invoice adjustments
              </Link>
            )}
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
            <div className="flex flex-col gap-2">
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
              {selectedProductInvoice && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={viewSelectedInvoice}
                    disabled={!selectedProductInvoice.documentUrl}
                    className="h-9 flex-1 border border-border px-3 text-xs hover:border-ink disabled:opacity-50"
                  >
                    View Saved Invoice
                  </button>
                  <button
                    type="button"
                    onClick={downloadSelectedInvoice}
                    disabled={!selectedProductInvoice.documentUrl}
                    className="h-9 flex-1 bg-ink px-3 text-xs text-primary-foreground disabled:opacity-50"
                  >
                    Download PDF
                  </button>
                </div>
              )}
            </div>
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
          <div className="w-full sm:w-auto">
            <label className="eyebrow block mb-2">Bulk Pricing</label>
            <BulkMarkupEditor products={visibleProducts} onApply={applyBulkMarkup} />
          </div>
          <div className="w-full sm:w-auto sm:ml-auto">
            <label className="eyebrow block mb-2">Invoice</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <ProductInvoiceCreator
                projectId={selectedProject?.id ?? null}
                projectName={selectedProject?.name ?? ""}
                clientName={selectedProject?.client_name ?? ""}
                items={selectedProductInvoice ? projectItems : orderableVisibleItems}
                sourceDraft={selectedProductInvoice?.sourceDraft}
                sourceInvoiceName={selectedProductInvoice?.name}
                defaultTaxRate={taxRate}
                disabled={!selectedProject || (selectedProductInvoice ? selectedProductInvoice.sourceLineCount === 0 : orderableVisibleItems.length === 0)}
                onSaved={handleProductInvoiceSaved}
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
                onSaved={handleProductInvoiceSaved}
              />
            </div>
            {!selectedProject && (
              <div className="mt-2 text-xs text-muted-foreground">
                Choose one project to create an invoice.
              </div>
            )}
          </div>
        </div>

        <fieldset aria-label="Status filters" className="mb-6 flex flex-wrap items-end gap-4">
          {(Object.keys(procurementStatuses) as ProcurementStatus[]).map((key) => (
            <div key={key} className="min-w-[160px] flex-1 sm:flex-none">
              <label htmlFor={`procurement-${key}-filter`} className="eyebrow mb-2 block">
                {procurementStatuses[key]}
              </label>
              <select
                id={`procurement-${key}-filter`}
                value={statusFilters[key]}
                onChange={(event) => setStatusFilters((current) => ({
                  ...current, [key]: event.target.value as StatusFilter,
                }))}
                className="h-10 w-full border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          ))}
          {Object.values(statusFilters).some((filter) => filter !== "all") && (
            <button type="button" onClick={() => setStatusFilters(allStatuses)} className="h-10 px-2 text-sm underline">
              Clear status filters
            </button>
          )}
          {Object.keys(pendingStatuses).length > 0 && (
            <p role="status" className="py-2 text-sm text-muted-foreground">Saving status…</p>
          )}
        </fieldset>

        <section aria-label="Filtered item totals" className="mb-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="eyebrow">
              {vendorFilters.length === 1 ? `${vendorFilters[0]} totals` : "Filtered item totals"}
            </h2>
            <span className="text-xs text-muted-foreground">
              {orderableVisibleItems.length} {orderableVisibleItems.length !== total ? "orderable " : ""}
              {orderableVisibleItems.length === 1 ? "item" : "items"}
            </span>
          </div>
          {productPricing}
        </section>

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
                <th className="px-3 py-3 text-center w-[90px]">Out of stock</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-20 text-center text-sm text-muted-foreground">
                    {projectItems.length > 0
                      ? "No items match these filters."
                      : "No procurement items for this view yet. Add products to a room to populate."}
                  </td>
                </tr>
              )}
              {visibleItems.map((item) => {
                const p = item.room_product?.product;
                const r = item.room_product?.room;
                const m = (item as typeof item & { material?: ProcurementMaterialDetails | null })
                  .material;
                const link = m?.product_url ?? p?.product_url ?? null;
                const linkHref = externalHref(link);
                const imageUrl = m?.image_url || p?.image_url || null;
                const clientName =
                  m?.client_product_name ||
                  [r?.name, m?.category || p?.category].filter(Boolean).join(" ") ||
                  p?.name ||
                  "—";
                const needsReselection = item.room_product?.approval_status === "declined";
                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "border-b border-border align-top",
                      needsReselection && "bg-red-50/35",
                    )}
                  >
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
                          {item.out_of_stock && (
                            <span className="mt-1 inline-flex border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900">
                              Out of stock
                            </span>
                          )}
                          <ProcurementNoteEditor
                            productName={clientName}
                            value={item.notes ?? ""}
                            disabled={!m?.id}
                            onSave={(notes) => m?.id ? saveProcurementNote(m.id, notes) : Promise.reject(new Error("Could not find this item."))}
                          />
                          {!p && (
                            <div className="mt-1 text-[11px] text-amber-800">
                              Product details pending
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <EditableTextCell
                        value={p?.vendor ?? ""}
                        disabled={!p?.id && !m?.id}
                        placeholder="Vendor"
                        onSave={(value) =>
                          updateProductText(p?.id, "vendor", value, m?.id)
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
                      <SpecQuantityEditor
                        item={m ?? { quantity: null }}
                        label={m?.client_product_name || p?.name || "Product"}
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
                        disabled={!p?.id && !m?.id}
                        placeholder="Dimensions"
                        onSave={(value) =>
                          updateProductText(p?.id, "dimensions", value, m?.id)
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <PricingEditor
                        productName={clientName}
                        retailPrice={p?.retail_price ?? ""}
                        price={p?.price ?? ""}
                        priceUnit={materialPriceUnit({ ...m, product: p })}
                        unitCost={p?.unit_cost ?? ""}
                        markupPercent={p?.markup_percent ?? null}
                        markupBasis={p?.markup_basis ?? null}
                        shipping={p?.shipping ?? ""}
                        disabled={!p?.id && !m?.id}
                        onSave={(values, initial) =>
                          updateProductPricing(item, values, initial)
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      <div className="truncate max-w-[140px]">{r?.project?.name}</div>
                      <div className="text-ink truncate max-w-[140px]">{r?.name}</div>
                    </td>
                    {(Object.keys(procurementStatuses) as ProcurementStatus[]).map((k) => (
                      <td key={k} className="px-3 py-3">
                        <div className="flex justify-center">
                          <button
                            type="button"
                            role="checkbox"
                            aria-label={`${procurementStatuses[k]} for ${clientName}`}
                            aria-checked={Boolean(item[k])}
                            aria-busy={pendingStatuses[m?.id ?? ""]?.[k] !== undefined}
                            disabled={(needsReselection && k !== "out_of_stock") || !m?.id || pendingStatuses[m?.id ?? ""]?.[k] !== undefined}
                            onClick={() => m?.id && toggle(m.id, k, !item[k])}
                            className={cn(
                              "w-6 h-6 border flex items-center justify-center transition-colors",
                              needsReselection && k !== "out_of_stock" && "cursor-not-allowed opacity-40",
                              item[k]
                                ? "bg-ink border-ink text-primary-foreground"
                                : "border-border hover:border-ink",
                            )}
                          >
                            {pendingStatuses[m?.id ?? ""]?.[k] !== undefined
                              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              : item[k] && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
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
        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-md">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={showDesignerDiscount} onCheckedChange={(checked) => setShowDesignerDiscount(checked === true)} />
              Show designer discount
            </label>
            {showDesignerDiscount && (
              <div className="mt-3 border border-border p-5 text-sm" aria-label="Designer discount breakdown">
                <div className="flex justify-between gap-4 py-1"><span>Full retail price</span><span>{formatMoney(money.retail)}</span></div>
                <div className="flex justify-between gap-4 py-1"><span>Designer discount</span><span>{formatMoney(money.discount === 0 ? 0 : -money.discount)}</span></div>
                <div className="flex justify-between gap-4 border-t border-border pt-2 mt-2"><span>Client subtotal</span><span>{formatMoney(money.subtotal)}</span></div>
                <div className="flex justify-between gap-4 py-1"><span>Tax</span><span>{formatMoney(money.tax)}</span></div>
                <div className="flex justify-between gap-4 py-1"><span>Shipping</span><span>{formatMoney(money.shipping)}</span></div>
                <div className="flex justify-between gap-4 border-t border-border pt-3 mt-2 font-semibold"><span>Client total</span><span>{formatMoney(money.total)}</span></div>
                {(money.missingRetailPrices > 0 || money.missingPrices > 0 || money.unknownQuantities > 0 || money.incompatibleUnits > 0) && (
                  <p className="mt-3 text-xs text-muted-foreground">TBD amounts count as $0. The discount only includes items with both retail and client prices and a known quantity. Missing information may keep the amounts from balancing.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function BulkMarkupEditor({
  products,
  onApply,
}: {
  products: Product[];
  onApply: (
    markupBasis: MarkupBasis,
    markupPercent: number,
  ) => Promise<{ updated: number; skipped: number }>;
}) {
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [markupBasis, setMarkupBasis] = useState<MarkupBasis>("retail_price");
  const [markupPercent, setMarkupPercent] = useState("");

  const availableCount = products.filter((product) => {
    if (markupBasis === "our_price") return !!product.unit_cost?.trim();
    return !!(
      product.retail_price?.trim() ||
      (product.markup_percent == null && product.price?.trim())
    );
  }).length;
  const percent = Number(markupPercent.trim());
  const canApply = products.length > 0 && markupPercent.trim() !== "" && Number.isFinite(percent);

  const apply = async () => {
    if (!canApply) return;
    setApplying(true);
    try {
      const result = await onApply(markupBasis, percent);
      if (result.updated === 0) {
        toast.warning(
          `No products have a ${markupBasis === "our_price" ? "Our Price" : "Retail Price"} to mark up.`,
        );
        return;
      }

      toast.success(
        `Markup applied to ${result.updated} product${result.updated === 1 ? "" : "s"}${
          result.skipped > 0 ? `; ${result.skipped} skipped because the base price is missing` : ""
        }.`,
      );
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the markup.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={products.length === 0}
          className="h-10 border border-ink bg-ink px-4 text-xs uppercase tracking-[0.12em] text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Set Markup for All
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="eyebrow mb-1">Set Markup for All Shown</div>
        <div className="font-display text-xl">{products.length} unique products</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          This applies one markup to every product in the current filtered view.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="eyebrow mb-1.5 block">Markup Based On</span>
            <select
              value={markupBasis}
              onChange={(event) => setMarkupBasis(event.target.value as MarkupBasis)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="retail_price">Retail Price</option>
              <option value="our_price">Our Price</option>
            </select>
          </label>
          <PercentInput label="Markup" value={markupPercent} onChange={setMarkupPercent} />
          <div className="border border-border bg-bone/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-ink">{availableCount}</span> product
            {availableCount === 1 ? "" : "s"} will be updated.
            {products.length - availableCount > 0 && (
              <>
                {" "}
                {products.length - availableCount} without a{" "}
                {markupBasis === "our_price" ? "Our Price" : "Retail Price"} will be skipped.
              </>
            )}
          </div>
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
            onClick={apply}
            disabled={!canApply || applying}
            className="h-9 bg-ink px-4 text-xs text-primary-foreground disabled:opacity-40"
          >
            {applying ? "Applying..." : "Apply to All Shown"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProcurementNoteEditor({
  productName,
  value,
  disabled,
  onSave,
}: {
  productName: string;
  value: string;
  disabled?: boolean;
  onSave: (notes: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(draft);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the note. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mt-2 max-w-[280px]">
      {value && <p className="whitespace-pre-wrap break-words text-xs leading-5 text-ink">{value}</p>}
      <Popover open={open} onOpenChange={(next) => {
        if (saving) return;
        if (next) setDraft(value);
        setOpen(next);
      }}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} aria-label={`${value ? "Edit" : "Add"} procurement note for ${productName}`} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-ink disabled:opacity-40">
            {value ? "Edit note" : "Add note"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-4" align="start">
          <div className="font-semibold text-sm">Procurement note</div>
          <div className="mt-1 text-xs text-muted-foreground">{productName}</div>
          <textarea
            aria-label={`Procurement note for ${productName}`}
            placeholder="e.g. Won’t ship until mid-March"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={saving}
            rows={4}
            className="mt-3 w-full resize-y border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => setOpen(false)} className="h-9 border border-border px-3 text-xs">Cancel</button>
            <button type="button" disabled={saving} onClick={save} className="h-9 bg-ink px-3 text-xs text-primary-foreground disabled:opacity-40">{saving ? "Saving…" : "Save note"}</button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PricingEditor({
  productName,
  retailPrice,
  price,
  priceUnit,
  unitCost,
  markupPercent,
  markupBasis,
  shipping,
  disabled,
  onSave,
}: {
  productName: string;
  retailPrice: string;
  price: string;
  priceUnit: ProductPriceUnit | null;
  unitCost: string;
  markupPercent: number | null;
  markupBasis: MarkupBasis | null;
  shipping: string;
  disabled?: boolean;
  onSave: (values: ProductPricingDraft, initial: ProductPricingDraft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProductPricingDraft>(() => ({
    price: moneyDraft(price),
    price_unit: priceUnit ?? "",
    retail_price: moneyDraft(retailPrice || (markupPercent == null ? price : "")),
    unit_cost: moneyDraft(unitCost),
    markup_percent: markupPercent?.toString() ?? "",
    markup_basis: markupBasis ?? ("retail_price" as MarkupBasis),
    shipping: moneyDraft(shipping),
  }));
  const [initialDraft, setInitialDraft] = useState(draft);

  useEffect(() => {
    if (!open) {
      const current: ProductPricingDraft = {
        price: moneyDraft(price),
        price_unit: priceUnit ?? "",
        retail_price: moneyDraft(retailPrice || (markupPercent == null ? price : "")),
        unit_cost: moneyDraft(unitCost),
        markup_percent: markupPercent?.toString() ?? "",
        markup_basis: markupBasis ?? ("retail_price" as MarkupBasis),
        shipping: moneyDraft(shipping),
      };
      setDraft(current);
      setInitialDraft(current);
    }
  }, [markupBasis, markupPercent, open, price, priceUnit, retailPrice, shipping, unitCost]);

  const calculatedClientPrice = clientPriceFromMarkup({
    retailPrice: draft.retail_price,
    ourPrice: draft.unit_cost,
    markupPercent: draft.markup_percent,
    markupBasis: draft.markup_basis,
  });

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft, initialDraft);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save pricing. Please try again.");
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
          title={disabled ? undefined : "Edit retail price, our price, markup, and shipping"}
        >
          <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <DollarSign className="h-3 w-3" /> Edit Pricing
          </span>
          <PricingSummary
            label="Retail"
            value={retailPrice || (markupPercent == null ? price : "")}
          />
          <PricingSummary label="Our Price" value={unitCost} />
          <PricingTextSummary
            label="Markup"
            value={
              markupPercent == null
                ? "—"
                : `${markupPercent}% on ${markupBasis === "our_price" ? "Our Price" : "Retail"}`
            }
          />
          <PricingSummary label="Price" value={price} />
          <PricingTextSummary label="Price is per" value={priceUnit === "unit" ? "Unit / item" : priceUnit === "sq_ft" ? "Square foot" : "Not set"} />
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
            label="Retail Price"
            value={draft.retail_price}
            onChange={(value) => setDraft((current) => ({ ...current, retail_price: value }))}
          />
          <MoneyInput
            label="Our Price"
            value={draft.unit_cost}
            onChange={(value) => setDraft((current) => ({ ...current, unit_cost: value }))}
          />
          <label className="block">
            <span className="eyebrow mb-1.5 block">Markup Based On</span>
            <select
              value={draft.markup_basis}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  markup_basis: event.target.value as MarkupBasis,
                }))
              }
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="retail_price">Retail Price</option>
              <option value="our_price">Our Price</option>
            </select>
          </label>
          <PercentInput
            label="Markup"
            value={draft.markup_percent}
            onChange={(value) => setDraft((current) => ({ ...current, markup_percent: value }))}
          />
          {calculatedClientPrice == null ? (
            <MoneyInput label="Price" value={draft.price} onChange={(value) => setDraft((current) => ({ ...current, price: value }))} />
          ) : <div className="border border-border bg-bone/40 px-3 py-2.5">
            <div className="eyebrow mb-1">Price</div>
            <div className="font-display text-xl">
              {calculatedClientPrice == null
                ? displayMoney(price)
                : formatMoney(calculatedClientPrice)}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {calculatedClientPrice == null
                ? "Enter the selected base price and a markup to calculate a new client price."
                : `Calculated from ${draft.markup_basis === "our_price" ? "Our Price" : "Retail Price"}.`}
            </p>
          </div>}
          <MoneyInput
            label="Shipping"
            value={draft.shipping}
            onChange={(value) => setDraft((current) => ({ ...current, shipping: value }))}
          />
          <label className="block">
            <span className="eyebrow mb-1.5 block">Price is per</span>
            <select aria-label="Price is per" value={draft.price_unit} onChange={(event) => setDraft((current) => ({ ...current, price_unit: event.target.value === "unit" || event.target.value === "sq_ft" ? event.target.value : "" }))} className="h-10 w-full border border-input bg-background px-3 text-sm">
              <option value="">Choose unit</option>
              <option value="unit">Unit / item</option>
              <option value="sq_ft">Square foot</option>
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">Changing the basis does not convert the price.</span>
          </label>
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

function PricingTextSummary({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center justify-between gap-3 text-xs leading-5">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[105px] truncate font-medium text-ink">{value}</span>
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

function PercentInput({
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
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          className="h-full min-w-0 flex-1 bg-transparent pl-3 text-right text-sm outline-none"
          placeholder="0"
        />
        <span className="px-3 text-sm text-muted-foreground">%</span>
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
    try { await onSave(next); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save this item. Please try again."); }
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

function SavedProductInvoiceTotals({ invoice }: { invoice: ProductInvoiceSummary }) {
  const { subtotal, shipping, tax, fees, adjustment } = invoice.amounts;
  return (
    <section aria-label="Saved invoice totals">
      <h2 className="eyebrow mb-2">Saved Invoice</h2>
      <p className="mb-4 text-sm">{invoice.name}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
        {subtotal !== undefined && <MoneyStat label="Subtotal" value={subtotal} />}
        {shipping !== undefined && <MoneyStat label="Shipping" value={shipping} />}
        {fees.length > 0 && <MoneyStat label="Invoice Fees" value={fees.reduce((sum, fee) => sum + fee.amount, 0)}>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {fees.map((fee) => (
              <li key={fee.key} className="flex flex-wrap justify-between gap-x-2">
                <span className="min-w-0 break-words">{fee.name}</span>
                {fees.length > 1 && <span>{formatMoney(fee.amount)}</span>}
              </li>
            ))}
          </ul>
        </MoneyStat>}
        {tax !== undefined && <MoneyStat label="Tax" value={tax} />}
        {adjustment !== 0 && <MoneyStat label="Adjustments" value={adjustment} />}
        <MoneyStat label="Invoice Total" value={invoice.total} />
      </div>
    </section>
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
        lines?: Array<({ sourceId?: string; selected?: boolean } & ProductInvoiceCostLine) | null>;
      };
      totals?: {
        subtotal?: unknown;
        shipping?: unknown;
        tax?: unknown;
        serviceFees?: Array<{ name?: unknown; amount?: unknown } | null>;
      };
    };
    if (parsed.type !== "product_invoice") return null;
    const selectedLines = (parsed.draft?.lines ?? []).filter((line) => line && line.selected !== false);
    const sourceIds = new Set(selectedLines.flatMap((line) => line?.sourceId ? [line.sourceId] : []));
    const ledger = financialInvoiceLedger(invoice);
    const originalTotal = invoice.total_amount ?? ledger.originalTotal;
    const adjustment = ledger.chargeTotal - ledger.creditTotal;
    const savedAmount = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const fees = Array.isArray(parsed.totals?.serviceFees)
      ? parsed.totals.serviceFees.flatMap((fee, index) => {
          const amount = savedAmount(fee?.amount);
          return typeof fee?.name === "string" && fee.name.trim() && amount !== undefined && amount > 0
            ? [{ key: String(index), name: fee.name, amount }]
            : [];
        })
      : [];
    return {
      id: invoice.id,
      projectId: invoice.project_id,
      name: invoice.file_name || parsed.draft?.invoiceName || "Product Invoice",
      documentUrl: invoice.pdf_data_url,
      paymentUrl: currentInvoicePaymentUrl(invoice),
      documentOptions: invoice.adjustments?.length ? {
        invoiceTitle: invoice.file_name,
        clientName: invoice.client_name,
        servicePayments: {
          payments: invoice.payments ?? [], adjustments: invoice.adjustments,
          totalAmount: ledger.originalTotal, paidAmount: ledger.grossPaid, balanceDue: ledger.balanceDue,
        },
      } : {},
      total: Math.max(originalTotal + adjustment, 0),
      amounts: {
        subtotal: savedAmount(parsed.totals?.subtotal),
        shipping: savedAmount(parsed.totals?.shipping),
        tax: savedAmount(parsed.totals?.tax),
        fees,
        adjustment,
      },
      sortDate: invoice.invoice_date || invoice.created_at || "",
      sourceIds,
      sourceLineCount: selectedLines.length,
      costLines: selectedLines.map((line) => ({ unitCost: line?.unitCost, quantity: line?.quantity })),
      sourceDraft: parsed.draft,
    };
  } catch {
    return null;
  }
}

function currentInvoicePaymentUrl(invoice: FinancialInvoice) {
  const duePayment = invoice.payments?.find(
    (payment) => payment.status === "due" && stripeLinkFromNotes(payment.notes),
  );
  return stripeLinkFromNotes(duePayment?.notes);
}

function stripeLinkFromNotes(notes?: string | null) {
  return notes?.match(/https:\/\/(?:buy|checkout)\.stripe\.com\/[^\s"')<]+/i)?.[0] ?? null;
}
