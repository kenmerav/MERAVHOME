import { FileText, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { formatMoney, moneyValue, normalizeMoneyInput } from "@/lib/money";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

type ProcurementInvoiceItem = {
  id: string;
  room_product?: {
    approval_status?: string | null;
    product?: {
      id: string;
      name: string;
      category: string;
      vendor: string | null;
      image_url: string | null;
      price: string | null;
      unit_cost: string | null;
      shipping: string | null;
      finish: string | null;
      dimensions: string | null;
      sku: string | null;
      product_url: string | null;
    } | null;
    room?: {
      id: string;
      name: string;
    } | null;
  } | null;
  material?: {
    client_product_name: string | null;
    quantity: number | null;
    color: string | null;
    product_url: string | null;
    cad_label: string | null;
    notes: string | null;
  } | null;
};

type ProductInvoiceLine = {
  sourceId: string;
  productId: string | null;
  selected: boolean;
  approvalStatus: string;
  name: string;
  vendor: string;
  room: string;
  category: string;
  imageUrl: string;
  productUrl: string;
  finish: string;
  dimensions: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
  shipping: string;
};

type ProductInvoiceDraft = {
  invoiceName: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  clientName: string;
  projectName: string;
  paid: string;
  taxRate: string;
  stripeLink: string;
  stripePaymentLinkId: string;
  notes: string;
  lines: ProductInvoiceLine[];
};

type ProductInvoiceApprovalFilter = "all" | "approved" | "not_approved" | "declined";

export function ProductInvoiceCreator({
  projectId,
  projectName,
  clientName,
  items,
  defaultTaxRate,
  onlyApproved = false,
  buttonLabel = "Create Product Invoice",
  disabled,
  onSaved,
}: {
  projectId: string | null;
  projectName: string;
  clientName: string;
  items: ProcurementInvoiceItem[];
  defaultTaxRate: string;
  onlyApproved?: boolean;
  buttonLabel?: string;
  disabled?: boolean;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [approvalFilter, setApprovalFilter] = useState<ProductInvoiceApprovalFilter>("all");
  const [roomFilter, setRoomFilter] = useState("__all");
  const [categoryFilter, setCategoryFilter] = useState("__all");
  const [draft, setDraft] = useState<ProductInvoiceDraft>(() =>
    makeDraft({ projectName, clientName, items, defaultTaxRate, onlyApproved }),
  );

  useEffect(() => {
    if (!open) return;
    setDraft(makeDraft({ projectName, clientName, items, defaultTaxRate, onlyApproved }));
    setApprovalFilter("all");
    setRoomFilter("__all");
    setCategoryFilter("__all");
  }, [clientName, defaultTaxRate, items, onlyApproved, open, projectName]);

  const totals = useMemo(() => productInvoiceTotals(draft), [draft]);
  const selectedCount = draft.lines.filter((line) => line.selected).length;
  const roomOptions = useMemo(
    () => uniqueSorted(draft.lines.map((line) => line.room).filter(Boolean)),
    [draft.lines],
  );
  const categoryOptions = useMemo(
    () => uniqueSorted(draft.lines.map((line) => line.category).filter(Boolean)),
    [draft.lines],
  );
  const visibleLines = useMemo(
    () =>
      draft.lines.filter((line) => {
        if (roomFilter !== "__all" && line.room !== roomFilter) return false;
        if (categoryFilter !== "__all" && line.category !== categoryFilter) return false;
        if (approvalFilter === "approved" && line.approvalStatus !== "approved") return false;
        if (approvalFilter === "declined" && line.approvalStatus !== "declined") return false;
        if (approvalFilter === "not_approved" && line.approvalStatus === "approved") return false;
        return true;
      }),
    [approvalFilter, categoryFilter, draft.lines, roomFilter],
  );
  const visibleSourceIds = useMemo(
    () => new Set(visibleLines.map((line) => line.sourceId)),
    [visibleLines],
  );
  const canCreate = !!projectId && selectedCount > 0 && totals.total > 0;
  const html = useMemo(() => buildProductInvoiceHtml(draft, totals), [draft, totals]);

  const updateDraft = (patch: Partial<ProductInvoiceDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const updateLine = (sourceId: string, patch: Partial<ProductInvoiceLine>) => {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.sourceId === sourceId ? { ...line, ...patch } : line,
      ),
    }));
  };

  const generateStripeLink = async () => {
    if (!canCreate) return toast.error("Select at least one product with a client price first.");
    setGeneratingLink(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in as Ken or Katie to create payment links.");
      const res = await fetch("/api/create-stripe-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: `${draft.invoiceName || "Product Invoice"} - ${draft.clientName || draft.projectName}`,
          amount: Math.max(totals.balance, 0),
          description: `${selectedCount} product${selectedCount === 1 ? "" : "s"} for ${draft.projectName}`,
          metadata: {
            invoice_type: "product_invoice",
            project_id: projectId,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.url) throw new Error(body?.error || "Could not create payment link.");
      updateDraft({ stripeLink: body.url, stripePaymentLinkId: body.id || "" });
      toast.success("Stripe payment link added");
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Could not create Stripe payment link."));
    } finally {
      setGeneratingLink(false);
    }
  };

  const saveInvoice = async () => {
    if (!projectId)
      return toast.error("Choose a single project before creating a product invoice.");
    if (!canCreate) return toast.error("Select products with a client price before saving.");
    setSaving(true);
    try {
      const finalHtml = buildProductInvoiceHtml(draft, totals);
      const fileName = `${draft.invoiceName || "Product Invoice"} - ${draft.projectName}`;
      await db.createFinancialInvoice(
        {
          project_id: projectId,
          file_name: fileName,
          pdf_data_url: htmlDataUrl(finalHtml),
          invoice_date: draft.invoiceDate || null,
          client_name: draft.clientName || null,
          provider_name: "MERAV INTERIORS",
          total_amount: totals.total,
          paid_amount: totals.paid,
          balance_due: totals.balance,
          client_visible: true,
          raw_text: JSON.stringify({
            type: "product_invoice",
            draft,
            totals,
          }),
        },
        [
          {
            project_id: projectId,
            label: "Product Invoice Balance",
            amount: totals.balance,
            due_date: draft.dueDate || null,
            status: totals.balance <= 0 ? "paid" : "due",
            notes: draft.stripeLink ? `Stripe payment link: ${draft.stripeLink}` : null,
            stripe_payment_link_id: draft.stripePaymentLinkId || null,
            stripe_checkout_session_id: null,
            stripe_payment_intent_id: null,
            paid_at: null,
            sort_order: 0,
          },
        ],
      );
      toast.success("Product invoice saved");
      onSaved?.();
      setOpen(false);
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Could not save product invoice."));
    } finally {
      setSaving(false);
    }
  };

  const triggerDownload = () =>
    printHtmlAsPdf(html, `${draft.invoiceName || "Product Invoice"} - ${draft.projectName}`);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-5 py-3 bg-ink text-primary-foreground text-sm disabled:opacity-40"
        >
          <Plus className="w-4 h-4" /> {buttonLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[96vw] max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">
            Create Product Invoice
          </DialogTitle>
        </DialogHeader>

        {!projectId && (
          <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Choose a single project on the Procurement page before creating a product invoice.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
          <div className="space-y-6">
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field
                label="Invoice Name"
                value={draft.invoiceName}
                onChange={(value) => updateDraft({ invoiceName: value })}
              />
              <Field
                label="Project"
                value={draft.projectName}
                onChange={(value) => updateDraft({ projectName: value })}
              />
              <Field
                label="Client"
                value={draft.clientName}
                onChange={(value) => updateDraft({ clientName: value })}
              />
              <Field
                label="Invoice Date"
                type="date"
                value={draft.invoiceDate}
                onChange={(value) => updateDraft({ invoiceDate: value })}
              />
              <Field
                label="Due Date"
                type="date"
                value={draft.dueDate}
                onChange={(value) => updateDraft({ dueDate: value })}
              />
              <Field
                label="Terms"
                value={draft.terms}
                onChange={(value) => updateDraft({ terms: value })}
              />
              <Field
                label="Tax Rate"
                value={draft.taxRate}
                onChange={(value) => updateDraft({ taxRate: value })}
                suffix="%"
              />
              <Field
                label="Paid"
                value={draft.paid}
                onChange={(value) => updateDraft({ paid: value })}
              />
              <div>
                <Label className="eyebrow mb-2 block">Stripe Link</Label>
                <div className="flex gap-2">
                  <Input
                    value={draft.stripeLink}
                    onChange={(event) => updateDraft({ stripeLink: event.target.value })}
                  />
                  <button
                    type="button"
                    onClick={generateStripeLink}
                    disabled={generatingLink || !canCreate}
                    className="shrink-0 px-4 py-2 border border-border text-sm hover:border-ink disabled:opacity-40"
                  >
                    {generatingLink ? "Creating..." : "Generate"}
                  </button>
                </div>
              </div>
            </section>

            <section className="border border-border">
              <div className="p-4 border-b border-border space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="eyebrow mb-1">Invoice Items</div>
                    <div className="text-sm text-muted-foreground">
                      {selectedCount} selected · {visibleLines.length} visible of{" "}
                      {draft.lines.length} from the current procurement view.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        lines: current.lines.map((line) =>
                          visibleSourceIds.has(line.sourceId) ? { ...line, selected: true } : line,
                        ),
                      }))
                    }
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    Select visible
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <FilterSelect
                    label="Approved"
                    value={approvalFilter}
                    onChange={(value) => setApprovalFilter(value as ProductInvoiceApprovalFilter)}
                    options={[
                      { value: "all", label: "All approval statuses" },
                      { value: "approved", label: "Approved only" },
                      { value: "not_approved", label: "Not approved" },
                      { value: "declined", label: "Changes requested" },
                    ]}
                  />
                  <FilterSelect
                    label="Room"
                    value={roomFilter}
                    onChange={setRoomFilter}
                    options={[
                      { value: "__all", label: "All rooms" },
                      ...roomOptions.map((room) => ({ value: room, label: room })),
                    ]}
                  />
                  <FilterSelect
                    label="Category"
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                    options={[
                      { value: "__all", label: "All categories" },
                      ...categoryOptions.map((category) => ({
                        value: category,
                        label: category,
                      })),
                    ]}
                  />
                </div>
              </div>
              <div className="mobile-card-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] tracking-[0.15em] uppercase text-muted-foreground border-b border-border bg-bone/30">
                      <th className="px-3 py-3 w-10"></th>
                      <th className="px-3 py-3 min-w-[240px]">Product</th>
                      <th className="px-3 py-3 min-w-[140px]">Room</th>
                      <th className="px-3 py-3 min-w-[90px] text-right">Qty</th>
                      <th className="px-3 py-3 min-w-[130px] text-right">Client Price</th>
                      <th className="px-3 py-3 min-w-[120px] text-right">Shipping</th>
                      <th className="px-3 py-3 min-w-[130px] text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLines.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-12 text-center text-sm text-muted-foreground"
                        >
                          No products in this procurement view yet.
                        </td>
                      </tr>
                    )}
                    {visibleLines.map((line) => {
                      const lineTotal = line.selected ? lineSubtotal(line) : 0;
                      return (
                        <tr key={line.sourceId} className="border-b border-border align-top">
                          <td className="px-3 py-4">
                            <Checkbox
                              checked={line.selected}
                              onCheckedChange={(checked) =>
                                updateLine(line.sourceId, { selected: checked === true })
                              }
                            />
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex gap-3">
                              <div className="h-14 w-14 shrink-0 bg-bone border border-border overflow-hidden">
                                {line.imageUrl && (
                                  <img
                                    src={line.imageUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                )}
                              </div>
                              <div className="min-w-[190px] space-y-2">
                                <Input
                                  value={line.name}
                                  onChange={(event) =>
                                    updateLine(line.sourceId, { name: event.target.value })
                                  }
                                />
                                <div className="text-[11px] text-muted-foreground">
                                  {[line.vendor, line.finish, line.sku]
                                    .filter(Boolean)
                                    .join(" - ") || "No vendor details"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <Input
                              value={line.room}
                              onChange={(event) =>
                                updateLine(line.sourceId, { room: event.target.value })
                              }
                            />
                          </td>
                          <td className="px-3 py-3">
                            <Input
                              value={line.quantity}
                              onChange={(event) =>
                                updateLine(line.sourceId, { quantity: event.target.value })
                              }
                              className="text-right"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <Input
                              value={line.unitPrice}
                              onChange={(event) =>
                                updateLine(line.sourceId, {
                                  unitPrice: normalizeMoneyInput(event.target.value) ?? "",
                                })
                              }
                              className="text-right"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <Input
                              value={line.shipping}
                              onChange={(event) =>
                                updateLine(line.sourceId, {
                                  shipping: normalizeMoneyInput(event.target.value) ?? "",
                                })
                              }
                              className="text-right"
                            />
                          </td>
                          <td className="px-3 py-4 text-right font-medium">
                            {formatMoney(lineTotal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div>
              <Label className="eyebrow mb-2 block">Notes</Label>
              <Textarea
                value={draft.notes}
                onChange={(event) => updateDraft({ notes: event.target.value })}
                placeholder="Optional invoice notes..."
              />
            </div>
          </div>

          <aside className="space-y-4">
            <SummaryStat label="Subtotal" value={totals.subtotal} />
            <SummaryStat label="Shipping" value={totals.shipping} />
            <SummaryStat label={`Tax (${draft.taxRate || "0"}%)`} value={totals.tax} />
            <SummaryStat label="Total" value={totals.total} strong />
            <SummaryStat label="Balance" value={totals.balance} strong />
            <button
              type="button"
              onClick={triggerDownload}
              disabled={!canCreate}
              className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 border border-border text-sm hover:border-ink disabled:opacity-40"
            >
              <FileText className="w-4 h-4" /> Download / Print PDF
            </button>
            <button
              type="button"
              onClick={saveInvoice}
              disabled={saving || !canCreate}
              className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 bg-ink text-primary-foreground text-sm disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save Invoice"}
            </button>
          </aside>
        </div>

        <section>
          <div className="eyebrow mb-3">Live Preview</div>
          <iframe
            title="Product invoice preview"
            srcDoc={html}
            className="h-[720px] w-full border border-border bg-white"
          />
        </section>
      </DialogContent>
    </Dialog>
  );
}

function makeDraft({
  projectName,
  clientName,
  items,
  defaultTaxRate,
  onlyApproved,
}: {
  projectName: string;
  clientName: string;
  items: ProcurementInvoiceItem[];
  defaultTaxRate: string;
  onlyApproved: boolean;
}): ProductInvoiceDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    invoiceName: "Product Invoice",
    invoiceDate: today,
    dueDate: "",
    terms: "Due upon receipt",
    clientName,
    projectName,
    paid: "",
    taxRate: defaultTaxRate || "0",
    stripeLink: "",
    stripePaymentLinkId: "",
    notes: "",
    lines: (onlyApproved
      ? items.filter((item) => item.room_product?.approval_status === "approved")
      : items
    ).map((item) => {
      const product = item.room_product?.product;
      const material = item.material;
      return {
        sourceId: item.id,
        productId: product?.id ?? null,
        selected: true,
        name: material?.client_product_name || product?.name || "Product",
        vendor: product?.vendor || "",
        room: item.room_product?.room?.name || "",
        category: product?.category || "",
        approvalStatus: item.room_product?.approval_status || "undecided",
        imageUrl: product?.image_url || "",
        productUrl: material?.product_url || product?.product_url || "",
        finish: material?.color || product?.finish || "",
        dimensions: product?.dimensions || "",
        sku: product?.sku || "",
        quantity: String(material?.quantity && material.quantity > 0 ? material.quantity : 1),
        unitPrice: normalizeMoneyInput(product?.price) || "",
        unitCost: normalizeMoneyInput(product?.unit_cost) || "",
        shipping: normalizeMoneyInput(product?.shipping) || "",
      };
    }),
  };
}

function productInvoiceTotals(draft: ProductInvoiceDraft) {
  const selected = draft.lines.filter((line) => line.selected);
  const subtotal = selected.reduce(
    (sum, line) => sum + moneyValue(line.unitPrice) * quantityValue(line.quantity),
    0,
  );
  const shipping = selected.reduce(
    (sum, line) => sum + moneyValue(line.shipping) * quantityValue(line.quantity),
    0,
  );
  const tax = subtotal * ((Number(draft.taxRate) || 0) / 100);
  const paid = moneyValue(draft.paid);
  const total = subtotal + shipping + tax;
  return { subtotal, shipping, tax, paid, total, balance: Math.max(total - paid, 0) };
}

function lineSubtotal(line: ProductInvoiceLine) {
  return (moneyValue(line.unitPrice) + moneyValue(line.shipping)) * quantityValue(line.quantity);
}

function lineProductSubtotal(line: ProductInvoiceLine) {
  return moneyValue(line.unitPrice) * quantityValue(line.quantity);
}

function quantityValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <Label className="eyebrow mb-2 block">{label}</Label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full border border-input bg-background px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  suffix?: string;
}) {
  return (
    <div>
      <Label className="eyebrow mb-2 block">{label}</Label>
      <div className="relative">
        <Input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={suffix ? "pr-8" : undefined}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function SummaryStat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="border border-border p-4">
      <div className="eyebrow mb-2">{label}</div>
      <div className={`font-display ${strong ? "text-3xl" : "text-2xl"}`}>{formatMoney(value)}</div>
    </div>
  );
}

function buildProductInvoiceHtml(
  draft: ProductInvoiceDraft,
  totals: ReturnType<typeof productInvoiceTotals>,
) {
  const selected = draft.lines.filter((line) => line.selected);
  const rows = selected
    .map(
      (line) => `
    <tr>
      <td>
        <div class="product-line">
          ${
            line.imageUrl
              ? `<img class="product-image" src="${escapeHtml(line.imageUrl)}" alt="${escapeHtml(line.name)}" />`
              : `<div class="product-image placeholder"></div>`
          }
          <div>
            <strong>${escapeHtml(line.name)}</strong>
            <div class="muted">${escapeHtml([line.room, line.vendor, line.finish].filter(Boolean).join(" - "))}</div>
          </div>
        </div>
      </td>
      <td class="center">${escapeHtml(line.quantity || "1")}</td>
      <td class="right">${formatMoney(moneyValue(line.unitPrice))}</td>
      <td class="right">${formatMoney(lineProductSubtotal(line))}</td>
    </tr>
  `,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(draft.invoiceName || "Product Invoice")}</title>
  <style>
    @page { size: letter; margin: 0.35in; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #111; background: #fff; }
    .page { width: 8.5in; min-height: 10.5in; padding: 0.15in 0.25in; box-sizing: border-box; }
    .brand { text-align: center; margin: 0.05in 0 0.45in; }
    .logo { font-size: 58px; line-height: 0.95; letter-spacing: -0.08em; font-weight: 400; }
    .byline { margin-top: 14px; font-family: Arial, sans-serif; letter-spacing: 0.42em; color: #999; font-size: 14px; }
    .top { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5in; font-size: 14px; margin-bottom: 0.35in; }
    .title { text-align: right; font-size: 25px; font-weight: 700; margin-bottom: 0.25in; }
    .meta { display: grid; grid-template-columns: 0.85in 1fr; gap: 0.12in; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #000; padding: 0.1in 0.08in; vertical-align: middle; }
    th { background: #e9e7de; text-align: left; }
    .product-line { display: flex; align-items: center; gap: 0.12in; }
    .product-image { width: 0.82in; height: 0.82in; object-fit: contain; background: #f7f5ef; flex: 0 0 auto; }
    .product-image.placeholder { display: none; }
    .center { text-align: center; }
    .right { text-align: right; }
    .muted { margin-top: 5px; color: #666; font-size: 11px; font-family: Arial, sans-serif; }
    .summary { width: 3.1in; margin-left: auto; margin-top: 0.3in; font-size: 14px; }
    .summary-row { display: grid; grid-template-columns: 1fr 1.2in; gap: 0.08in; text-align: right; margin: 0.065in 0; }
    .total { border: 1px solid #000; background: #e9e7de; padding: 0.08in; font-size: 18px; font-weight: 700; text-align: center; display: block; }
    .pay { display: grid; grid-template-columns: 1fr 1.2in; border: 2px solid #000; margin: 0.22in 0; }
    .pay div { background: #e9e7de; padding: 0.05in 0.08in; font-weight: 700; text-align: center; }
    .pay div + div { border-left: 1px solid #000; text-align: right; }
    .notes { margin-top: 0.25in; font-size: 12px; line-height: 1.45; }
    a { color: #00f; text-decoration: underline; }
  </style>
</head>
<body>
  <main class="page">
    <section class="brand">
      <div class="logo">MERAV INTERIORS</div>
      <div class="byline">BY KATIE ROBERTS</div>
    </section>
    <section class="top">
      <div>
        <div><strong>Client:</strong><span style="margin-left:0.45in">${escapeHtml(draft.clientName || "Client Name")}</span></div>
        <div style="margin-top:0.45in; display:grid; grid-template-columns:0.8in 1fr;">
          <strong>Provider:</strong>
          <span>MERAV INTERIORS<br><a href="mailto:katie@meravinteriors.com">katie@meravinteriors.com</a></span>
        </div>
      </div>
      <div>
        <div class="title">PRODUCT INVOICE</div>
        <div class="meta">
          <strong>Project:</strong><span>${escapeHtml(draft.projectName || "Project")}</span>
          <strong>Date:</strong><span>${escapeHtml(formatDateForInvoice(draft.invoiceDate))}</span>
          <strong>Due:</strong><span>${escapeHtml(formatDateForInvoice(draft.dueDate) || draft.terms || "Due upon receipt")}</span>
        </div>
      </div>
    </section>
    <table>
      <thead>
        <tr><th>Product</th><th style="width:10%">Qty</th><th style="width:16%">Unit Price</th><th style="width:16%">Total</th></tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4" class="center">No products selected</td></tr>`}</tbody>
    </table>
    <section class="summary">
      <div class="summary-row"><span>Subtotal:</span><span>${formatMoney(totals.subtotal)}</span></div>
      <div class="summary-row"><span>Shipping:</span><span>${formatMoney(totals.shipping)}</span></div>
      <div class="summary-row"><span>Tax:</span><span>${formatMoney(totals.tax)}</span></div>
      <div class="summary-row"><strong>Total:</strong><strong class="total">${formatMoney(totals.total)}</strong></div>
      <div class="summary-row"><span>Paid:</span><span>${totals.paid ? formatMoney(totals.paid) : ""}</span></div>
      <div class="summary-row"><strong>Balance:</strong><strong>${formatMoney(totals.balance)}</strong></div>
      <div class="pay">
        <div>${draft.stripeLink ? `<a href="${escapeHtml(draft.stripeLink)}">CLICK HERE TO PAY</a>` : "CLICK HERE TO PAY"}</div>
        <div>${formatMoney(totals.balance)}</div>
      </div>
    </section>
    ${draft.notes ? `<section class="notes"><strong>Notes:</strong><br>${escapeHtml(draft.notes).replaceAll("\n", "<br>")}</section>` : ""}
  </main>
</body>
</html>`;
}

function htmlDataUrl(html: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDateForInvoice(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${Number(month)}/${Number(day)}/${year}`;
}

function printHtmlAsPdf(html: string, fileName?: string | null) {
  const target = window.open("", "_blank");
  if (!target) {
    toast.error("Allow popups to download the invoice PDF.");
    return;
  }
  target.opener = null;
  target.document.open();
  target.document.write(html);
  target.document.close();
  target.document.title = `${fileName || "Product Invoice"}.pdf`;
  target.setTimeout(() => {
    target.focus();
    target.print();
  }, 350);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
