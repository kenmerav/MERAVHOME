import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Send, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import {
  db,
  type FinancialInvoice,
  type FinancialInvoiceAdjustment,
  type FinancialInvoicePayment,
} from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { canViewFinancials } from "@/lib/permissions";
import { formatMoney, procurementTotals } from "@/lib/money";
import { invoiceDraftPricingChanged, type ServiceInvoicePaymentSummary } from "@/lib/serviceInvoicePayments";
import { buildServiceInvoiceTemplate, waitForInvoiceAssets } from "@/lib/serviceInvoiceTemplate";
import { openInvoiceDocument, downloadInvoiceDocument } from "@/lib/invoiceDocuments";
import {
  financialInvoiceLedger,
  INVOICE_ADJUSTMENT_PAYMENT_NOTE,
  type FinancialAdjustmentStatus,
  type FinancialAdjustmentType,
} from "@/lib/financialInvoiceLedger";

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
type AdjustmentDraft = {
  adjustment_type: FinancialAdjustmentType;
  label: string;
  amount: number;
  status: FinancialAdjustmentStatus;
  notes: string | null;
};
type QuickBooksStatus = {
  configured: boolean;
  connected: boolean;
  environment: "sandbox" | "production";
  realmId: string | null;
  projectLink: {
    quickbooks_customer_id: string | null;
    quickbooks_customer_name: string | null;
    quickbooks_project_id: string | null;
    quickbooks_project_name: string | null;
  } | null;
};
type QuickBooksCustomerOption = {
  id: string;
  name: string;
  companyName: string | null;
};
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
  const [quickBooksCustomerId, setQuickBooksCustomerId] = useState("");
  const [quickBooksCustomerName, setQuickBooksCustomerName] = useState("");
  const [quickBooksCustomerSearch, setQuickBooksCustomerSearch] = useState("");
  const [savingQuickBooksLink, setSavingQuickBooksLink] = useState(false);
  const [syncingQuickBooksInvoiceId, setSyncingQuickBooksInvoiceId] = useState<string | null>(null);
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
  const { data: quickBooksStatus, refetch: refetchQuickBooksStatus } = useQuery({
    queryKey: ["quickBooksStatus", id],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in as Ken or Katie to use QuickBooks.");
      const res = await fetch(`/api/quickbooks/status?projectId=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not load QuickBooks status.");
      return body as QuickBooksStatus;
    },
    enabled: allowed,
  });
  const { data: quickBooksCustomers = [], isFetching: loadingQuickBooksCustomers, refetch: refetchQuickBooksCustomers } = useQuery({
    queryKey: ["quickBooksCustomers", quickBooksCustomerSearch],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in as Ken or Katie to load QuickBooks customers.");
      const params = new URLSearchParams();
      if (quickBooksCustomerSearch.trim()) params.set("search", quickBooksCustomerSearch.trim());
      const res = await fetch(`/api/quickbooks/customers${params.toString() ? `?${params.toString()}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not load QuickBooks customers.");
      return (body.customers ?? []) as QuickBooksCustomerOption[];
    },
    enabled: allowed && Boolean(quickBooksStatus?.connected),
  });

  useEffect(() => {
    setQuickBooksCustomerId(quickBooksStatus?.projectLink?.quickbooks_customer_id ?? "");
    setQuickBooksCustomerName(quickBooksStatus?.projectLink?.quickbooks_customer_name ?? "");
  }, [quickBooksStatus?.projectLink?.quickbooks_customer_id, quickBooksStatus?.projectLink?.quickbooks_customer_name]);

  const totals = useMemo(() => {
    const payments = invoices.flatMap((invoice) => invoice.payments ?? []);
    const ledgers = invoices.map(financialInvoiceLedger);
    return {
      due: ledgers.reduce((sum, ledger) => sum + ledger.balanceDue, 0),
      paid: ledgers.reduce((sum, ledger) => sum + ledger.grossPaid, 0),
      total: ledgers.reduce((sum, ledger) => sum + ledger.adjustedTotal, 0),
      credit: ledgers.reduce((sum, ledger) => sum + ledger.creditOwed, 0),
      count: payments.length,
    };
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
        client_visible: true,
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
    setServiceDraft({
      ...serviceDraft, ...patch,
      ...(invoiceDraftPricingChanged(serviceDraft, patch) ? { stripeLink: "", stripePaymentLinkId: "" } : {}),
    });
  };

  const updateServicePhase = (index: number, patch: Partial<ServiceInvoiceDraft["phases"][number]>) => {
    if (!serviceDraft) return;
    setServiceDraft({
      ...serviceDraft,
      phases: serviceDraft.phases.map((phase, i) => i === index ? { ...phase, ...patch } : phase),
      stripeLink: "",
      stripePaymentLinkId: "",
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
    const paid = paidDesignFee(serviceDraft, fee);
    if (fee <= 0) return toast.error("Enter square feet and the matching price per sq/ft first.");
    setSavingServiceInvoice(true);
    try {
      const phaseAmounts = servicePhaseAmounts(serviceDraft, fee);
      const phasePayments = serviceDraft.phases.map((phase, index) => ({
        project_id: id,
        label: `Phase ${index + 1} - ${phase.name}`,
        amount: phaseAmounts[index],
        due_date: null,
        status: (serviceDraft.currentPhase === phase.name ? "due" : "not_due") as "due" | "not_due",
        notes: serviceDraft.currentPhase === phase.name && serviceDraft.stripeLink ? `Stripe payment link: ${serviceDraft.stripeLink}` : null,
        stripe_payment_link_id: serviceDraft.currentPhase === phase.name ? serviceDraft.stripePaymentLinkId || null : null,
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
        paid_at: null,
        sort_order: index + (paid > 0 ? 1 : 0),
      }));
      const payments = paid > 0
        ? [{
            project_id: id,
            label: "Previously Paid",
            amount: paid,
            due_date: null,
            status: "paid" as const,
            notes: "Payment received before this invoice was created.",
            stripe_payment_link_id: null,
            stripe_checkout_session_id: null,
            stripe_payment_intent_id: null,
            paid_at: new Date().toISOString(),
            sort_order: 0,
          }, ...phasePayments]
        : phasePayments;
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
        client_visible: true,
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
    const phaseIndex = serviceDraft.phases.findIndex((phase) => phase.name === serviceDraft.currentPhase);
    const paymentAmount = phaseIndex >= 0 ? servicePhaseAmounts(serviceDraft, fee)[phaseIndex] : 0;
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

  const updatePaymentStatus = async (payment: FinancialInvoicePayment, status: FinancialInvoicePayment["status"], includeCharges = false) => {
    if (!allowed) return toast.error("Only Ken and Katie can edit invoices.");
    setSavingPaymentId(payment.id);
    try {
      if (status === "due") {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Sign in as Ken or Katie to use invoice tools.");
        const res = await fetch("/api/mark-financial-payment-due", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ paymentId: payment.id, includeCharges }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not mark payment due.");
        if (body?.warning) toast.warning(body.warning);
        else toast.success("Payment marked due and Stripe link updated");
      } else {
        await db.updateFinancialPayment(payment.id, {
          status,
          paid_at: status === "paid" ? payment.paid_at ?? new Date().toISOString() : null,
        });
        if (status === "paid" && payment.invoice_id) {
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) throw new Error("Sign in as Ken or Katie to sync QuickBooks.");
            const res = await fetch("/api/quickbooks/sync-invoice", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ invoiceId: payment.invoice_id }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.error || "Payment marked paid, but QuickBooks did not sync.");
            toast.success(`Payment marked paid and sent to QuickBooks${body.syncedPaymentCount ? ` with ${body.syncedPaymentCount} payment(s)` : ""}`);
            refetchQuickBooksStatus();
          } catch (quickBooksError: any) {
            toast.warning(quickBooksError?.message || "Payment marked paid, but QuickBooks sync needs attention.");
          }
        } else {
          toast.success("Payment status updated");
        }
      }
      qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
      qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not update payment.");
    } finally {
      setSavingPaymentId(null);
    }
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

  const createInvoiceAdjustment = async (invoice: FinancialInvoice, draft: AdjustmentDraft) => {
    if (!allowed) throw new Error("Only Ken and Katie can add invoice adjustments.");
    await db.createFinancialInvoiceAdjustment({
      invoice_id: invoice.id,
      project_id: invoice.project_id,
      adjustment_type: draft.adjustment_type,
      label: draft.label,
      amount: draft.amount,
      status: draft.status,
      notes: draft.notes,
      settled_at: adjustmentIsSettled(draft.status) ? new Date().toISOString() : null,
      sort_order: invoice.adjustments?.length ?? 0,
    });
    qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
    qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
  };

  const updateInvoiceAdjustment = async (
    adjustment: FinancialInvoiceAdjustment,
    status: FinancialAdjustmentStatus,
  ) => {
    if (!allowed) throw new Error("Only Ken and Katie can update invoice adjustments.");
    await db.updateFinancialInvoiceAdjustment(adjustment.id, {
      status,
      settled_at: adjustmentIsSettled(status)
        ? adjustment.settled_at ?? new Date().toISOString()
        : null,
    });
    qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
    qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
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

  const toggleClientVisible = async (invoice: FinancialInvoice) => {
    if (!allowed) return toast.error("Only Ken and Katie can edit invoices.");
    try {
      await db.updateFinancialInvoice(invoice.id, { client_visible: !invoice.client_visible });
      qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
      qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
      toast.success(!invoice.client_visible ? "Invoice will show on the client dashboard" : "Invoice hidden from the client dashboard");
    } catch (e: any) {
      toast.error(e?.message || "Could not update invoice visibility.");
    }
  };

  const connectQuickBooks = async () => {
    if (!allowed) return toast.error("Only Ken and Katie can connect QuickBooks.");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in as Ken or Katie to connect QuickBooks.");
      const res = await fetch("/api/quickbooks/connect-url", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok || !body?.url) throw new Error(body?.error || "Could not start QuickBooks connection.");
      window.open(body.url, "_blank", "noopener,noreferrer");
      toast.message("Finish the QuickBooks connection in the new tab, then refresh this status.");
    } catch (error: any) {
      toast.error(error?.message || "Could not connect QuickBooks.");
    }
  };

  const saveQuickBooksLink = async () => {
    if (!allowed) return toast.error("Only Ken and Katie can edit QuickBooks links.");
    setSavingQuickBooksLink(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in as Ken or Katie to save QuickBooks links.");
      const res = await fetch("/api/quickbooks/project-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          projectId: id,
          quickbooksCustomerId: quickBooksCustomerId,
          quickbooksCustomerName: quickBooksCustomerName,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not save QuickBooks link.");
      toast.success("QuickBooks customer link saved");
      refetchQuickBooksStatus();
    } catch (error: any) {
      toast.error(error?.message || "Could not save QuickBooks link.");
    } finally {
      setSavingQuickBooksLink(false);
    }
  };

  const syncInvoiceToQuickBooks = async (invoice: FinancialInvoice) => {
    if (!allowed) return toast.error("Only Ken and Katie can send invoices to QuickBooks.");
    setSyncingQuickBooksInvoiceId(invoice.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in as Ken or Katie to sync QuickBooks.");
      const res = await fetch("/api/quickbooks/sync-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not send invoice to QuickBooks.");
      toast.success(`Sent to QuickBooks${body.syncedPaymentCount ? ` with ${body.syncedPaymentCount} payment(s)` : ""}`);
      qc.invalidateQueries({ queryKey: ["financialInvoices", id] });
      qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
      refetchQuickBooksStatus();
    } catch (error: any) {
      toast.error(error?.message || "Could not send invoice to QuickBooks.");
    } finally {
      setSyncingQuickBooksInvoiceId(null);
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4 mb-10">
          <Stat label="Invoice Revenue" value={formatMoney(totals.total)} />
          <Stat label="Paid" value={formatMoney(totals.paid)} />
          <Stat label="Due" value={formatMoney(totals.due)} />
          <Stat label="Client Credit Owed" value={formatMoney(totals.credit)} />
          <Stat label="Procurement Profit" value={formatMoney(projectProcurement.profit)} />
          <Stat label="Total Project Profit" value={formatMoney(totalProjectProfit)} />
          <Stat label="Payment Lines" value={String(totals.count)} />
        </div>

        <QuickBooksPanel
          status={quickBooksStatus}
          customerId={quickBooksCustomerId}
          customerName={quickBooksCustomerName}
          customerSearch={quickBooksCustomerSearch}
          customers={quickBooksCustomers}
          loadingCustomers={loadingQuickBooksCustomers}
          saving={savingQuickBooksLink}
          onConnect={connectQuickBooks}
          onRefresh={() => {
            refetchQuickBooksStatus();
            refetchQuickBooksCustomers();
          }}
          onCustomerId={setQuickBooksCustomerId}
          onCustomerName={setQuickBooksCustomerName}
          onCustomerSearch={setQuickBooksCustomerSearch}
          onSelectCustomer={(customer) => {
            setQuickBooksCustomerId(customer.id);
            setQuickBooksCustomerName(customer.name);
            setQuickBooksCustomerSearch(customer.name);
          }}
          onSave={saveQuickBooksLink}
        />

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
                        <th className="py-3 px-4">Due When</th>
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
                            <td className="py-3 px-4 text-right min-w-[130px]">{formatMoney(servicePhaseAmounts(serviceDraft, fee)[index])}</td>
                            <td className="py-3 px-4 min-w-[220px] text-muted-foreground">
                              {phaseDueLabel(phase.name)}
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
              onAdjustmentCreate={createInvoiceAdjustment}
              onAdjustmentStatus={updateInvoiceAdjustment}
              savingPaymentId={savingPaymentId}
              onDelete={deleteInvoice}
              onClientVisible={toggleClientVisible}
              onQuickBooksSync={syncInvoiceToQuickBooks}
              quickBooksSyncing={syncingQuickBooksInvoiceId === invoice.id}
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
  onAdjustmentCreate,
  onAdjustmentStatus,
  savingPaymentId,
  onDelete,
  onClientVisible,
  onQuickBooksSync,
  quickBooksSyncing,
  deleting,
}: {
  invoice: FinancialInvoice;
  onStatus: (payment: FinancialInvoicePayment, status: FinancialInvoicePayment["status"], includeCharges?: boolean) => void;
  onPaymentUpdate: (payment: FinancialInvoicePayment, patch: Partial<FinancialInvoicePayment>) => void;
  onAdjustmentCreate: (invoice: FinancialInvoice, draft: AdjustmentDraft) => Promise<void>;
  onAdjustmentStatus: (
    adjustment: FinancialInvoiceAdjustment,
    status: FinancialAdjustmentStatus,
  ) => Promise<void>;
  savingPaymentId?: string | null;
  onDelete: (invoice: FinancialInvoice) => void;
  onClientVisible: (invoice: FinancialInvoice) => void;
  onQuickBooksSync: (invoice: FinancialInvoice) => void;
  quickBooksSyncing?: boolean;
  deleting?: boolean;
}) {
  const payments = [...(invoice.payments ?? [])].filter(payment => !payment.notes?.startsWith(INVOICE_ADJUSTMENT_PAYMENT_NOTE))
    .sort((a, b) => a.sort_order - b.sort_order);
  const printableDataUrl = printableInvoiceDataUrl(invoice);
  const quickBooksStatus = invoice.quickbooks_sync_status ?? "not_sent";
  const paidTotal = payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const ledger = financialInvoiceLedger(invoice);
  const documentOptions = {
    invoiceTitle: invoice.file_name,
    clientName: invoice.client_name,
    servicePayments: {
      payments,
      adjustments: invoice.adjustments,
      totalAmount: ledger.originalTotal,
      paidAmount: ledger.grossPaid,
      balanceDue: ledger.balanceDue,
    },
  };
  const openPdf = async (download = false) => {
    try {
      await (download ? downloadInvoiceDocument : openInvoiceDocument)(
        printableDataUrl, invoice.file_name, documentOptions,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open invoice PDF.");
    }
  };
  return (
    <section className="border border-border">
      <div className="p-6 border-b border-border flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">{invoice.invoice_date || "Invoice"}</div>
          <h2 className="font-display text-3xl">{invoice.file_name || "Invoice PDF"}</h2>
          <p className="text-sm text-muted-foreground mt-2">
            {[invoice.client_name, invoice.provider_name, `Balance ${formatMoney(ledger.balanceDue)}`].filter(Boolean).join(" - ")}
          </p>
          {ledger.creditOwed > 0 && (
            <p className="mt-2 text-sm font-medium text-emerald-800">
              Client credit owed: {formatMoney(ledger.creditOwed)}
            </p>
          )}
          {quickBooksStatus !== "not_sent" && (
            <p className={`text-xs mt-2 ${quickBooksStatus === "failed" ? "text-destructive" : "text-emerald-800"}`}>
              QuickBooks: {quickBooksStatus === "failed" ? invoice.quickbooks_sync_error || "Sync failed" : `sent${invoice.quickbooks_synced_at ? ` ${new Date(invoice.quickbooks_synced_at).toLocaleString()}` : ""}`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {payments.filter(payment => payment.status === "due").slice(-1).map(payment => (
            <button key={payment.id} type="button" disabled={savingPaymentId === payment.id}
              onClick={() => onStatus(payment, "due", true)}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border hover:border-ink disabled:opacity-50">
              {savingPaymentId === payment.id ? "Creating link..." : "Refresh Payment Link"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onClientVisible(invoice)}
            className={`inline-flex items-center gap-2 text-sm px-4 py-2 border ${invoice.client_visible ? "border-emerald-700 text-emerald-800" : "border-border text-muted-foreground hover:border-ink"}`}
          >
            {invoice.client_visible ? "Client Visible" : "Show to Client"}
          </button>
          {printableDataUrl && (
            <button type="button" onClick={() => openPdf()} className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border hover:border-ink">
              <FileText className="w-4 h-4" /> PDF
            </button>
          )}
          {printableDataUrl && (
            <button type="button" onClick={() => openPdf(true)} className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border hover:border-ink">
              <FileText className="w-4 h-4" /> Download PDF
            </button>
          )}
          <button
            type="button"
            onClick={() => onQuickBooksSync(invoice)}
            disabled={quickBooksSyncing || paidTotal <= 0}
            title={paidTotal <= 0 ? "Mark at least one payment paid before sending to QuickBooks." : undefined}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border hover:border-ink disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> {quickBooksSyncing ? "Sending..." : invoice.quickbooks_invoice_id ? "Resend Paid QB" : "Send Paid QB"}
          </button>
          <button type="button" onClick={() => onDelete(invoice)} disabled={deleting} className="inline-flex items-center gap-2 text-sm px-4 py-2 border border-border text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
      <PaymentTable payments={payments} onStatus={onStatus} onSavedPaymentChange={onPaymentUpdate} savingPaymentId={savingPaymentId} />
      <InvoiceAdjustments
        invoice={invoice}
        ledger={ledger}
        onCreate={onAdjustmentCreate}
        onStatus={onAdjustmentStatus}
      />
    </section>
  );
}

function InvoiceAdjustments({
  invoice,
  ledger,
  onCreate,
  onStatus,
}: {
  invoice: FinancialInvoice;
  ledger: ReturnType<typeof financialInvoiceLedger>;
  onCreate: (invoice: FinancialInvoice, draft: AdjustmentDraft) => Promise<void>;
  onStatus: (
    adjustment: FinancialInvoiceAdjustment,
    status: FinancialAdjustmentStatus,
  ) => Promise<void>;
}) {
  const [kind, setKind] = useState<FinancialAdjustmentType>("charge");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const adjustments = [...(invoice.adjustments ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
  );

  const addAdjustment = async () => {
    const parsedAmount = numberValue(amount) ?? 0;
    if (!label.trim()) return toast.error("Add a reason for the adjustment.");
    if (parsedAmount <= 0) return toast.error("Enter an adjustment amount greater than $0.");
    setSaving(true);
    try {
      await onCreate(invoice, {
        adjustment_type: kind,
        label: label.trim(),
        amount: parsedAmount,
        status: "open",
        notes: notes.trim() || null,
      });
      setLabel("");
      setAmount("");
      setNotes("");
      toast.success(kind === "credit" ? "Client credit added" : "Additional charge added");
    } catch (error: any) {
      toast.error(error?.message || "Could not add the adjustment.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (
    adjustment: FinancialInvoiceAdjustment,
    status: FinancialAdjustmentStatus,
  ) => {
    setSavingStatusId(adjustment.id);
    try {
      await onStatus(adjustment, status);
      toast.success("Adjustment status updated");
    } catch (error: any) {
      toast.error(error?.message || "Could not update the adjustment.");
    } finally {
      setSavingStatusId(null);
    }
  };

  return (
    <div className="border-t border-border bg-bone/20 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow mb-2">Adjustments</div>
          <h3 className="font-display text-2xl">Invoice items, extras & credits</h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Add services or extra items to this invoice as an additional charge. Added items and credits appear when you open or download the invoice. Record refunds separately in Stripe or QuickBooks, then mark them refunded here.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <AdjustmentMetric label="Adjusted Total" value={ledger.adjustedTotal} />
          <AdjustmentMetric label="Remaining Due" value={ledger.balanceDue} />
          <AdjustmentMetric label="Credit Owed" value={ledger.creditOwed} credit />
          <AdjustmentMetric label="Refunded" value={ledger.refundedTotal} />
        </div>
      </div>

      {adjustments.length > 0 && (
        <div className="mobile-card-scroll mt-5 border border-border bg-background">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((adjustment) => (
                <tr key={adjustment.id} className={`border-b border-border ${adjustment.status === "void" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 capitalize">{adjustment.adjustment_type}</td>
                  <td className="px-4 py-3 min-w-[260px]">
                    <div>{adjustment.label}</div>
                    {adjustment.notes && <div className="mt-1 text-xs text-muted-foreground">{adjustment.notes}</div>}
                  </td>
                  <td className={`px-4 py-3 text-right ${adjustment.adjustment_type === "credit" ? "text-emerald-800" : ""}`}>
                    {adjustment.adjustment_type === "credit" ? "−" : "+"}{formatMoney(adjustment.amount)}
                  </td>
                  <td className="px-4 py-3 min-w-[180px]">
                    <select
                      value={adjustment.status}
                      disabled={savingStatusId === adjustment.id}
                      onChange={(event) => changeStatus(adjustment, event.target.value as FinancialAdjustmentStatus)}
                      className="h-9 w-full border border-input bg-background px-2 text-xs capitalize disabled:opacity-60"
                    >
                      {adjustmentStatusOptions(adjustment.adjustment_type).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-[150px_1.2fr_150px_1fr_auto] md:items-end">
        <div>
          <Label className="eyebrow">Type</Label>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as FinancialAdjustmentType)}
            className="h-10 w-full border border-input bg-background px-3 text-sm"
          >
            <option value="credit">Client Credit</option>
            <option value="charge">Additional Charge</option>
          </select>
        </div>
        <div>
          <Label className="eyebrow">Reason</Label>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Material ordering, additional services, or credit" />
        </div>
        <div>
          <Label className="eyebrow">Amount</Label>
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="100.00" />
        </div>
        <div>
          <Label className="eyebrow">Internal / Client Note</Label>
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional details" />
        </div>
        <button
          type="button"
          onClick={addAdjustment}
          disabled={saving}
          className="h-10 whitespace-nowrap bg-ink px-4 text-sm text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Adding..." : kind === "charge" ? "Add Invoice Item" : "Add Credit"}
        </button>
      </div>
    </div>
  );
}

function AdjustmentMetric({ label, value, credit }: { label: string; value: number; credit?: boolean }) {
  return (
    <div className={`border px-3 py-2 ${credit && value > 0 ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-border bg-background"}`}>
      <div className="text-[9px] uppercase tracking-[0.13em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl">{formatMoney(value)}</div>
    </div>
  );
}

function QuickBooksPanel({
  status,
  customerId,
  customerName,
  customerSearch,
  customers,
  loadingCustomers,
  saving,
  onConnect,
  onRefresh,
  onCustomerId,
  onCustomerName,
  onCustomerSearch,
  onSelectCustomer,
  onSave,
}: {
  status?: QuickBooksStatus;
  customerId: string;
  customerName: string;
  customerSearch: string;
  customers: QuickBooksCustomerOption[];
  loadingCustomers: boolean;
  saving: boolean;
  onConnect: () => void;
  onRefresh: () => void;
  onCustomerId: (value: string) => void;
  onCustomerName: (value: string) => void;
  onCustomerSearch: (value: string) => void;
  onSelectCustomer: (customer: QuickBooksCustomerOption) => void;
  onSave: () => void;
}) {
  const selectedValue = customerId ? `${customerId}::${customerName}` : "";
  return (
    <section className="border border-border bg-bone/20 p-5 mb-10">
      <div className="flex flex-col xl:flex-row xl:items-end gap-5 justify-between">
        <div className="max-w-2xl">
          <div className="eyebrow mb-2">QuickBooks</div>
          <h2 className="font-display text-3xl">QuickBooks Sync</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Connect QuickBooks, link this Studio project to a QuickBooks customer, then send paid Studio invoices when ready.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Status: {status?.configured ? status.connected ? `Connected (${status.environment})` : `Configured, not connected (${status.environment})` : "Missing Vercel env vars"}
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full xl:max-w-[760px]">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3 lg:items-end">
            <div>
              <Label className="eyebrow">QuickBooks Customer</Label>
              <Input
                value={customerSearch}
                onChange={(event) => onCustomerSearch(event.target.value)}
                placeholder={status?.connected ? "Search QuickBooks customers" : "Connect QuickBooks first"}
                disabled={!status?.connected}
              />
            </div>
            <button type="button" onClick={onRefresh} className="px-4 py-2 border border-border text-sm hover:border-ink">
              Refresh Customers
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 lg:items-end">
            <div>
              <Label className="eyebrow">Choose From QuickBooks</Label>
              <select
                value={selectedValue}
                onChange={(event) => {
                  const customer = customers.find((option) => `${option.id}::${option.name}` === event.target.value);
                  if (customer) onSelectCustomer(customer);
                }}
                disabled={!status?.connected || loadingCustomers}
                className="h-10 w-full border border-input bg-background px-3 text-sm disabled:opacity-50"
              >
                <option value="">
                  {loadingCustomers ? "Loading customers..." : customers.length ? "Select a QuickBooks customer" : "No customers found"}
                </option>
                {customers.map((customer) => (
                  <option key={customer.id} value={`${customer.id}::${customer.name}`}>
                    {customer.name}{customer.companyName ? ` - ${customer.companyName}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={onSave} disabled={!status?.connected || saving} className="px-4 py-2 border border-border text-sm hover:border-ink disabled:opacity-50">
              {saving ? "Saving..." : "Save Match"}
            </button>
            <button type="button" onClick={onConnect} disabled={!status?.configured} className="px-4 py-2 bg-ink text-primary-foreground text-sm disabled:opacity-50">
              {status?.connected ? "Reconnect" : "Connect"}
            </button>
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-ink">Manual customer ID fallback</summary>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
              <div>
                <Label className="eyebrow">QB Customer ID</Label>
                <Input value={customerId} onChange={(event) => onCustomerId(event.target.value)} placeholder="Optional" />
              </div>
              <div>
                <Label className="eyebrow">QB Customer Name</Label>
                <Input value={customerName} onChange={(event) => onCustomerName(event.target.value)} placeholder="Auto-create if blank" />
              </div>
            </div>
          </details>
        </div>
      </div>
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
            <th className="py-3 px-4">Due When</th>
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
              <td className="py-3 px-4 min-w-[220px]">
                {editable ? (
                  <span className="text-sm text-muted-foreground">{paymentDueLabel(payment)}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">{paymentDueLabel(payment)}</span>
                )}
              </td>
              <td className="py-3 px-4 min-w-[150px]">
                <select
                  value={payment.status}
                  disabled={savingPaymentId === (payment as FinancialInvoicePayment).id}
                  onChange={(e) => editable ? onChange?.(index, { status: e.target.value as any }) : onStatus?.(payment as FinancialInvoicePayment, e.target.value as any)}
                  className="h-9 w-full border border-input bg-background px-2 text-xs capitalize disabled:opacity-60"
                >
                  <option value="due">Due</option>
                  <option value="not_due">Not due yet</option>
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
  const paid = paidDesignFee(draft, fee);
  const phaseAmounts = servicePhaseAmounts(draft, fee);
  const phaseRows = draft.phases.map((phase, index) => ({
    ...phase,
    label: `Phase ${index + 1} - ${phase.name}`,
    amount: phaseAmounts[index],
  }));
  const selectedAmount = phaseRows.find((phase) => phase.name === draft.currentPhase)?.amount ?? 0;
  const percentTotal = draft.phases.reduce((sum, phase) => sum + (numberValue(phase.percent) ?? 0), 0);

  return (
    <div className="xl:sticky xl:top-6 self-start">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] xl:grid-cols-1 gap-5">
        <div className="bg-white p-3 text-black shadow-sm overflow-hidden sm:p-4">
          <div className="border border-neutral-400 px-[3%] pb-[7%] pt-[2%]">
          <div className="mb-14 text-center">
            <div className="whitespace-nowrap font-display text-[clamp(46px,6.4vw,69px)] font-light leading-[0.82] tracking-[-0.07em]">MERAV INTERIORS</div>
            <div className="mt-3 text-[12px] tracking-[0.4em] text-neutral-500">BY KATIE ROBERTS</div>
          </div>

          <div className="mb-8 grid min-h-[118px] grid-cols-[1.1fr_0.9fr] gap-10 text-[10px]">
            <div className="space-y-16">
              <div className="grid grid-cols-[72px_1fr] gap-x-3"><strong>Client:</strong><span>{draft.clientName || "Client Name"}</span></div>
              <div className="grid grid-cols-[72px_1fr] gap-x-3">
                <strong>Provider:</strong>
                <div>
                  MERAV INTERIORS<br />
                  <span className="text-blue-700">katie@meravinteriors.com</span>
                </div>
              </div>
            </div>
            <div>
              <h3 className="mb-9 text-right font-serif text-xl font-bold">SERVICE INVOICE</h3>
              <div className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-10">
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

          <div className="space-y-10 mb-14">
            {sections.map((section) => (
              <table key={section.kind} className="w-full border border-black text-[10px]">
                <thead>
                  <tr className="bg-[#e9e7de]">
                    <th colSpan={3} className="border-b border-black py-2.5 text-center font-bold">{section.title}</th>
                  </tr>
                  <tr className="bg-[#e9e7de] text-left">
                    <th className="border-r border-black border-b border-black py-2.5 px-1 w-[30%]">Location</th>
                    <th className="border-r border-black border-b border-black py-2.5 px-1">Description</th>
                    <th className="border-b border-black py-2.5 px-1 w-[14%]">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border-r border-black py-9 px-3 text-center font-bold">{section.location}</td>
                    <td className="border-r border-black py-9 px-4 text-center">{section.description}</td>
                    <td className="py-9 px-1 text-right">{formatMoney(section.amount)}</td>
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

          <div className="ml-auto max-w-[315px] text-[10px]">
            <div className="grid grid-cols-[1fr_110px] items-stretch mb-2">
              <span className="self-center pr-1 text-right font-bold text-base">Total Design Fee:</span>
              <span className="border border-black bg-[#e9e7de] px-2 py-3 text-right font-bold text-base">{formatMoney(fee)}</span>
            </div>
            <div className="grid grid-cols-[1fr_110px] gap-x-2 gap-y-1 text-right mb-5">
              <strong>Paid:</strong><span>{paid ? formatMoney(paid) : ""}</span>
              <strong className="underline">Design Fee Due:</strong><strong className="underline">{formatMoney(Math.max(fee - paid, 0))}</strong>
              {phaseRows.filter((phase) => phase.amount > 0).flatMap((phase) => {
                const emphasized = phase.name === draft.currentPhase;
                return [
                  <span key={`${phase.name}-label`} className={emphasized ? "font-bold" : undefined}>Due {phase.name === "Project Start" ? "on" : "at"} {phase.name}:</span>,
                  <span key={`${phase.name}-amount`} className={emphasized ? "font-bold" : undefined}>{formatMoney(phase.amount)}</span>,
                ];
              })}
            </div>
            <div className="grid grid-cols-[1fr_110px] border-2 border-black mb-10">
              <div className="bg-[#e9e7de] text-center text-blue-700 underline font-bold py-1">CLICK HERE TO PAY</div>
              <div className="bg-[#e9e7de] border-l border-black py-1 px-2 text-right font-bold">{formatMoney(selectedAmount)}</div>
            </div>
            <div className="space-y-10 italic">
              <div className="border-t border-black pt-2 flex justify-between"><span>Authorized by Client</span><span>Date</span></div>
              <div className="border-t border-black pt-2 flex justify-between"><span>Authorized by MERAV INTERIORS</span><span>Date</span></div>
            </div>
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

function adjustmentStatusOptions(type: FinancialAdjustmentType) {
  return type === "credit"
    ? [
        { value: "open" as const, label: "Credit owed" },
        { value: "refunded" as const, label: "Refunded" },
        { value: "applied" as const, label: "Applied to another balance" },
        { value: "void" as const, label: "Void" },
      ]
    : [
        { value: "open" as const, label: "Additional amount due" },
        { value: "paid" as const, label: "Paid" },
        { value: "waived" as const, label: "Waived" },
        { value: "void" as const, label: "Void" },
      ];
}

function adjustmentIsSettled(status: FinancialAdjustmentStatus) {
  return status === "refunded" || status === "applied" || status === "paid";
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

function paidDesignFee(draft: ServiceInvoiceDraft, fee: number) {
  return Math.min(Math.max(numberValue(draft.paid) ?? 0, 0), fee);
}

function remainingDesignFee(draft: ServiceInvoiceDraft, fee: number) {
  return roundMoney(Math.max(fee - paidDesignFee(draft, fee), 0));
}

function servicePhaseAmounts(draft: ServiceInvoiceDraft, fee: number) {
  const remainingFee = remainingDesignFee(draft, fee);
  const amounts = draft.phases.map((phase) => phaseAmount(remainingFee, phase.percent));
  const percentTotal = draft.phases.reduce((sum, phase) => sum + (numberValue(phase.percent) ?? 0), 0);

  if (Math.abs(percentTotal - 100) < 0.0001) {
    const lastPhaseIndex = draft.phases.reduce(
      (lastIndex, phase, index) => (numberValue(phase.percent) ?? 0) > 0 ? index : lastIndex,
      -1,
    );
    if (lastPhaseIndex >= 0) {
      const difference = roundMoney(remainingFee - amounts.reduce((sum, amount) => sum + amount, 0));
      amounts[lastPhaseIndex] = roundMoney(amounts[lastPhaseIndex] + difference);
    }
  }

  return amounts;
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

function invoiceDesignSections(draft: ServiceInvoiceDraft, includeEmpty = false): InvoiceDesignSection[] {
  const squareFeet = numberValue(draft.squareFeet) ?? 0;
  const sections: InvoiceDesignSection[] = [];
  const renovationAmount = roundMoney(squareFeet * activeRate(draft, "renovation"));
  const furnitureAmount = roundMoney(squareFeet * activeRate(draft, "furniture"));

  if (renovationAmount > 0 || includeEmpty) {
    sections.push({
      kind: "renovation",
      title: "Renovation Design",
      amount: renovationAmount,
      location: invoiceLocation(draft, "renovation"),
      description: invoiceDescription(draft, "renovation"),
    });
  }

  if (furnitureAmount > 0 || includeEmpty) {
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

function phaseDueLabel(phase: InvoicePhaseName) {
  if (phase === "Project Start") return "Due at project start";
  if (phase === "Design Presentation") return "Due when design presentation is delivered";
  if (phase === "Design Document Delivery") return "Due when design document is delivered";
  if (phase === "Project Completion") return "Due at project completion";
  return `Due at ${phase}`;
}

function paymentDueLabel(payment: Pick<FinancialInvoicePayment, "label" | "due_date"> | ReviewPayment) {
  const clean = String(payment.label || "Payment").replace(/^Phase \d+ - /, "");
  if (clean === "Project Start") return "Due at project start";
  if (clean === "Design Presentation") return "Due when design presentation is delivered";
  if (clean === "Design Document Delivery") return "Due when design document is delivered";
  if (clean === "Project Completion") return "Due at project completion";
  if (payment.due_date) return `Due ${formatDateForInvoice(payment.due_date)}`;
  return clean;
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
    const fee = financialInvoiceLedger(invoice).originalTotal || calculatedDesignFee(draft);
    const phaseAmounts = servicePhaseAmounts(draft, fee);
    const payments = (invoice.payments?.length ? invoice.payments : draft.phases.map((phase, index) => ({
      label: `Phase ${index + 1} - ${phase.name}`,
      amount: phaseAmounts[index],
      due_date: null,
      status: "not_due",
      notes: null,
      sort_order: index,
    }))).map((payment) => ({
      label: payment.label,
      amount: payment.amount ?? 0,
      due_date: payment.due_date,
      status: payment.status,
      notes: payment.notes,
      sort_order: payment.sort_order,
    }));
    const ledger = financialInvoiceLedger(invoice);
    return buildServiceInvoiceHtml(draft, fee, payments, {
      paidAmount: ledger.grossPaid,
      balanceDue: ledger.balanceDue,
    });
  } catch {
    return null;
  }
}

function buildServiceInvoiceHtml(
  draft: ServiceInvoiceDraft,
  fee: number,
  payments: Array<{ label: string; amount: number; due_date: string | null; status: string; notes: string | null; sort_order: number }>,
  totals: Pick<ServiceInvoicePaymentSummary, "paidAmount" | "balanceDue"> = {},
) {
  return buildServiceInvoiceTemplate({
    projectName: draft.projectName,
    clientName: draft.clientName,
    projectAddress: draft.projectAddress,
    invoiceDate: draft.invoiceDate,
    sections: invoiceDesignSections(draft, true),
    totalAmount: fee,
    payments,
    ...totals,
  });
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


function printServiceInvoiceDraft(draft: ServiceInvoiceDraft) {
  const fee = calculatedDesignFee(draft);
  if (fee <= 0) return toast.error("Enter square feet and the matching price per sq/ft first.");
  const phaseAmounts = servicePhaseAmounts(draft, fee);
  const payments = draft.phases.map((phase, index) => ({
    label: `Phase ${index + 1} - ${phase.name}`,
    amount: phaseAmounts[index],
    due_date: null,
    status: draft.currentPhase === phase.name ? "due" : "not_due",
    notes: draft.currentPhase === phase.name && draft.stripeLink ? `Stripe payment link: ${draft.stripeLink}` : null,
    sort_order: index,
  }));
  printHtmlAsPdf(buildServiceInvoiceHtml(draft, fee, payments, { paidAmount: paidDesignFee(draft, fee) }), `${draft.projectName || "Project"} Design Service Invoice`);
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
  const printColorStyle = target.document.createElement("style");
  printColorStyle.textContent = `
    html, body, *, *::before, *::after {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  `;
  target.document.head.appendChild(printColorStyle);
  target.document.title = invoicePdfFileName(fileName);
  target.setTimeout(async () => {
    try {
      await waitForInvoiceAssets(target.document);
    } catch {
      toast.error("Could not load the invoice logo or fonts. Please try again.");
      target.close();
      return;
    }
    target.focus();
    target.print();
  }, 350);
}
