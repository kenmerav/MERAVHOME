import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, ExternalLink, FileText, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { downloadInvoiceDocument, openInvoiceDocument } from "@/lib/invoiceDocuments";
import { formatMoney } from "@/lib/money";

type ClientInvoice = {
  id: string;
  project_id: string;
  project_name: string;
  file_name: string;
  pdf_data_url: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  paid_amount: number | null;
  balance_due: number | null;
  payments: Array<{
    id: string;
    label: string;
    amount: number;
    due_date: string | null;
    status: string;
    notes: string | null;
    paid_at: string | null;
  }>;
};

type ClientFinancialsDashboard = {
  projects: Array<{
    id: string;
    name: string;
    client_name: string;
  }>;
  invoices: ClientInvoice[];
};

export const Route = createFileRoute("/client/financials")({
  head: () => ({
    meta: [
      { title: "Invoices — MERAV Studio" },
      { name: "description", content: "Client-facing MERAV Studio invoices and payment history." },
    ],
  }),
  component: ClientFinancialsPage,
});

function ClientFinancialsPage() {
  const projectFilter = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("project") : null;
  const { data, isLoading, error } = useQuery({
    queryKey: ["clientFinancials"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in to view financials.");
      const res = await fetch("/api/client-dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not load financials.");
      return body as ClientFinancialsDashboard;
    },
  });

  const projects = data?.projects ?? [];
  const selectedProject = projectFilter ? projects.find((project) => project.id === projectFilter) : null;
  const invoices = (data?.invoices ?? []).filter((invoice) => !projectFilter || invoice.project_id === projectFilter);

  return (
    <AppShell>
      <div className="page-pad max-w-[1300px]">
        <div className="mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="eyebrow mb-3">Client Invoices</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">
              {selectedProject ? selectedProject.name : "Invoices"}
            </h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              View current and past invoices shared by MERAV Studio. Use Download PDF when you want to save a copy.
            </p>
          </div>
          {selectedProject && (
            <Link to="/client/financials" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-ink">
              View all invoices <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        {projects.length > 1 && (
          <div className="mb-8 flex flex-wrap gap-2">
            <Link
              to="/client/financials"
              className={`border px-4 py-2 text-sm ${!projectFilter ? "border-ink bg-ink text-primary-foreground" : "border-border hover:border-ink"}`}
            >
              All Projects
            </Link>
            {projects.map((project) => (
              <a
                key={project.id}
                href={`/client/financials?project=${project.id}`}
                className={`border px-4 py-2 text-sm ${projectFilter === project.id ? "border-ink bg-ink text-primary-foreground" : "border-border hover:border-ink"}`}
              >
                {project.name}
              </a>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="border border-border bg-bone/20 p-8 text-sm text-muted-foreground">Loading invoices…</div>
        ) : error ? (
          <div className="border border-destructive/30 bg-destructive/5 p-8 text-sm text-destructive">
            {error instanceof Error ? error.message : "Could not load invoices."}
          </div>
        ) : invoices.length === 0 ? (
          <div className="border border-dashed border-border bg-bone/20 p-12 text-center">
            <ReceiptText className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
            <div className="font-display text-3xl">No invoices shared yet</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Once MERAV Studio shares an invoice, it will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {invoices.map((invoice) => (
              <InvoiceCard key={invoice.id} invoice={invoice} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function InvoiceCard({ invoice }: { invoice: ClientInvoice }) {
  const duePayments = invoice.payments.filter((payment) => payment.status === "due");
  const paidPayments = invoice.payments.filter((payment) => payment.status === "paid");
  const paymentUrl = currentPaymentUrl(invoice);

  const handleOpen = async () => {
    try {
      await openInvoiceDocument(invoice.pdf_data_url, invoice.file_name, { paymentUrl });
    } catch {
      toast.error("Could not open invoice.");
    }
  };

  const handleDownload = async () => {
    try {
      await downloadInvoiceDocument(invoice.pdf_data_url, invoice.file_name, { paymentUrl });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download invoice.");
    }
  };

  return (
    <article className="border border-border bg-background p-6 lg:p-7">
      <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <div className="eyebrow mb-2">{invoice.invoice_date ? formatDashboardDate(invoice.invoice_date) : "Invoice"}</div>
          <h2 className="font-display text-3xl">{invoiceTitle(invoice)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{invoice.project_name}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:min-w-[360px]">
          <InvoiceMetric label="Total" value={formatMoney(invoice.total_amount ?? 0)} />
          <InvoiceMetric label="Paid" value={formatMoney(invoice.paid_amount ?? 0)} />
          <InvoiceMetric label="Remaining Due" value={formatMoney(invoice.balance_due ?? 0)} />
        </div>
      </div>

      {invoice.payments.length > 0 && (
        <div className="mt-6 overflow-x-auto border border-border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoice.payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-4 py-3">{payment.label}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(payment.amount)}</td>
                  <td className="px-4 py-3 capitalize">{payment.status.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {duePayments.length > 0
            ? `${duePayments.length} payment${duePayments.length === 1 ? "" : "s"} currently due`
            : paidPayments.length === invoice.payments.length && invoice.payments.length > 0
              ? "Paid"
              : "No payment currently due"}
        </div>
        <div className="flex flex-wrap gap-2">
          {invoice.pdf_data_url && (
            <>
              {paymentUrl && (
                <Button type="button" variant="outline" onClick={() => window.open(paymentUrl, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-4 w-4" /> Pay Online
                </Button>
              )}
              <Button type="button" variant="outline" onClick={handleOpen}>
                <FileText className="h-4 w-4" /> View Invoice
              </Button>
              <Button type="button" onClick={handleDownload}>
                <Download className="h-4 w-4" /> Download PDF
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function currentPaymentUrl(invoice: ClientInvoice) {
  const dueWithLink = invoice.payments.find((payment) => payment.status === "due" && stripeLinkFromNotes(payment.notes));
  return stripeLinkFromNotes(dueWithLink?.notes);
}

function invoiceTitle(invoice: ClientInvoice) {
  const projectName = invoice.project_name?.trim();
  return projectName ? `${projectName} Invoice` : "Invoice";
}

function stripeLinkFromNotes(notes?: string | null) {
  return notes?.match(/https:\/\/(?:buy|checkout)\.stripe\.com\/[^\s"')<]+/i)?.[0] ?? null;
}

function InvoiceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border px-4 py-3">
      <div className="eyebrow mb-1">{label}</div>
      <div className="font-display text-2xl">{value}</div>
    </div>
  );
}

function formatDashboardDate(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
