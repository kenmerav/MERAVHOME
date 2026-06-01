import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2 } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db, type EmployeeTimeEntry, type UserProfile } from "@/lib/db";
import { canLogHours, canManageHours } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/hours/")({
  head: () => ({ meta: [{ title: "Hours — MERAV Studio" }] }),
  component: HoursPage,
});

const PAID_THROUGH_OPTIONS = ["Zelle", "Venmo"];

function HoursPage() {
  const qc = useQueryClient();
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState("");
  const [taskProject, setTaskProject] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"unpaid" | "all" | "paid">("unpaid");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidThrough, setPaidThrough] = useState("Zelle");
  const [busy, setBusy] = useState(false);

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ["currentProfile"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) return null;
      return (await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle()).data as UserProfile | null;
    },
  });
  const canLog = canLogHours(profile);
  const canManage = canManageHours(profile);

  const { data: entries = [], isLoading: loadingEntries } = useQuery({
    queryKey: ["employeeTimeEntries"],
    queryFn: async () => (await db.listEmployeeTimeEntries()) ?? [],
    enabled: !!profile && canLog,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["hourUsers"],
    queryFn: async () =>
      ((await supabase.from("user_profiles").select("*").neq("role", "Client").eq("is_active", true).order("full_name")).data ?? []) as UserProfile[],
    enabled: canManage,
  });

  const visibleEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (!canManage && entry.user_id !== profile?.id) return false;
      if (canManage && employeeFilter === "all") return false;
      if (canManage && employeeFilter !== "all" && entry.user_id !== employeeFilter) return false;
      if (statusFilter === "paid" && !entry.paid) return false;
      if (statusFilter === "unpaid" && entry.paid) return false;
      return true;
    });
  }, [canManage, employeeFilter, entries, profile?.id, statusFilter]);

  const allSummary = useMemo(() => summarize(entries.filter((entry) => canManage || entry.user_id === profile?.id)), [canManage, entries, profile?.id]);
  const visibleSummary = useMemo(() => summarize(visibleEntries), [visibleEntries]);
  const selectedEmployee = canManage && employeeFilter !== "all" ? users.find((user) => user.id === employeeFilter) : null;
  const employeeSummaries = useMemo(() => {
    const byUser = new Map<string, { user: EmployeeTimeEntry["user"]; entries: EmployeeTimeEntry[] }>();
    entries.forEach((entry) => {
      if (!entry.user_id) return;
      const existing = byUser.get(entry.user_id) ?? { user: entry.user, entries: [] };
      existing.entries.push(entry);
      byUser.set(entry.user_id, existing);
    });
    return Array.from(byUser.entries())
      .map(([userId, group]) => ({ userId, user: group.user, ...summarize(group.entries) }))
      .sort((a, b) => (b.unpaidPay - a.unpaidPay) || (a.user?.full_name ?? "").localeCompare(b.user?.full_name ?? ""));
  }, [entries]);

  const submitEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !canLog) return toast.error("Clients cannot log hours.");
    const parsedHours = numberValue(hours);
    if (!workDate) return toast.error("Choose a date.");
    if (!parsedHours || parsedHours <= 0) return toast.error("Enter hours greater than 0.");
    if (!taskProject.trim()) return toast.error("Enter a task or project.");
    setBusy(true);
    try {
      await db.createEmployeeTimeEntry({
        user_id: profile.id,
        work_date: workDate,
        hours: parsedHours,
        task_project: taskProject.trim(),
        hourly_rate: Number(profile.hourly_rate || 0),
      });
      toast.success("Hours logged");
      setHours("");
      setTaskProject("");
      qc.invalidateQueries({ queryKey: ["employeeTimeEntries"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not log hours.");
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (targetEntries: EmployeeTimeEntry[]) => {
    if (!canManage) return toast.error("Only Ken and Katie can mark hours paid.");
    const unpaid = targetEntries.filter((entry) => !entry.paid);
    if (!unpaid.length) return toast.info("No unpaid entries in this view.");
    setBusy(true);
    try {
      await Promise.all(unpaid.map((entry) => db.updateEmployeeTimeEntry(entry.id, {
        paid: true,
        paid_on: paidOn,
        paid_through: paidThrough,
      })));
      toast.success("Marked paid");
      qc.invalidateQueries({ queryKey: ["employeeTimeEntries"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not mark paid.");
    } finally {
      setBusy(false);
    }
  };

  const togglePaid = async (entry: EmployeeTimeEntry) => {
    if (!canManage) return;
    setBusy(true);
    try {
      await db.updateEmployeeTimeEntry(entry.id, {
        paid: !entry.paid,
        paid_on: entry.paid ? null : paidOn,
        paid_through: entry.paid ? null : paidThrough,
      });
      qc.invalidateQueries({ queryKey: ["employeeTimeEntries"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not update paid status.");
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (entry: EmployeeTimeEntry) => {
    if (entry.paid && !canManage) return toast.error("Paid entries cannot be deleted.");
    if (!window.confirm("Delete this hour entry?")) return;
    setBusy(true);
    try {
      await db.deleteEmployeeTimeEntry(entry.id);
      toast.success("Hour entry deleted");
      qc.invalidateQueries({ queryKey: ["employeeTimeEntries"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not delete entry.");
    } finally {
      setBusy(false);
    }
  };

  if (loadingProfile) return <AppShell><div className="p-16 text-muted-foreground">Loading...</div></AppShell>;
  if (!canLog) {
    return (
      <AppShell>
        <div className="page-pad max-w-[900px]">
          <div className="eyebrow mb-3">Restricted</div>
          <h1 className="editorial-hero text-5xl lg:text-6xl">Hours</h1>
          <p className="mt-4 text-muted-foreground max-w-xl">Hours are available for MERAV team members only.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <div className="flex items-start justify-between gap-6 flex-wrap mb-10">
          <div>
            <div className="eyebrow mb-3">{canManage ? "Team Payroll" : "My Time"}</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">Hours</h1>
            <p className="mt-4 text-muted-foreground max-w-2xl">
              Log hours by date and project. Paid entries clear from the amount due while staying in year-to-date totals.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 w-full sm:w-auto">
            <SummaryBox label="Hours Due" value={formatHours(allSummary.unpaidHours)} />
            <SummaryBox label="Pay Due" value={formatMoney(allSummary.unpaidPay)} />
            <SummaryBox label="Total Hours" value={formatHours(allSummary.totalHours)} />
            <SummaryBox label="Total Income" value={formatMoney(allSummary.totalPay)} />
          </div>
        </div>

        <div className="grid xl:grid-cols-[360px_1fr] gap-8 items-start">
          <div className="space-y-6">
            <form onSubmit={submitEntry} className="border border-border bg-background p-6 space-y-5">
              <div>
                <div className="font-display text-2xl">Log Hours</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Your current rate is {formatMoney(Number(profile?.hourly_rate || 0))}/hr.
                </p>
              </div>
              <div>
                <Label className="eyebrow">Date</Label>
                <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} required />
              </div>
              <div>
                <Label className="eyebrow">Hours</Label>
                <Input value={hours} onChange={(e) => setHours(e.target.value)} required />
              </div>
              <div>
                <Label className="eyebrow">Task/Project</Label>
                <Input value={taskProject} onChange={(e) => setTaskProject(e.target.value)} required />
              </div>
              <button type="submit" disabled={busy} className="w-full bg-ink text-primary-foreground py-3 text-sm disabled:opacity-50">
                {busy ? "Saving..." : "Add Hours"}
              </button>
            </form>

            {canManage && (
              <section className="border border-border bg-bone/20 p-6 space-y-4">
                <div>
                  <div className="font-display text-2xl">Pay Run</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedEmployee ? `Mark ${selectedEmployee.full_name}'s currently filtered unpaid rows as paid.` : "Choose an employee before marking hours paid."}
                  </p>
                </div>
                <div>
                  <Label className="eyebrow">Paid On</Label>
                  <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                </div>
                <div>
                  <Label className="eyebrow">Paid Through</Label>
                  <select value={paidThrough} onChange={(e) => setPaidThrough(e.target.value)} className="h-10 w-full border border-input bg-background px-3 text-sm">
                    {PAID_THROUGH_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <button type="button" onClick={() => markPaid(visibleEntries)} disabled={busy || !selectedEmployee} className="w-full bg-ink text-primary-foreground py-3 text-sm disabled:opacity-50">
                  {selectedEmployee ? `Mark ${selectedEmployee.full_name} Paid` : "Select Employee to Pay"}
                </button>
              </section>
            )}
          </div>

          <div className="space-y-6">
            {canManage && (
              <section className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => setEmployeeFilter("all")}
                  className={`border p-4 text-left ${employeeFilter === "all" ? "border-ink bg-bone" : "border-border bg-background hover:border-ink"}`}
                >
                  <div className="font-display text-xl">Everyone</div>
                  <div className="text-xs text-muted-foreground mt-1">Team total, no detail rows</div>
                  <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                    <div><span className="eyebrow block">Due Hours</span>{formatHours(allSummary.unpaidHours)}</div>
                    <div><span className="eyebrow block">Due Pay</span>{formatMoney(allSummary.unpaidPay)}</div>
                  </div>
                </button>
                {employeeSummaries.map((summary) => (
                  <button
                    type="button"
                    key={summary.userId}
                    onClick={() => {
                      setEmployeeFilter(summary.userId);
                      setStatusFilter("unpaid");
                    }}
                    className={`border p-4 text-left ${employeeFilter === summary.userId ? "border-ink bg-bone" : "border-border bg-background hover:border-ink"}`}
                  >
                    <div className="font-display text-xl">{summary.user?.full_name ?? "Team Member"}</div>
                    <div className="text-xs text-muted-foreground mt-1">{summary.user?.email}</div>
                    <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                      <div><span className="eyebrow block">Due Hours</span>{formatHours(summary.unpaidHours)}</div>
                      <div><span className="eyebrow block">Due Pay</span>{formatMoney(summary.unpaidPay)}</div>
                    </div>
                  </button>
                ))}
              </section>
            )}

            <section className="border border-border bg-background">
              <div className="p-5 border-b border-border flex flex-col lg:flex-row lg:items-end gap-4 justify-between">
                <div>
                  <div className="eyebrow mb-2">{canManage ? (selectedEmployee ? `${selectedEmployee.full_name} Details` : "Everyone Total") : "My Entries"}</div>
                  <div className="font-display text-3xl">{formatMoney(canManage && !selectedEmployee ? allSummary.unpaidPay : visibleSummary.unpaidPay)} Due</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {canManage && !selectedEmployee
                      ? "Choose an employee above to see their detailed rows."
                      : `${formatHours(visibleSummary.unpaidHours)} unpaid hours in this view`}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  {canManage && (
                    <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className="h-10 border border-input bg-background px-3 text-sm">
                      <option value="all">Everyone total</option>
                      {users.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}
                    </select>
                  )}
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="h-10 border border-input bg-background px-3 text-sm">
                    <option value="unpaid">Unpaid</option>
                    <option value="all">All</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              </div>

              <div className="hidden lg:block">
                <table className="w-full text-sm table-fixed">
                  <thead>
                    <tr className="bg-bone/70 text-left text-[11px] uppercase tracking-[0.12em]">
                      {canManage && <th className="px-3 py-3 border-b border-border w-[15%]">Employee</th>}
                      <th className="px-3 py-3 border-b border-border w-[11%]">Date</th>
                      <th className="px-3 py-3 border-b border-border text-right w-[8%]">Hours</th>
                      <th className="px-3 py-3 border-b border-border">Task/Project</th>
                      <th className="px-3 py-3 border-b border-border text-right w-[10%]">Pay</th>
                      <th className="px-3 py-3 border-b border-border text-center w-[9%]">Paid</th>
                      <th className="px-3 py-3 border-b border-border w-[11%]">Paid On</th>
                      <th className="px-3 py-3 border-b border-border w-[10%]">Via</th>
                      <th className="px-3 py-3 border-b border-border w-[5%]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingEntries ? (
                      <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-12 text-center text-muted-foreground">Loading hours...</td></tr>
                    ) : canManage && !selectedEmployee ? (
                      <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">Select an employee to see their hour detail.</td></tr>
                    ) : visibleEntries.length === 0 ? (
                      <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-12 text-center text-muted-foreground">No hour entries in this view.</td></tr>
                    ) : visibleEntries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border">
                        {canManage && <td className="px-3 py-3 truncate">{entry.user?.full_name ?? "Team Member"}</td>}
                        <td className="px-3 py-3 whitespace-nowrap">{formatShortDate(entry.work_date)}</td>
                        <td className="px-3 py-3 text-right">{formatHours(Number(entry.hours || 0))}</td>
                        <td className="px-3 py-3 break-words">{entry.task_project}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">{formatMoney(entryPay(entry))}</td>
                        <td className="px-3 py-3 text-center">
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => togglePaid(entry)}
                              className={`inline-flex h-7 w-7 items-center justify-center border ${entry.paid ? "bg-ink text-white border-ink" : "border-border"}`}
                              aria-label={entry.paid ? "Mark unpaid" : "Mark paid"}
                            >
                              {entry.paid && <Check className="w-4 h-4" />}
                            </button>
                          ) : entry.paid ? "Yes" : "No"}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">{entry.paid_on ? formatShortDate(entry.paid_on) : ""}</td>
                        <td className="px-3 py-3 italic truncate">{formatPaidThrough(entry.paid_through)}</td>
                        <td className="px-3 py-3 text-right">
                          {(!entry.paid || canManage) && (
                            <button type="button" onClick={() => deleteEntry(entry)} className="text-muted-foreground hover:text-destructive" aria-label="Delete hour entry">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden divide-y divide-border">
                {loadingEntries ? (
                  <div className="px-5 py-12 text-center text-muted-foreground">Loading hours...</div>
                ) : canManage && !selectedEmployee ? (
                  <div className="px-5 py-12 text-center text-muted-foreground">Select an employee to see their hour detail.</div>
                ) : visibleEntries.length === 0 ? (
                  <div className="px-5 py-12 text-center text-muted-foreground">No hour entries in this view.</div>
                ) : visibleEntries.map((entry) => (
                  <article key={entry.id} className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        {canManage && <div className="eyebrow mb-1">{entry.user?.full_name ?? "Team Member"}</div>}
                        <div className="font-display text-2xl leading-tight">{formatDate(entry.work_date)}</div>
                        <p className="mt-1 text-sm text-muted-foreground break-words">{entry.task_project}</p>
                      </div>
                      {(!entry.paid || canManage) && (
                        <button type="button" onClick={() => deleteEntry(entry)} className="text-muted-foreground hover:text-destructive flex-shrink-0" aria-label="Delete hour entry">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <DetailStat label="Hours" value={formatHours(Number(entry.hours || 0))} />
                      <DetailStat label="Pay" value={formatMoney(entryPay(entry))} />
                      <DetailStat label="Paid On" value={entry.paid_on ? formatDate(entry.paid_on) : "—"} />
                      <DetailStat label="Via" value={formatPaidThrough(entry.paid_through) || "—"} />
                    </div>

                    <div className="flex items-center justify-between border border-border bg-bone/30 px-3 py-2">
                      <span className="eyebrow">Paid</span>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => togglePaid(entry)}
                          className={`inline-flex h-7 w-7 items-center justify-center border ${entry.paid ? "bg-ink text-white border-ink" : "border-border bg-background"}`}
                          aria-label={entry.paid ? "Mark unpaid" : "Mark paid"}
                        >
                          {entry.paid && <Check className="w-4 h-4" />}
                        </button>
                      ) : (
                        <span className="text-sm">{entry.paid ? "Yes" : "No"}</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-ink bg-background min-w-[150px] text-center">
      <div className="bg-bone border-b-2 border-ink px-4 py-2 font-bold">{label}</div>
      <div className="px-4 py-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-background p-3 min-w-0">
      <div className="eyebrow mb-1">{label}</div>
      <div className="truncate text-base">{value}</div>
    </div>
  );
}

function summarize(entries: EmployeeTimeEntry[]) {
  return entries.reduce((summary, entry) => {
    const hours = Number(entry.hours || 0);
    const pay = entryPay(entry);
    summary.totalHours += hours;
    summary.totalPay += pay;
    if (!entry.paid) {
      summary.unpaidHours += hours;
      summary.unpaidPay += pay;
    }
    return summary;
  }, { unpaidHours: 0, unpaidPay: 0, totalHours: 0, totalPay: 0 });
}

function entryPay(entry: EmployeeTimeEntry) {
  return Number(entry.hours || 0) * Number(entry.hourly_rate || 0);
}

function numberValue(value: string) {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatHours(value: number) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US");
}

function formatShortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

function formatPaidThrough(value: string | null) {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "zelle") return "Zelle";
  if (normalized === "venmo") return "Venmo";
  return value;
}
