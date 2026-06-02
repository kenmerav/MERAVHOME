import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { db, PROJECT_LABELS, type ProjectLabel } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { canViewFinancials } from "@/lib/permissions";
import { formatMoney, procurementTotals } from "@/lib/money";

export const Route = createFileRoute("/financials")({
  head: () => ({ meta: [{ title: "Financials — MERAV Studio" }] }),
  component: FinancialsOverviewPage,
});

type DateRangePreset = "all" | "ytd" | "q1" | "q2" | "q3" | "q4" | "last30" | "last60" | "last90";

const DATE_RANGE_OPTIONS: Array<{ value: DateRangePreset; label: string }> = [
  { value: "all", label: "All Time" },
  { value: "ytd", label: "YTD" },
  { value: "q1", label: "Q1" },
  { value: "q2", label: "Q2" },
  { value: "q3", label: "Q3" },
  { value: "q4", label: "Q4" },
  { value: "last30", label: "Last 30" },
  { value: "last60", label: "Last 60" },
  { value: "last90", label: "Last 90" },
];

function FinancialsOverviewPage() {
  const [dateRange, setDateRange] = useState<DateRangePreset>("ytd");
  const [selectedLabels, setSelectedLabels] = useState<ProjectLabel[]>([]);
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
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await db.listProjects()) ?? [],
    enabled: allowed,
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ["financialInvoices", "all"],
    queryFn: async () => (await db.listAllFinancialInvoices()) ?? [],
    enabled: allowed,
  });
  const { data: procurementItems = [] } = useQuery({
    queryKey: ["procurement"],
    queryFn: async () => (await db.listProcurement()) ?? [],
    enabled: allowed,
  });

  const selectedRange = useMemo(() => getDateRange(dateRange), [dateRange]);

  const rows = useMemo(() => {
    const filteredProjects = selectedLabels.length
      ? projects.filter((project) => project.project_label && selectedLabels.includes(project.project_label))
      : projects;

    return filteredProjects.map((project) => {
      const projectInvoices = invoices.filter((invoice) => invoice.project_id === project.id);
      const payments = projectInvoices.flatMap((invoice) =>
        (invoice.payments ?? []).filter((payment) => isInDateRange(payment.due_date || invoice.invoice_date || invoice.created_at, selectedRange)),
      );
      const paid = payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const due = payments.filter((payment) => payment.status !== "paid").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const revenue = paid + due;
      const procurement = procurementTotals(
        procurementItems.filter((item) => item.room_product?.room?.project?.id === project.id && isInDateRange(item.updated_at, selectedRange)),
        taxRate,
      );
      return {
        project,
        revenue,
        paid,
        due,
        procurementProfit: procurement.profit,
        totalProfit: revenue + procurement.profit,
        invoiceCount: projectInvoices.filter((invoice) => isInDateRange(invoice.invoice_date || invoice.created_at, selectedRange)).length,
      };
    }).sort((a, b) => b.totalProfit - a.totalProfit);
  }, [invoices, procurementItems, projects, selectedLabels, selectedRange, taxRate]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    revenue: sum.revenue + row.revenue,
    paid: sum.paid + row.paid,
    due: sum.due + row.due,
    procurementProfit: sum.procurementProfit + row.procurementProfit,
    totalProfit: sum.totalProfit + row.totalProfit,
  }), { revenue: 0, paid: 0, due: 0, procurementProfit: 0, totalProfit: 0 }), [rows]);

  const labelBreakdown = useMemo(() => {
    const activeLabels = selectedLabels.length ? selectedLabels : PROJECT_LABELS;
    return activeLabels.map((label) => {
      const labelRows = rows.filter((row) => row.project.project_label === label);
      const totalProfit = labelRows.reduce((sum, row) => sum + row.totalProfit, 0);
      const revenue = labelRows.reduce((sum, row) => sum + row.revenue, 0);
      return { label, projectCount: labelRows.length, revenue, totalProfit };
    });
  }, [rows, selectedLabels]);

  const toggleLabel = (label: ProjectLabel) => {
    setSelectedLabels((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  };

  if (loadingProfile) {
    return <AppShell><div className="p-16 text-muted-foreground">Checking access...</div></AppShell>;
  }

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
      <div className="page-pad max-w-[1600px]">
        <div className="mb-12">
          <div className="eyebrow mb-3">Studio</div>
          <h1 className="editorial-hero text-5xl lg:text-7xl">Financials</h1>
          <p className="mt-4 text-muted-foreground max-w-2xl">
            Revenue and profit across every project, combining invoice payment schedules with procurement profit.
          </p>
        </div>

        <div className="mb-8 grid gap-4 lg:grid-cols-[260px_1fr]">
          <div>
            <label className="eyebrow mb-2 block" htmlFor="financial-date-range">Date Range</label>
            <select
              id="financial-date-range"
              value={dateRange}
              onChange={(event) => setDateRange(event.target.value as DateRangePreset)}
              className="h-11 w-full border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ink"
            >
              {DATE_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="eyebrow">Project Type</div>
              {selectedLabels.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedLabels([])}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {PROJECT_LABELS.map((label) => {
                const active = selectedLabels.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleLabel(label)}
                    className={`h-11 border px-4 text-sm transition-colors ${
                      active ? "border-ink bg-ink text-primary-foreground" : "border-border bg-background text-ink hover:border-ink"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {selectedLabels.length ? `Showing ${selectedLabels.join(", ")}` : "Showing all project types"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-12">
          <MoneyStat label="Revenue" value={totals.revenue} />
          <MoneyStat label="Paid" value={totals.paid} />
          <MoneyStat label="Due" value={totals.due} />
          <MoneyStat label="Procurement Profit" value={totals.procurementProfit} />
          <MoneyStat label="Total Profit" value={totals.totalProfit} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {labelBreakdown.map((item) => (
            <div key={item.label} className="border border-border p-5 bg-bone/25">
              <div className="eyebrow mb-2">{item.label}</div>
              <div className="font-display text-3xl">{formatMoney(item.totalProfit)}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {item.projectCount} project{item.projectCount === 1 ? "" : "s"} · {formatMoney(item.revenue)} revenue
              </div>
            </div>
          ))}
        </div>

        <div className="mobile-card-scroll border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] tracking-[0.15em] uppercase text-muted-foreground border-b border-border bg-bone/30">
                <th className="px-4 py-3 min-w-[260px]">Project</th>
                <th className="px-4 py-3 min-w-[170px]">Label</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Due</th>
                <th className="px-4 py-3 text-right">Procurement Profit</th>
                <th className="px-4 py-3 text-right">Total Profit</th>
                <th className="px-4 py-3 text-center">Invoices</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-20 text-center text-sm text-muted-foreground">
                    No financial data yet. Upload project invoices to start tracking revenue.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.project.id} className="border-b border-border">
                  <td className="px-4 py-4">
                    <div className="font-display text-xl leading-tight">{row.project.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {row.project.client_name} · {row.project.status}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm text-muted-foreground">{row.project.project_label || "Unlabeled"}</td>
                  <td className="px-4 py-4 text-right">{formatMoney(row.revenue)}</td>
                  <td className="px-4 py-4 text-right">{formatMoney(row.paid)}</td>
                  <td className="px-4 py-4 text-right">{formatMoney(row.due)}</td>
                  <td className="px-4 py-4 text-right">{formatMoney(row.procurementProfit)}</td>
                  <td className="px-4 py-4 text-right font-medium text-ink">{formatMoney(row.totalProfit)}</td>
                  <td className="px-4 py-4 text-center font-display text-lg">{row.invoiceCount}</td>
                  <td className="px-4 py-4 text-right">
                    <Link to="/projects/$id/financials" params={{ id: row.project.id }} className="inline-flex items-center gap-2 text-xs hover:underline">
                      Open <ArrowRight className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function getDateRange(preset: DateRangePreset) {
  if (preset === "all") return null;

  const today = new Date();
  const year = today.getFullYear();
  const end = endOfDay(today);

  if (preset === "ytd") return { start: new Date(year, 0, 1), end };
  if (preset === "q1") return { start: new Date(year, 0, 1), end: endOfDay(new Date(year, 2, 31)) };
  if (preset === "q2") return { start: new Date(year, 3, 1), end: endOfDay(new Date(year, 5, 30)) };
  if (preset === "q3") return { start: new Date(year, 6, 1), end: endOfDay(new Date(year, 8, 30)) };
  if (preset === "q4") return { start: new Date(year, 9, 1), end: endOfDay(new Date(year, 11, 31)) };

  const days = preset === "last30" ? 30 : preset === "last60" ? 60 : 90;
  const start = new Date(today);
  start.setDate(today.getDate() - days);
  return { start: startOfDay(start), end };
}

function isInDateRange(value: string | null | undefined, range: ReturnType<typeof getDateRange>) {
  if (!range) return true;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= range.start && date <= range.end;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function MoneyStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border p-5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="font-display text-3xl">{formatMoney(value)}</div>
    </div>
  );
}
