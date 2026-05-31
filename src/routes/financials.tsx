import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { db } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { canViewFinancials } from "@/lib/permissions";
import { formatMoney, procurementTotals } from "@/lib/money";

export const Route = createFileRoute("/financials")({
  head: () => ({ meta: [{ title: "Financials — MERAV Studio" }] }),
  component: FinancialsOverviewPage,
});

function FinancialsOverviewPage() {
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

  const rows = useMemo(() => {
    return projects.map((project) => {
      const projectInvoices = invoices.filter((invoice) => invoice.project_id === project.id);
      const payments = projectInvoices.flatMap((invoice) => invoice.payments ?? []);
      const paid = payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const due = payments.filter((payment) => payment.status !== "paid").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const revenue = paid + due;
      const procurement = procurementTotals(
        procurementItems.filter((item) => item.room_product?.room?.project?.id === project.id),
        taxRate,
      );
      return {
        project,
        revenue,
        paid,
        due,
        procurementProfit: procurement.profit,
        totalProfit: revenue + procurement.profit,
        invoiceCount: projectInvoices.length,
      };
    }).sort((a, b) => b.totalProfit - a.totalProfit);
  }, [invoices, procurementItems, projects, taxRate]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    revenue: sum.revenue + row.revenue,
    paid: sum.paid + row.paid,
    due: sum.due + row.due,
    procurementProfit: sum.procurementProfit + row.procurementProfit,
    totalProfit: sum.totalProfit + row.totalProfit,
  }), { revenue: 0, paid: 0, due: 0, procurementProfit: 0, totalProfit: 0 }), [rows]);

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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-12">
          <MoneyStat label="Revenue" value={totals.revenue} />
          <MoneyStat label="Paid" value={totals.paid} />
          <MoneyStat label="Due" value={totals.due} />
          <MoneyStat label="Procurement Profit" value={totals.procurementProfit} />
          <MoneyStat label="Total Profit" value={totals.totalProfit} />
        </div>

        <div className="mobile-card-scroll border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] tracking-[0.15em] uppercase text-muted-foreground border-b border-border bg-bone/30">
                <th className="px-4 py-3 min-w-[260px]">Project</th>
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
                  <td colSpan={8} className="py-20 text-center text-sm text-muted-foreground">
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

function MoneyStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border p-5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="font-display text-3xl">{formatMoney(value)}</div>
    </div>
  );
}
