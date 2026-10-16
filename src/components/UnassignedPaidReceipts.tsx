import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db, type FinancialInvoice, type Project } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { stripePaidReceipt } from "@/lib/stripePaidReceipts";

export function UnassignedPaidReceipts({ invoices, projects }: { invoices: FinancialInvoice[]; projects: Project[] }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const receipts = useMemo(() => invoices.filter(invoice => !invoice.project_id).flatMap(invoice => {
    const receipt = stripePaidReceipt(invoice);
    return receipt ? [{ invoice, receipt }] : [];
  }).sort((a, b) => (b.invoice.invoice_date || "").localeCompare(a.invoice.invoice_date || "")), [invoices]);
  const visible = receipts.filter(({ invoice, receipt }) =>
    `${invoice.client_name || ""} ${receipt.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  const projectOptions = useMemo(() => [...projects].sort((a, b) => a.name.localeCompare(b.name) || a.created_at.localeCompare(b.created_at)), [projects]);
  if (!receipts.length) return null;

  const assign = async (invoice: FinancialInvoice) => {
    const projectId = choices[invoice.id];
    if (!projectOptions.some(p => p.id === projectId)) return;
    setSaving(invoice.id);
    try {
      await db.assignPaidStripeReceipt(invoice.id, projectId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] }),
        qc.invalidateQueries({ queryKey: ["financialInvoices", projectId] }),
        qc.invalidateQueries({ queryKey: ["financialInvoices", "unattached"] }),
      ]);
      toast.success("Paid receipt assigned to the project");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign this receipt.");
    } finally { setSaving(null); }
  };

  return <section className="mb-10 border border-border p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="eyebrow mb-2">Paid receipts · {receipts.length}</div>
        <h2 className="font-display text-3xl">Awaiting project assignment</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">These payments are confirmed paid by Stripe. Choose a project to include each receipt in its Financials. Receipts stay internal.</p>
      </div>
      <div className="text-right"><div className="eyebrow mb-2">Unassigned paid total</div><div className="font-display text-3xl">{formatMoney(receipts.reduce((sum, row) => sum + row.receipt.amount, 0))}</div></div>
    </div>
    <label className="mt-5 block"><span className="sr-only">Search paid receipts</span>
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search client or receipt" className="h-11 w-full border border-border bg-background px-3 text-sm" />
    </label>
    <div className="mt-4 max-h-[560px] overflow-auto">
      {visible.map(({ invoice, receipt }) => <div key={invoice.id} className="grid gap-4 border-t border-border py-5 lg:grid-cols-[1fr_130px_320px]">
        <div><div className="text-xs text-muted-foreground">{invoice.invoice_date} · {invoice.client_name}</div>
          <h3 className="mt-1 font-display text-xl">{receipt.description}</h3>
          {receipt.receiptUrl && <a className="mt-2 inline-block text-sm underline underline-offset-4" href={receipt.receiptUrl} target="_blank" rel="noopener noreferrer">Original Stripe receipt ↗</a>}
        </div>
        <div><div className="text-xs uppercase tracking-wider text-emerald-800">Paid</div><div className="mt-1 font-display text-xl">{formatMoney(receipt.amount)}</div></div>
        <div className="flex items-start gap-2">
          <select aria-label={`Project for ${receipt.description}`} value={choices[invoice.id] || ""} onChange={event => setChoices(current => ({ ...current, [invoice.id]: event.target.value }))} className="h-11 min-w-0 flex-1 border border-border bg-background px-2 text-sm" disabled={saving !== null}>
            <option value="">Choose project</option>
            {projectOptions.map(project => <option key={project.id} value={project.id}>{project.name} · {project.client_name} · {project.created_at.slice(0, 10)}</option>)}
          </select>
          <button type="button" className="h-11 bg-ink px-4 text-sm text-primary-foreground disabled:opacity-40" disabled={!choices[invoice.id] || saving !== null} onClick={() => void assign(invoice)}>{saving === invoice.id ? "Saving…" : "Assign"}</button>
        </div>
      </div>)}
      {!visible.length && <p className="py-8 text-sm text-muted-foreground">No paid receipts match this search.</p>}
    </div>
  </section>;
}
