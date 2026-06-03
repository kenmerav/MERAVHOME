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
type ServiceType = "Full Service" | "Virtual";
type InvoicePhaseName = "Project Start" | "Design Presentation" | "Design Document Delivery" | "Project Completion";

type ServiceInvoiceDraft = {
  serviceType: ServiceType;
  projectName: string;
  clientName: string;
  clientEmail: string;
  projectAddress: string;
  squareFeet: string;
  renovationRate: string;
  renovationVirtualRate: string;
  furnitureRate: string;
  furnitureVirtualRate: string;
  paid: string;
  projectType: InvoiceProjectType;
  roomSelectionsRenovation: string[];
  roomSelectionsFurniture: string[];
  otherRoomRenovation: string;
  otherRoomFurniture: string;
  servicesRenovation: string[];
  servicesRenovationVirtual: string[];
  servicesFurniture: string[];
  servicesFurnitureVirtual: string[];
  otherServiceRenovation: string;
  otherServiceFurniture: string;
  location: string;
  description: string;
  invoiceDate: string;
  designFee: string;
  currentPhase: InvoicePhaseName;
  stripeLink: string;
  stripePaymentLinkId: string;
  notes: string;
  phases: Array<{ name: InvoicePhaseName; percent: string; dueDate: string }>;
};

type InvoiceProjectType = "Renovation" | "New Build" | "Furniture";
type InvoiceDesignSection = {
  kind: "renovation" | "furniture";
  title: string;
  amount: number;
  location: string;
  description: string;
};
type ServiceDraftListField =
  | "roomSelectionsRenovation"
  | "roomSelectionsFurniture"
  | "servicesRenovation"
  | "servicesFurniture";

const SERVICE_PHASES: InvoicePhaseName[] = ["Project Start", "Design Presentation", "Design Document Delivery", "Project Completion"];
const DEFAULT_PHASE_SPLITS = ["50", "25", "20", "5"];
const INVOICE_PROJECT_TYPES: InvoiceProjectType[] = ["Renovation", "New Build", "Furniture"];
const RENOVATION_ROOMS = ["Full Home", "Living Room", "Kitchen", "Dining", "Primary Bedroom", "Master Bath", "Powder Room", "Other"];
const FURNITURE_ROOMS = ["Full Home", "Living Room", "Kitchen", "Dining", "Primary Bedroom", "Primary Bath", "Powder Room", "Other"];
const SERVICE_OPTIONS = [
  "Conceptual design planning",
  "Drafting elevations",
  "Digital renderings",
  "Space planning",
  "Sourcing furniture + fixtures",
  "Presentations",
  "Ordering",
  "Managing installation",
  "Other",
];

function FinancialsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [savingPaymentId, setSavingPaymentId] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewInvoice | null>(null);
  const [serviceDraft, setServiceDraft] = useState<ServiceInvoiceDraft | null>(null);
  const [savingServiceInvoice, setSavingServiceInvoice] = useState(false);
  const [creatingStripeLink, setCreatingStripeLink] = useState(false);
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
    if (!allowed) return toast.error("Only Ken and Katie can upload invoices.");
    if (file.type !== "application/pdf") return toast.error("Please upload a PDF invoice.");
    if (file.size > 10 * 1024 * 1024) return toast.error("PDF too large (max 10MB).");
    setParsing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in as Ken or Katie to use invoice tools.");
      const fileDataUrl = await readFile(file);
      const res = await fetch("/api/parse-invoice-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
    if (!allowed) return toast.error("Only Ken and Katie can save invoices.");
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

  const startServiceInvoice = () => {
    if (!allowed) return toast.error("Only Ken and Katie can create invoices.");
    const today = new Date().toISOString().slice(0, 10);
    setServiceDraft({
      serviceType: "Full Service",
      projectName: project?.name ?? "",
      clientName: project?.client_name ?? "",
      clientEmail: "",
      projectAddress: "",
      squareFeet: "",
      renovationRate: "",
      renovationVirtualRate: "",
      furnitureRate: "",
      furnitureVirtualRate: "",
      paid: "",
      projectType: "Renovation",
      roomSelectionsRenovation: ["Full Home"],
      roomSelectionsFurniture: ["Full Home"],
      otherRoomRenovation: "",
      otherRoomFurniture: "",
      servicesRenovation: ["Conceptual design planning", "Drafting elevations", "Digital renderings", "Space planning", "Sourcing furniture + fixtures", "Presentations"],
      servicesRenovationVirtual: ["Conceptual design planning", "Drafting elevations", "Digital renderings", "Space planning", "Sourcing furniture + fixtures", "Presentations"],
      servicesFurniture: ["Conceptual design planning", "Space planning", "Sourcing furniture + fixtures", "Presentations", "Ordering", "Managing installation"],
      servicesFurnitureVirtual: ["Conceptual design planning", "Space planning", "Sourcing furniture + fixtures", "Presentations"],
      otherServiceRenovation: "",
      otherServiceFurniture: "",
      location: project?.project_type === "Whole Home" ? "Full Home" : project?.project_type ?? "Full Home",
      description: "Conceptual design planning, Drafting elevations, Digital renderings, Space planning, Sourcing all fixtures + finishes, Full Specifications Document, Full Drawing Packet",
      invoiceDate: today,
      designFee: "",
      currentPhase: "Project Start",
      stripeLink: "",
      stripePaymentLinkId: "",
      notes: "",
      phases: SERVICE_PHASES.map((name, index) => ({ name, percent: DEFAULT_PHASE_SPLITS[index], dueDate: "" })),
    });
  };

  const updateServiceDraft = (patch: Partial<ServiceInvoiceDraft>) => {
    if (!serviceDraft) return;
    setServiceDraft({ ...serviceDraft, ...patch });
  };

  const updateServicePhase = (index: number, patch: Partial<ServiceInvoiceDraft["phases"][number]>) => {
    if (!serviceDraft) return;
    setServiceDraft({
      ...serviceDraft,
      phases: serviceDraft.phases.map((phase, i) => i === index ? { ...phase, ...patch } : phase),
    });
  };

  const toggleServiceDraftList = (field: ServiceDraftListField, value: string) => {
    if (!serviceDraft) return;
    const list = serviceDraft[field];
    setServiceDraft({
      ...serviceDraft,
      [field]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
    });
  };

  const saveServiceInvoice = async () => {
    if (!serviceDraft) return;
    if (!allowed) return toast.error("Only Ken and Katie can save invoices.");
    const fee = calculatedDesignFee(serviceDraft);
    const paid = numberValue(serviceDraft.paid) ?? 0;
    if (fee <= 0) return toast.error("Enter square feet and the matching price per sq/ft first.");
    setSavingServiceInvoice(true);
    try {
      const payments = serviceDraft.phases.map((phase, index) => ({
        project_id: id,
        label: `Phase ${index + 1} - ${phase.name}`,
        amount: phaseAmount(fee, phase.percent),
        due_date: phase.dueDate || null,
        status: "due" as const,
        notes: serviceDraft.currentPhase === phase.name && serviceDraft.stripeLink ? `Stripe payment link: ${serviceDraft.stripeLink}` : null,
        stripe_payment_link_id: serviceDraft.currentPhase === phase.name ? serviceDraft.stripePaymentLinkId || null : null,
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
        paid_at: null,
        sort_order: index,
      }));
      const invoiceHtml = buildServiceInvoiceHtml(serviceDraft, fee, payments);
      await db.createFinancialInvoice({
        project_id: id,
        file_name: `${serviceDraft.projectName || "Project"} Design Service Invoice.html`,
        pdf_data_url: htmlDataUrl(invoiceHtml),
        invoice_date: serviceDraft.invoiceDate || null,
        client_name: serviceDraft.clientName || null,
        provider_name: "MERAV Interiors",
        total_amount: fee,
        paid_amount: paid,
        balance_due: Math.max(fee - paid, 0),
        raw_text: JSON.stringify({ type: "design_service_invoice", ...serviceDraft }),
      }, payments);
      toast.success("Design service invoice saved");
      setServiceDraft(null);
      qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
      qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not save service invoice.");
    } finally {
      setSavingServiceInvoice(false);
    }
  };

  const createStripeLink = async () => {
    if (!serviceDraft) return;
    if (!allowed) return toast.error("Only Ken and Katie can create payment links.");
    const fee = calculatedDesignFee(serviceDraft);
    const amount = serviceDraft.phases.find((phase) => phase.name === serviceDraft.currentPhase);
    const paymentAmount = amount ? phaseAmount(fee, amount.percent) : 0;
    if (paymentAmount <= 0) return toast.error("Enter square feet, rate, and phase percent before creating the Stripe link.");
    setCreatingStripeLink(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in as Ken or Katie to use invoice tools.");
      const res = await fetch("/api/create-stripe-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: `${serviceDraft.projectName || "Design Service"} ${serviceDraft.currentPhase}`,
          amount: paymentAmount,
          description: `${serviceDraft.clientName || "Client"} - ${serviceDraft.projectType}`,
          metadata: {
            invoice_type: "design_service_invoice",
            project_id: id,
            payment_phase: serviceDraft.currentPhase,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.url) throw new Error(body?.error || "Could not create payment link.");
      setServiceDraft({ ...serviceDraft, stripeLink: body.url, stripePaymentLinkId: body.id || "" });
      toast.success("Stripe payment link added");
    } catch (e: any) {
      toast.error(e?.message || "Could not create Stripe payment link.");
    } finally {
      setCreatingStripeLink(false);
    }
  };

  const updatePaymentStatus = async (payment: FinancialInvoicePayment, status: FinancialInvoicePayment["status"]) => {
    if (!allowed) return toast.error("Only Ken and Katie can edit invoices.");
    await db.updateFinancialPayment(payment.id, { status });
    qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
  };

  const updateSavedPayment = async (payment: FinancialInvoicePayment, patch: Partial<FinancialInvoicePayment>) => {
    if (!allowed) return toast.error("Only Ken and Katie can edit invoices.");
    setSavingPaymentId(payment.id);
    try {
      await db.updateFinancialPayment(payment.id, patch);
      qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
      qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not update payment.");
    } finally {
      setSavingPaymentId(null);
    }
  };

  const deleteInvoice = async (invoice: FinancialInvoice) => {
    if (!allowed) return toast.error("Only Ken and Katie can delete invoices.");
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
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
            <label className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-5 py-3 bg-ink text-primary-foreground text-sm cursor-pointer">
              <Upload className="w-4 h-4" /> {parsing ? "Reading PDF..." : "Upload Invoice PDF"}
              <input type="file" accept="application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} disabled={parsing} />
            </label>
          </div>
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

        {serviceDraft && (
          <section className="border border-border p-6 mb-10 bg-bone/20">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <div className="eyebrow mb-2">Design Service Quote</div>
                <h2 className="font-display text-3xl">Create Invoice</h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Mirrors the Google Sheet flow: choose the service type, set payment splits, then save the payment schedule to this project.
                </p>
              </div>
              <button onClick={() => setServiceDraft(null)} className="text-muted-foreground hover:text-ink"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_460px] gap-8">
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="eyebrow">Service Delivery</Label>
                    <div className="grid grid-cols-2 border border-input h-10">
                      {(["Full Service", "Virtual"] as ServiceType[]).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => updateServiceDraft({ serviceType: type })}
                          className={`text-sm transition-colors ${serviceDraft.serviceType === type ? "bg-ink text-primary-foreground" : "bg-background hover:bg-bone"}`}
                        >
                          {type === "Full Service" ? "In Person" : "Virtual"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ReviewField label="Project Name" value={serviceDraft.projectName} onChange={(value) => updateServiceDraft({ projectName: value })} />
                  <ReviewField label="Client Name" value={serviceDraft.clientName} onChange={(value) => updateServiceDraft({ clientName: value })} />
                  <ReviewField label="Client Email" value={serviceDraft.clientEmail} onChange={(value) => updateServiceDraft({ clientEmail: value })} />
                  <ReviewField label="Project Address" value={serviceDraft.projectAddress} onChange={(value) => updateServiceDraft({ projectAddress: value })} />
                  <ReviewField label="Invoice Date" value={serviceDraft.invoiceDate} onChange={(value) => updateServiceDraft({ invoiceDate: value })} />
                  <div>
                    <Label className="eyebrow">Project Type</Label>
                    <select
                      value={serviceDraft.projectType}
                      onChange={(e) => updateServiceDraft({ projectType: e.target.value as InvoiceProjectType })}
                      className="h-10 w-full border border-input bg-background px-3 text-sm"
                    >
                      {INVOICE_PROJECT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </div>
                  <ReviewField label="Square Feet" value={serviceDraft.squareFeet} onChange={(value) => updateServiceDraft({ squareFeet: value })} />
                  <ServiceRateField
                    label="Price per sq/ft Renovation"
                    serviceType={serviceDraft.serviceType}
                    inPersonValue={serviceDraft.renovationRate}
                    virtualValue={serviceDraft.renovationVirtualRate}
                    onChange={(value) => updateServiceDraft(serviceDraft.serviceType === "Virtual" ? { renovationVirtualRate: value } : { renovationRate: value })}
                  />
                  <ServiceRateField
                    label="Price per sq/ft Furniture"
                    serviceType={serviceDraft.serviceType}
                    inPersonValue={serviceDraft.furnitureRate}
                    virtualValue={serviceDraft.furnitureVirtualRate}
                    onChange={(value) => updateServiceDraft(serviceDraft.serviceType === "Virtual" ? { furnitureVirtualRate: value } : { furnitureRate: value })}
                  />
                  <ReviewField label="Paid" value={serviceDraft.paid} onChange={(value) => updateServiceDraft({ paid: value })} />
                  <div>
                    <Label className="eyebrow">Payment Link Phase</Label>
                    <select
                      value={serviceDraft.currentPhase}
                      onChange={(e) => updateServiceDraft({ currentPhase: e.target.value as InvoicePhaseName })}
                      className="h-10 w-full border border-input bg-background px-3 text-sm"
                    >
                      {SERVICE_PHASES.map((phase) => <option key={phase} value={phase}>{phase}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="eyebrow">Stripe Link</Label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Input
                        value={serviceDraft.stripeLink}
                        onChange={(e) => updateServiceDraft({ stripeLink: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={createStripeLink}
                        disabled={creatingStripeLink}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-border text-sm whitespace-nowrap hover:border-ink disabled:opacity-50"
                      >
                        {creatingStripeLink ? "Creating..." : "Generate Payment Link"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <CheckboxGroup
                    title="Room Selections Renovation"
                    options={RENOVATION_ROOMS}
                    values={serviceDraft.roomSelectionsRenovation}
                    onToggle={(value) => toggleServiceDraftList("roomSelectionsRenovation", value)}
                    otherValue={serviceDraft.otherRoomRenovation}
                    onOtherChange={(value) => updateServiceDraft({ otherRoomRenovation: value })}
                  />
                  <CheckboxGroup
                    title="Room Selections Furniture"
                    options={FURNITURE_ROOMS}
                    values={serviceDraft.roomSelectionsFurniture}
                    onToggle={(value) => toggleServiceDraftList("roomSelectionsFurniture", value)}
                    otherValue={serviceDraft.otherRoomFurniture}
                    onOtherChange={(value) => updateServiceDraft({ otherRoomFurniture: value })}
                  />
                  <CheckboxGroup
                    title="Services Provided: Renovation"
                    options={SERVICE_OPTIONS}
                    values={serviceDraft.servicesRenovation}
                    onToggle={(value) => toggleServiceDraftList("servicesRenovation", value)}
                    otherValue={serviceDraft.otherServiceRenovation}
                    onOtherChange={(value) => updateServiceDraft({ otherServiceRenovation: value })}
                  />
                  <CheckboxGroup
                    title="Services Provided: Furniture"
                    options={SERVICE_OPTIONS}
                    values={serviceDraft.servicesFurniture}
                    onToggle={(value) => toggleServiceDraftList("servicesFurniture", value)}
                    otherValue={serviceDraft.otherServiceFurniture}
                    onOtherChange={(value) => updateServiceDraft({ otherServiceFurniture: value })}
                  />
                </div>

                <div className="mobile-card-scroll border border-border bg-background">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] tracking-[0.15em] uppercase text-muted-foreground border-b border-border">
                        <th className="py-3 px-4">Phase</th>
                        <th className="py-3 px-4 text-right">Percent</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                        <th className="py-3 px-4">Due Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceDraft.phases.map((phase, index) => {
                        const fee = calculatedDesignFee(serviceDraft);
                        return (
                          <tr key={phase.name} className="border-b border-border">
                            <td className="py-3 px-4 min-w-[240px]">Phase {index + 1} - {phase.name}</td>
                            <td className="py-3 px-4 min-w-[130px]">
                              <Input value={phase.percent} onChange={(e) => updateServicePhase(index, { percent: e.target.value })} className="text-right" />
                            </td>
                            <td className="py-3 px-4 text-right min-w-[130px]">{formatMoney(phaseAmount(fee, phase.percent))}</td>
                            <td className="py-3 px-4 min-w-[160px]">
                              <Input type="date" value={phase.dueDate} onChange={(e) => updateServicePhase(index, { dueDate: e.target.value })} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Stat label="Automated Design Fee" value={formatMoney(calculatedDesignFee(serviceDraft))} />
                  <Stat label="Paid" value={formatMoney(numberValue(serviceDraft.paid) ?? 0)} />
                  <Stat label="Balance Due" value={formatMoney(Math.max(calculatedDesignFee(serviceDraft) - (numberValue(serviceDraft.paid) ?? 0), 0))} />
                </div>

                <div>
                  <Label className="eyebrow">Notes</Label>
                  <textarea
                    value={serviceDraft.notes}
                    onChange={(e) => updateServiceDraft({ notes: e.target.value })}
                    className="min-h-24 w-full border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Optional invoice notes or client-facing details..."
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <button type="button" onClick={() => printServiceInvoiceDraft(serviceDraft)} className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-border text-sm hover:border-ink">
                    <FileText className="w-4 h-4" /> Download PDF
                  </button>
                  <button onClick={saveServiceInvoice} disabled={savingServiceInvoice} className="px-6 py-3 bg-ink text-primary-foreground text-sm disabled:opacity-50">
                    {savingServiceInvoice ? "Saving..." : "Save Invoice"}
                  </button>
                </div>
              </div>

              <ServiceInvoicePreview draft={serviceDraft} />
            </div>
          </section>
        )}

        <div className="space-y-8">
          {invoices.length === 0 ? (
            <div className="border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
              No invoices yet. Upload the first invoice PDF to start tracking payment lines.
            </div>
          ) : invoices.map((invoice) => (
            <InvoiceCard
              key={invoice.id}
              invoice={invoice}
              onStatus={updatePaymentStatus}
              onPaymentUpdate={updateSavedPayment}
              savingPaymentId={savingPaymentId}
              onDelete={deleteInvoice}
              deleting={deletingInvoiceId === invoice.id}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function InvoiceCard({
  invoice,
  onStatus,
  onPaymentUpdate,
  savingPaymentId,
  onDelete,
  deleting,
}: {
  invoice: FinancialInvoice;
  onStatus: (payment: FinancialInvoicePayment, status: FinancialInvoicePayment["status"]) => void;
  onPaymentUpdate: (payment: FinancialInvoicePayment, patch: Partial<FinancialInvoicePayment>) => void;
  savingPaymentId?: string | null;
  onDelete: (invoice: FinancialInvoice) => void;
  deleting?: boolean;
}) {
  const payments = [...(invoice.payments ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const printableDataUrl = printableInvoiceDataUrl(invoice);
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
          {printableDataUrl && (
            <button type="button" onClick={() => openInvoicePdf(printableDataUrl, invoice.file_name)} className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border hover:border-ink">
              <FileText className="w-4 h-4" /> PDF
            </button>
          )}
          {printableDataUrl && (
            <button type="button" onClick={() => downloadInvoicePdf(printableDataUrl, invoice.file_name)} className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border hover:border-ink">
              <FileText className="w-4 h-4" /> Download PDF
            </button>
          )}
          <button type="button" onClick={() => onDelete(invoice)} disabled={deleting} className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
      <PaymentTable payments={payments} onStatus={onStatus} onSavedPaymentChange={onPaymentUpdate} savingPaymentId={savingPaymentId} />
    </section>
  );
}

function PaymentTable({
  payments,
  editable,
  onChange,
  onRemove,
  onStatus,
  onSavedPaymentChange,
  savingPaymentId,
}: {
  payments: ReviewPayment[] | FinancialInvoicePayment[];
  editable?: boolean;
  onChange?: (index: number, patch: Partial<ReviewPayment>) => void;
  onRemove?: (index: number) => void;
  onStatus?: (payment: FinancialInvoicePayment, status: FinancialInvoicePayment["status"]) => void;
  onSavedPaymentChange?: (payment: FinancialInvoicePayment, patch: Partial<FinancialInvoicePayment>) => void;
  savingPaymentId?: string | null;
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
                {editable ? (
                  <Input value={String(payment.amount ?? "")} onChange={(e) => onChange?.(index, { amount: numberValue(e.target.value) ?? 0 })} className="text-right" />
                ) : (
                  <EditableMoneyCell payment={payment as FinancialInvoicePayment} saving={savingPaymentId === (payment as FinancialInvoicePayment).id} onSave={onSavedPaymentChange} />
                )}
              </td>
              <td className="py-3 px-4 min-w-[160px]">
                {editable ? (
                  <Input type="date" value={payment.due_date ?? ""} onChange={(e) => onChange?.(index, { due_date: e.target.value || null })} />
                ) : (
                  <EditableDateCell payment={payment as FinancialInvoicePayment} saving={savingPaymentId === (payment as FinancialInvoicePayment).id} onSave={onSavedPaymentChange} />
                )}
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

function EditableMoneyCell({
  payment,
  saving,
  onSave,
}: {
  payment: FinancialInvoicePayment;
  saving?: boolean;
  onSave?: (payment: FinancialInvoicePayment, patch: Partial<FinancialInvoicePayment>) => void;
}) {
  const [value, setValue] = useState(formatMoney(Number(payment.amount || 0)));

  const save = () => {
    const amount = numberValue(value) ?? 0;
    setValue(formatMoney(amount));
    if (amount !== Number(payment.amount || 0)) onSave?.(payment, { amount });
  };

  return (
    <Input
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onFocus={() => setValue(String(payment.amount ?? ""))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(formatMoney(Number(payment.amount || 0)));
          e.currentTarget.blur();
        }
      }}
      className="text-right"
      aria-label={`Amount for ${payment.label}`}
    />
  );
}

function EditableDateCell({
  payment,
  saving,
  onSave,
}: {
  payment: FinancialInvoicePayment;
  saving?: boolean;
  onSave?: (payment: FinancialInvoicePayment, patch: Partial<FinancialInvoicePayment>) => void;
}) {
  const [value, setValue] = useState(payment.due_date ?? "");

  const save = () => {
    const due_date = value || null;
    if (due_date !== payment.due_date) onSave?.(payment, { due_date });
  };

  return (
    <Input
      type="date"
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(payment.due_date ?? "");
          e.currentTarget.blur();
        }
      }}
      aria-label={`Due date for ${payment.label}`}
    />
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

function ServiceRateField({
  label,
  serviceType,
  inPersonValue,
  virtualValue,
  onChange,
}: {
  label: string;
  serviceType: ServiceType;
  inPersonValue: string;
  virtualValue: string;
  onChange: (value: string) => void;
}) {
  const isVirtual = serviceType === "Virtual";
  return (
    <div>
      <Label className="eyebrow">{label}</Label>
      <Input value={isVirtual ? virtualValue : inPersonValue} onChange={(e) => onChange(e.target.value)} />
      <div className="mt-1 text-[11px] text-muted-foreground">{isVirtual ? "Virtual rate" : "In-person rate"}</div>
    </div>
  );
}

function CheckboxGroup({
  title,
  options,
  values,
  onToggle,
  otherValue,
  onOtherChange,
}: {
  title: string;
  options: string[];
  values: string[];
  onToggle: (value: string) => void;
  otherValue?: string;
  onOtherChange?: (value: string) => void;
}) {
  return (
    <div className="border border-border bg-background p-4">
      <div className="eyebrow mb-3">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((option) => (
          <label key={option} className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={values.includes(option)} onChange={() => onToggle(option)} />
            {option}
          </label>
        ))}
      </div>
      {values.includes("Other") && onOtherChange ? (
        <div className="mt-3">
          <Label className="eyebrow">Other</Label>
          <Input value={otherValue ?? ""} onChange={(e) => onOtherChange(e.target.value)} placeholder="Type custom item" />
        </div>
      ) : null}
    </div>
  );
}

function ServiceInvoicePreview({
  draft,
}: {
  draft: ServiceInvoiceDraft;
}) {
  const fee = calculatedDesignFee(draft);
  const sections = invoiceDesignSections(draft);
  const paid = numberValue(draft.paid) ?? 0;
  const phaseRows = draft.phases.map((phase, index) => ({
    ...phase,
    label: `Phase ${index + 1} - ${phase.name}`,
    amount: phaseAmount(fee, phase.percent),
  }));
  const selectedAmount = phaseRows.find((phase) => phase.name === draft.currentPhase)?.amount ?? 0;
  const percentTotal = draft.phases.reduce((sum, phase) => sum + (numberValue(phase.percent) ?? 0), 0);

  return (
    <div className="xl:sticky xl:top-6 self-start">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] xl:grid-cols-1 gap-5">
        <div className="bg-white border border-border p-5 text-black shadow-sm overflow-hidden">
          <div className="text-center mb-8">
            <div className="font-display text-[44px] sm:text-[58px] leading-none tracking-[-0.06em]">MERAV INTERIORS</div>
            <div className="mt-3 text-[13px] tracking-[0.45em] text-neutral-500">BY KATIE ROBERTS</div>
          </div>

          <div className="grid grid-cols-2 gap-8 text-[12px] mb-8">
            <div className="space-y-10">
              <div><strong>Client:</strong><span className="ml-8">{draft.clientName || "Client Name"}</span></div>
              <div>
                <strong>Provider:</strong>
                <div className="ml-24 -mt-4">
                  MERAV INTERIORS<br />
                  <span className="text-blue-700">katie@meravinteriors.com</span>
                </div>
              </div>
            </div>
            <div className="space-y-8">
              <h3 className="font-serif text-2xl font-bold text-right">SERVICE INVOICE</h3>
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <strong>Date:</strong><span>{formatDateForInvoice(draft.invoiceDate)}</span>
                <strong>Address:</strong>
                <span>
                  {addressLines(draft.projectAddress).map((line) => (
                    <span key={line}>{line}<br /></span>
                  ))}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-10 mb-16">
            {sections.map((section) => (
              <table key={section.kind} className="w-full border border-black text-[12px]">
                <thead>
                  <tr className="bg-[#e9e7de]">
                    <th colSpan={3} className="border-b border-black py-2 text-center font-bold">{section.title}</th>
                  </tr>
                  <tr className="bg-[#e9e7de] text-left">
                    <th className="border-r border-black border-b border-black py-2 px-1 w-[30%]">Location</th>
                    <th className="border-r border-black border-b border-black py-2 px-1">Description</th>
                    <th className="border-b border-black py-2 px-1 w-[18%]">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border-r border-black py-8 px-3 text-center font-bold">{section.location}</td>
                    <td className="border-r border-black py-8 px-4 text-center">{section.description}</td>
                    <td className="py-8 px-2 text-right">{formatMoney(section.amount)}</td>
                  </tr>
                  <tr>
                    <td className="border-r border-black"></td>
                    <td className="border-r border-black"></td>
                    <td className="bg-[#e9e7de] border-t border-black py-2 px-2 text-right font-bold">{formatMoney(section.amount)}</td>
                  </tr>
                </tbody>
              </table>
            ))}
          </div>

          <div className="ml-auto max-w-[390px] text-[12px]">
            <div className="flex items-center justify-end gap-2 mb-4">
              <span className="font-bold text-xl">Total Design Fee:</span>
              <span className="border border-black bg-[#e9e7de] px-4 py-3 font-bold text-lg">{formatMoney(fee)}</span>
            </div>
            <div className="grid grid-cols-[1fr_130px] gap-x-3 gap-y-2 text-right mb-5">
              <strong>Paid:</strong><span>{paid ? formatMoney(paid) : ""}</span>
              <strong className="underline">Design Fee Due:</strong><strong className="underline">{formatMoney(Math.max(fee - paid, 0))}</strong>
              {phaseRows.filter((phase) => phase.amount > 0).map((phase) => (
                <span key={phase.name}>Due {phase.name === "Project Start" ? "on" : "at"} {phase.name}:</span>
              )).flatMap((label, index) => [label, <span key={`amount-${index}`}>{formatMoney(phaseRows.filter((phase) => phase.amount > 0)[index]?.amount ?? 0)}</span>])}
            </div>
            <div className="grid grid-cols-[1fr_140px] border-2 border-black mb-10">
              <div className="bg-[#e9e7de] text-center text-blue-700 underline font-bold py-1">
                {draft.stripeLink ? "CLICK HERE TO PAY" : "CLICK HERE TO PAY"}
              </div>
              <div className="bg-[#e9e7de] border-l border-black py-1 px-2 text-right font-bold">{formatMoney(selectedAmount)}</div>
            </div>
            <div className="space-y-10 italic">
              <div className="border-t border-black pt-2 flex justify-between"><span>Authorized by Client</span><span>Date</span></div>
              <div className="border-t border-black pt-2 flex justify-between"><span>Authorized by MERAV INTERIORS</span><span>Date</span></div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-yellow-300 text-black p-4 text-xs mt-10">
            <div className="font-bold mb-4">MATH CHECK:<span className="float-right">{formatMoney(fee)}</span></div>
            <div className="font-bold mb-3">Percentage Check</div>
            {draft.phases.map((phase) => (
              <div key={phase.name} className="flex justify-between"><span>{phase.name}</span><span>{(numberValue(phase.percent) ?? 0).toFixed(2)}%</span></div>
            ))}
            <div className="flex justify-between border-t border-black/30 mt-4 pt-3 font-bold"><span>Total</span><span>{percentTotal.toFixed(2)}%</span></div>
          </div>
        </div>
      </div>
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

function phaseAmount(fee: number, percent: string) {
  return Math.round((fee * ((numberValue(percent) ?? 0) / 100)) * 100) / 100;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function activeRate(draft: ServiceInvoiceDraft, kind: InvoiceDesignSection["kind"]) {
  if (kind === "furniture") {
    return numberValue(draft.serviceType === "Virtual" ? draft.furnitureVirtualRate : draft.furnitureRate) ?? 0;
  }
  return numberValue(draft.serviceType === "Virtual" ? draft.renovationVirtualRate : draft.renovationRate) ?? 0;
}

function calculatedDesignFee(draft: ServiceInvoiceDraft) {
  return roundMoney(invoiceDesignSections(draft).reduce((sum, section) => sum + section.amount, 0));
}

function invoiceDesignSections(draft: ServiceInvoiceDraft): InvoiceDesignSection[] {
  const squareFeet = numberValue(draft.squareFeet) ?? 0;
  const sections: InvoiceDesignSection[] = [];
  const renovationAmount = roundMoney(squareFeet * activeRate(draft, "renovation"));
  const furnitureAmount = roundMoney(squareFeet * activeRate(draft, "furniture"));

  if (renovationAmount > 0) {
    sections.push({
      kind: "renovation",
      title: "Renovation Design",
      amount: renovationAmount,
      location: invoiceLocation(draft, "renovation"),
      description: invoiceDescription(draft, "renovation"),
    });
  }

  if (furnitureAmount > 0) {
    sections.push({
      kind: "furniture",
      title: "Furniture Design",
      amount: furnitureAmount,
      location: invoiceLocation(draft, "furniture"),
      description: invoiceDescription(draft, "furniture"),
    });
  }

  if (sections.length) return sections;

  const fallbackKind: InvoiceDesignSection["kind"] = draft.projectType === "Furniture" ? "furniture" : "renovation";
  return [{
    kind: fallbackKind,
    title: fallbackKind === "furniture" ? "Furniture Design" : "Renovation Design",
    amount: 0,
    location: invoiceLocation(draft, fallbackKind),
    description: invoiceDescription(draft, fallbackKind),
  }];
}

function activeRoomSelections(draft: ServiceInvoiceDraft, kind: InvoiceDesignSection["kind"]) {
  return kind === "furniture"
    ? draft.roomSelectionsFurniture
    : draft.roomSelectionsRenovation;
}

function activeServices(draft: ServiceInvoiceDraft, kind: InvoiceDesignSection["kind"]) {
  if (kind === "furniture") {
    return draft.servicesFurniture;
  }
  return draft.servicesRenovation;
}

function invoiceLocation(draft: ServiceInvoiceDraft, kind: InvoiceDesignSection["kind"]) {
  const rooms = activeRoomSelections(draft, kind);
  const otherValue = kind === "furniture" ? draft.otherRoomFurniture : draft.otherRoomRenovation;
  const resolvedRooms = resolveOtherSelection(rooms, otherValue);
  return resolvedRooms.length ? resolvedRooms.join(", ") : draft.location || "Full Home";
}

function invoiceDescription(draft: ServiceInvoiceDraft, kind: InvoiceDesignSection["kind"]) {
  const services = activeServices(draft, kind);
  const otherValue = kind === "furniture" ? draft.otherServiceFurniture : draft.otherServiceRenovation;
  const resolvedServices = resolveOtherSelection(services, otherValue);
  if (resolvedServices.length) return resolvedServices.join(", ");
  return draft.description || "Design services";
}

function resolveOtherSelection(values: string[], otherValue?: string) {
  return values.map((value) => {
    if (value !== "Other") return value;
    return otherValue?.trim() || value;
  });
}

function addressLines(address: string) {
  const lines = address.split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines : ["6901 East", "Sweetwater Avenue", "Scottsdale, Arizona", "85254"];
}

function formatDateForInvoice(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

function htmlDataUrl(html: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function printableInvoiceDataUrl(invoice: FinancialInvoice) {
  const generatedHtml = serviceInvoiceHtmlFromInvoice(invoice);
  return generatedHtml ? htmlDataUrl(generatedHtml) : invoice.pdf_data_url;
}

function serviceInvoiceHtmlFromInvoice(invoice: FinancialInvoice) {
  try {
    const raw = JSON.parse(invoice.raw_text || "{}") as Partial<ServiceInvoiceDraft> & { type?: string };
    if (raw.type !== "design_service_invoice") return null;
    const draft = raw as ServiceInvoiceDraft;
    const fee = invoice.total_amount ?? calculatedDesignFee(draft);
    const payments = (invoice.payments?.length ? invoice.payments : draft.phases.map((phase, index) => ({
      label: `Phase ${index + 1} - ${phase.name}`,
      amount: phaseAmount(fee, phase.percent),
      due_date: phase.dueDate || null,
      status: "due",
      notes: draft.currentPhase === phase.name && draft.stripeLink ? `Stripe payment link: ${draft.stripeLink}` : null,
      sort_order: index,
    }))).map((payment) => ({
      label: payment.label,
      amount: payment.amount ?? 0,
      due_date: payment.due_date,
      status: payment.status,
      notes: payment.notes,
      sort_order: payment.sort_order,
    }));
    return buildServiceInvoiceHtml(draft, fee, payments);
  } catch {
    return null;
  }
}

function buildServiceInvoiceHtml(
  draft: ServiceInvoiceDraft,
  fee: number,
  payments: Array<{ label: string; amount: number; due_date: string | null; status: string; notes: string | null; sort_order: number }>,
) {
  const selectedAmount = payments.find((payment) => payment.label.includes(draft.currentPhase))?.amount ?? 0;
  const paid = numberValue(draft.paid) ?? 0;
  const address = addressLines(draft.projectAddress).map(escapeHtml).join("<br>");
  const sectionTables = invoiceDesignSections(draft).map((section) => `
    <table class="line-table">
      <thead>
        <tr><th colspan="3" class="center">${escapeHtml(section.title)}</th></tr>
        <tr><th style="width:30%">Location</th><th style="width:56%">Description</th><th style="width:14%">Subtotal</th></tr>
      </thead>
      <tbody>
        <tr class="item-row">
          <td class="center"><strong>${escapeHtml(section.location)}</strong></td>
          <td class="center">${escapeHtml(section.description)}</td>
          <td class="right">${formatMoney(section.amount)}</td>
        </tr>
        <tr class="subtotal-row"><td class="subtotal-spacer" colspan="2"></td><td class="right" style="background:#e9e7de"><strong>${formatMoney(section.amount)}</strong></td></tr>
      </tbody>
    </table>
  `).join("");
  const phaseLines = payments
    .filter((payment) => payment.amount > 0)
    .map((payment) => {
      const clean = payment.label.replace(/^Phase \d+ - /, "");
      return `<div class="summary-row"><span>Due ${clean === "Project Start" ? "on" : "at"} ${escapeHtml(clean)}:</span><span>${formatMoney(payment.amount)}</span></div>`;
    }).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(draft.projectName || "Design Service Invoice")}</title>
  <style>
    @page { size: letter; margin: 0.35in; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #000; background: #fff; }
    .page { width: 8.5in; min-height: 10.5in; padding: 0.15in 0.25in; box-sizing: border-box; }
    .brand { text-align: center; margin: 0.05in 0 0.5in; }
    .logo { font-size: 60px; line-height: 0.95; letter-spacing: -0.08em; font-weight: 400; }
    .byline { margin-top: 16px; font-family: Arial, sans-serif; letter-spacing: 0.45em; color: #999; font-size: 15px; }
    .top { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 0.5in; font-size: 14px; margin-bottom: 0.35in; }
    .provider { margin-top: 0.65in; }
    .provider-row { display: grid; grid-template-columns: 0.75in 1fr; }
    .title { text-align: right; font-size: 26px; font-weight: 700; margin-bottom: 0.35in; }
    .meta { display: grid; grid-template-columns: 0.85in 1fr; gap: 0.14in; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { border: 1px solid #000; padding: 0.12in 0.08in; vertical-align: middle; }
    th { background: #e9e7de; text-align: left; }
    .center { text-align: center; }
    .right { text-align: right; }
    .line-table { table-layout: fixed; }
    .line-table .item-row td { height: 0.7in; }
    .line-table .subtotal-row td { height: 0.28in; padding: 0.08in; }
    .line-table .subtotal-spacer { border: 0; height: 0; padding: 0; background: transparent; }
    .line-table + .line-table { margin-top: 0.48in; }
    .summary { width: 3.35in; margin-left: auto; margin-top: 0.32in; font-size: 14px; }
    .fee-row { display: grid; grid-template-columns: 1fr 1.35in; align-items: stretch; margin-bottom: 0.16in; }
    .fee-label { align-self: center; padding-right: 0.06in; text-align: right; font-size: 15px; }
    .fee-box { border: 1px solid #000; background: #e9e7de; padding: 0.11in 0.08in; text-align: right; font-size: 20px; font-weight: 700; }
    .summary-row { display: grid; grid-template-columns: 1fr 1.35in; text-align: right; gap: 0.06in; margin: 0.055in 0; }
    .pay { display: grid; grid-template-columns: 1fr 1.35in; border: 2px solid #000; margin: 0.22in 0 0.55in; }
    .pay div { background: #e9e7de; padding: 0.04in 0.08in; font-weight: 700; text-align: center; }
    .pay div + div { border-left: 1px solid #000; text-align: right; }
    .pay a { color: #00f; text-decoration: underline; }
    .sig { margin-top: 0.38in; border-top: 1px solid #000; padding-top: 0.07in; display: flex; justify-content: space-between; font-style: italic; }
    a { color: #00f; }
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
        <div><strong>Client:</strong><span style="margin-left:0.55in">${escapeHtml(draft.clientName || "Client Name")}</span></div>
        <div class="provider provider-row">
          <strong>Provider:</strong>
          <span>MERAV INTERIORS<br><a href="mailto:katie@meravinteriors.com">katie@meravinteriors.com</a></span>
        </div>
      </div>
      <div>
        <div class="title">SERVICE INVOICE</div>
        <div class="meta">
          <strong>Date:</strong><span>${escapeHtml(formatDateForInvoice(draft.invoiceDate))}</span>
          <strong>Address:</strong><span>${address}</span>
        </div>
      </div>
    </section>
    ${sectionTables}
    <section class="summary">
      <div class="fee-row"><strong class="fee-label">Total Design Fee:</strong><span class="fee-box">${formatMoney(fee)}</span></div>
      <div class="summary-row"><strong>Paid:</strong><span>${paid ? formatMoney(paid) : ""}</span></div>
      <div class="summary-row"><strong><u>Design Fee Due:</u></strong><strong><u>${formatMoney(Math.max(fee - paid, 0))}</u></strong></div>
      ${phaseLines}
      <div class="pay">
        <div>${draft.stripeLink ? `<a href="${escapeHtml(draft.stripeLink)}">CLICK HERE TO PAY</a>` : "CLICK HERE TO PAY"}</div>
        <div>${formatMoney(selectedAmount)}</div>
      </div>
      <div class="sig"><span>Authorized by Client</span><span>Date</span></div>
      <div class="sig"><span>Authorized by MERAV INTERIORS</span><span>Date</span></div>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function invoicePdfFileName(fileName?: string | null) {
  const safeName = (fileName || "Invoice").replace(/\.(html?|pdf)$/i, "").trim() || "Invoice";
  return `${safeName}.pdf`;
}

async function downloadInvoicePdf(pdfDataUrl: string | null, fileName?: string | null) {
  if (!pdfDataUrl) return;
  try {
    if (pdfDataUrl.startsWith("data:")) {
      const blob = await (await fetch(pdfDataUrl)).blob();
      if (blob.type === "text/html") {
        printHtmlAsPdf(await blob.text(), fileName);
        return;
      }

      const url = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
      triggerDownload(url, invoicePdfFileName(fileName));
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }

    triggerDownload(pdfDataUrl, invoicePdfFileName(fileName));
  } catch {
    toast.error("Could not download invoice PDF.");
  }
}

function printServiceInvoiceDraft(draft: ServiceInvoiceDraft) {
  const fee = calculatedDesignFee(draft);
  if (fee <= 0) return toast.error("Enter square feet and the matching price per sq/ft first.");
  const payments = draft.phases.map((phase, index) => ({
    label: `Phase ${index + 1} - ${phase.name}`,
    amount: phaseAmount(fee, phase.percent),
    due_date: phase.dueDate || null,
    status: "due",
    notes: draft.currentPhase === phase.name && draft.stripeLink ? `Stripe payment link: ${draft.stripeLink}` : null,
    sort_order: index,
  }));
  printHtmlAsPdf(buildServiceInvoiceHtml(draft, fee, payments), `${draft.projectName || "Project"} Design Service Invoice`);
}

function printHtmlAsPdf(html: string, fileName?: string | null) {
  const target = window.open("", "_blank");
  if (!target) {
    toast.error("Could not open the PDF window. Please allow popups for Studio.");
    return;
  }

  target.opener = null;
  target.document.open();
  target.document.write(html);
  target.document.close();
  target.document.title = invoicePdfFileName(fileName);
  target.setTimeout(() => {
    target.focus();
    target.print();
  }, 350);
}

function triggerDownload(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
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
    if (blob.type === "text/html") {
      const html = await blob.text();
      if (target) {
        target.document.open();
        target.document.write(html);
        target.document.close();
      } else {
        const htmlUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        window.open(htmlUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(htmlUrl), 60_000);
      }
      return;
    }
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
