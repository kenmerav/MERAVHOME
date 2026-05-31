import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Trash2, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { db, type FinancialInvoice, type FinancialInvoicePayment } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { canViewFinancials } from "@/lib/permissions";
import { formatMoney, procurementTotals } from "@/lib/money";

export const Route = createFileRoute("/projects/$id/financials")({
  head: () => ({ meta: [{ title: "Financials — MERAV Studio" }] }),
  component: FinancialsPage,
});

type ReviewInvoice = {
  file_name: string;
  file_data_url: string;
  invoice: {
    client_name: string | null;
    provider_name: string | null;
    invoice_date: string | null;
    total_amount: number | null;
    paid_amount: number | null;
    balance_due: number | null;
    raw_text: string;
    payments: ReviewPayment[];
  };
};

type ReviewPayment = Pick<FinancialInvoicePayment, "label" | "amount" | "due_date" | "status" | "notes" | "sort_order">;

function FinancialsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewInvoice | null>(null);
  const [taxRate] = useState(() => {
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
  const allowed = canViewFinancials(profile);
  const { data: project } = useQuery({ queryKey: ["project", id], queryFn: () => db.getProject(id) });
  const { data: invoices = [] } = useQuery({
    queryKey: ["financialInvoices", id],
    queryFn: async () => (await db.listFinancialInvoices(id)) ?? [],
    enabled: allowed,
  });
  const { data: procurementItems = [] } = useQuery({
    queryKey: ["procurement"],
    queryFn: async () => (await db.listProcurement()) ?? [],
    enabled: allowed,
  });

  const totals = useMemo(() => {
    const payments = invoices.flatMap((invoice) => invoice.payments ?? []);
    const due = payments.filter((payment) => payment.status !== "paid").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const paid = payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return { due, paid, total: due + paid, count: payments.length };
  }, [invoices]);
  const projectProcurement = useMemo(
    () => procurementTotals(procurementItems.filter((item) => item.room_product?.room?.project?.id === id), taxRate),
    [id, procurementItems, taxRate],
  );
  const totalProjectProfit = totals.total + projectProcurement.profit;

  const onFile = async (file?: File | null) => {
    if (!file) return;
    if (file.type !== "application/pdf") return toast.error("Please upload a PDF invoice.");
    if (file.size > 10 * 1024 * 1024) return toast.error("PDF too large (max 10MB).");
    setParsing(true);
    try {
      const fileDataUrl = await readFile(file);
      const res = await fetch("/api/parse-invoice-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.name, file_data_url: fileDataUrl }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not parse invoice.");
      const invoice = body.invoice;
      setReview({
        file_name: body.file_name || file.name,
        file_data_url: fileDataUrl,
        invoice: {
          ...invoice,
          payments: invoice.payments?.length ? invoice.payments : [{ label: "Payment Due", amount: invoice.balance_due ?? 0, due_date: null, status: "due", notes: null, sort_order: 0 }],
        },
      });
    } catch (e: any) {
      toast.error(e?.message || "Could not parse invoice.");
    } finally {
      setParsing(false);
    }
  };

  const updatePayment = (index: number, patch: Partial<ReviewPayment>) => {
    if (!review) return;
    const payments = review.invoice.payments.map((payment, i) => i === index ? { ...payment, ...patch } : payment);
    setReview({ ...review, invoice: { ...review.invoice, payments } });
  };

  const addPayment = () => {
    if (!review) return;
    setReview({
      ...review,
      invoice: {
        ...review.invoice,
        payments: [
          ...review.invoice.payments,
          { label: "Payment Due", amount: 0, due_date: null, status: "due", notes: null, sort_order: review.invoice.payments.length },
        ],
      },
    });
  };

  const removePayment = (index: number) => {
    if (!review) return;
    setReview({ ...review, invoice: { ...review.invoice, payments: review.invoice.payments.filter((_, i) => i !== index) } });
  };

  const saveReview = async () => {
    if (!review) return;
    setSaving(true);
    try {
      await db.createFinancialInvoice({
        project_id: id,
        file_name: review.file_name,
        pdf_data_url: review.file_data_url,
        invoice_date: review.invoice.invoice_date,
        client_name: review.invoice.client_name,
        provider_name: review.invoice.provider_name,
        total_amount: review.invoice.total_amount,
        paid_amount: review.invoice.paid_amount,
        balance_due: review.invoice.balance_due,
        raw_text: review.invoice.raw_text,
      }, review.invoice.payments.map((payment, index) => ({
        project_id: id,
        label: payment.label || "Payment Due",
        amount: Number(payment.amount || 0),
        due_date: payment.due_date || null,
        status: payment.status || "due",
        notes: payment.notes || null,
        sort_order: index,
      })));
      toast.success("Invoice saved");
      setReview(null);
      qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
    } catch (e: any) {
      toast.error(e?.message || "Could not save invoice.");
    } finally {
      setSaving(false);
    }
  };

  const updatePaymentStatus = async (payment: FinancialInvoicePayment, status: FinancialInvoicePayment["status"]) => {
    await db.updateFinancialPayment(payment.id, { status });
    qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
  };

  const deleteInvoice = async (invoice: FinancialInvoice) => {
    const label = invoice.file_name || "this invoice";
    if (!window.confirm(`Delete ${label} and all of its payment lines? This cannot be undone.`)) return;
    setDeletingInvoiceId(invoice.id);
    try {
      await db.deleteFinancialInvoice(invoice.id);
      toast.success("Invoice deleted");
      qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
      qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not delete invoice.");
    } finally {
      setDeletingInvoiceId(null);
    }
  };

  if (loadingProfile || !project) return <AppShell><div className="p-16 text-muted-foreground">Loading...</div></AppShell>;

  if (!allowed) {
    return (
      <AppShell>
        <div className="page-pad max-w-[900px]">
          <div className="eyebrow mb-3">Restricted</div>
          <h1 className="editorial-hero text-5xl lg:text-6xl">Financials</h1>
          <p className="mt-4 text-muted-foreground max-w-xl">
            Financials are currently available only to Ken and Katie.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <Link to="/projects/$id" params={{ id }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink mb-8">
          <ArrowLeft className="w-3.5 h-3.5" /> Project
        </Link>

        <div className="flex items-start lg:items-end justify-between gap-6 flex-wrap mb-10">
          <div>
            <div className="eyebrow mb-3">{project.name} - {project.client_name}</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">Financials</h1>
            <p className="mt-4 text-muted-foreground max-w-2xl">
              Upload invoice PDFs, review the extracted payment schedule, and track every payment due for the project.
            </p>
          </div>
          <label className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-5 py-3 bg-ink text-primary-foreground text-sm cursor-pointer">
            <Upload className="w-4 h-4" /> {parsing ? "Reading PDF..." : "Upload Invoice PDF"}
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} disabled={parsing} />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 mb-10">
          <Stat label="Invoice Revenue" value={formatMoney(totals.total)} />
          <Stat label="Paid" value={formatMoney(totals.paid)} />
          <Stat label="Due" value={formatMoney(totals.due)} />
          <Stat label="Procurement Profit" value={formatMoney(projectProcurement.profit)} />
          <Stat label="Total Project Profit" value={formatMoney(totalProjectProfit)} />
          <Stat label="Payment Lines" value={String(totals.count)} />
        </div>

        {review && (
          <section className="border border-border p-6 mb-10 bg-bone/20">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <div className="eyebrow mb-2">Review Upload</div>
                <h2 className="font-display text-3xl">{review.file_name}</h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Check these payment lines before saving them to the project.
                </p>
              </div>
              <button onClick={() => setReview(null)} className="text-muted-foreground hover:text-ink"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
              <ReviewField label="Invoice Date" value={review.invoice.invoice_date ?? ""} onChange={(value) => setReview({ ...review, invoice: { ...review.invoice, invoice_date: value || null } })} />
              <ReviewField label="Client" value={review.invoice.client_name ?? ""} onChange={(value) => setReview({ ...review, invoice: { ...review.invoice, client_name: value || null } })} />
              <ReviewField label="Total Fee" value={String(review.invoice.total_amount ?? "")} onChange={(value) => setReview({ ...review, invoice: { ...review.invoice, total_amount: numberValue(value) } })} />
              <ReviewField label="Balance Due" value={String(review.invoice.balance_due ?? "")} onChange={(value) => setReview({ ...review, invoice: { ...review.invoice, balance_due: numberValue(value) } })} />
            </div>

            <PaymentTable payments={review.invoice.payments} editable onChange={updatePayment} onRemove={removePayment} />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-6">
              <button onClick={addPayment} className="text-sm px-4 py-2 border border-border hover:border-ink">Add Payment Line</button>
              <button onClick={saveReview} disabled={saving} className="px-6 py-3 bg-ink text-primary-foreground text-sm disabled:opacity-50">
                {saving ? "Saving..." : "Save Invoice"}
              </button>
            </div>
          </section>
        )}

        <div className="space-y-8">
          {invoices.length === 0 ? (
            <div className="border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
              No invoices yet. Upload the first invoice PDF to start tracking payment lines.
            </div>
          ) : invoices.map((invoice) => (
            <InvoiceCard key={invoice.id} invoice={invoice} onStatus={updatePaymentStatus} onDelete={deleteInvoice} deleting={deletingInvoiceId === invoice.id} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function InvoiceCard({
  invoice,
  onStatus,
  onDelete,
  deleting,
}: {
  invoice: FinancialInvoice;
  onStatus: (payment: FinancialInvoicePayment, status: FinancialInvoicePayment["status"]) => void;
  onDelete: (invoice: FinancialInvoice) => void;
  deleting?: boolean;
}) {
  const payments = [...(invoice.payments ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <section className="border border-border">
      <div className="p-6 border-b border-border flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">{invoice.invoice_date || "Invoice"}</div>
          <h2 className="font-display text-3xl">{invoice.file_name || "Invoice PDF"}</h2>
          <p className="text-sm text-muted-foreground mt-2">
            {[invoice.client_name, invoice.provider_name, invoice.balance_due != null && `Balance ${formatMoney(invoice.balance_due)}`].filter(Boolean).join(" - ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {invoice.pdf_data_url && (
            <button type="button" onClick={() => openInvoicePdf(invoice.pdf_data_url, invoice.file_name)} className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border hover:border-ink">
              <FileText className="w-4 h-4" /> PDF
            </button>
          )}
          <button type="button" onClick={() => onDelete(invoice)} disabled={deleting} className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
      <PaymentTable payments={payments} onStatus={onStatus} />
    </section>
  );
}

function PaymentTable({
  payments,
  editable,
  onChange,
  onRemove,
  onStatus,
}: {
  payments: ReviewPayment[] | FinancialInvoicePayment[];
  editable?: boolean;
  onChange?: (index: number, patch: Partial<ReviewPayment>) => void;
  onRemove?: (index: number) => void;
  onStatus?: (payment: FinancialInvoicePayment, status: FinancialInvoicePayment["status"]) => void;
}) {
  return (
    <div className="mobile-card-scroll">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] tracking-[0.15em] uppercase text-muted-foreground border-b border-border">
            <th className="py-3 px-4">Payment Due</th>
            <th className="py-3 px-4 text-right">Amount</th>
            <th className="py-3 px-4">Due Date</th>
            <th className="py-3 px-4">Status</th>
            {editable && <th className="py-3 px-4"></th>}
          </tr>
        </thead>
        <tbody>
          {payments.map((payment, index) => (
            <tr key={(payment as any).id ?? index} className="border-b border-border">
              <td className="py-3 px-4 min-w-[260px]">
                {editable ? <Input value={payment.label} onChange={(e) => onChange?.(index, { label: e.target.value })} /> : payment.label}
              </td>
              <td className="py-3 px-4 text-right min-w-[150px]">
                {editable ? <Input value={String(payment.amount ?? "")} onChange={(e) => onChange?.(index, { amount: numberValue(e.target.value) ?? 0 })} className="text-right" /> : formatMoney(Number(payment.amount || 0))}
              </td>
              <td className="py-3 px-4 min-w-[160px]">
                {editable ? <Input type="date" value={payment.due_date ?? ""} onChange={(e) => onChange?.(index, { due_date: e.target.value || null })} /> : payment.due_date || "TBD"}
              </td>
              <td className="py-3 px-4 min-w-[150px]">
                <select
                  value={payment.status}
                  onChange={(e) => editable ? onChange?.(index, { status: e.target.value as any }) : onStatus?.(payment as FinancialInvoicePayment, e.target.value as any)}
                  className="h-9 w-full border border-input bg-background px-2 text-xs capitalize"
                >
                  <option value="due">Due</option>
                  <option value="paid">Paid</option>
                  <option value="waived">Waived</option>
                </select>
              </td>
              {editable && (
                <td className="py-3 px-4 text-right">
                  <button onClick={() => onRemove?.(index)} className="text-xs text-muted-foreground hover:text-ink">Remove</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <Label className="eyebrow">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border p-5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="font-display text-3xl">{value}</div>
    </div>
  );
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function numberValue(value: string) {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function openInvoicePdf(pdfDataUrl: string | null, fileName?: string | null) {
  if (!pdfDataUrl) return;
  const target = window.open("", "_blank");
  if (target) target.opener = null;
  try {
    if (!pdfDataUrl.startsWith("data:")) {
      if (target) target.location.href = pdfDataUrl;
      else window.open(pdfDataUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const blob = await (await fetch(pdfDataUrl)).blob();
    const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
    const url = URL.createObjectURL(pdfBlob);
    if (target) {
      target.document.title = fileName || "Invoice PDF";
      target.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    if (target) target.close();
    toast.error("Could not open invoice PDF.");
  }
}
