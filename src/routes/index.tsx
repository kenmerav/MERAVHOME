import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, CheckCircle2, FileText, Plus, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { db, type ApprovalStatus, type FinancialInvoice, type Project, type ProjectTimeline, type Room, type RoomProduct } from "@/lib/db";
import { resolveImage } from "@/lib/local-assets";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PRESET_ROOMS, templateForRoomName } from "@/lib/roomTemplates";
import { buildClientProductName } from "@/lib/clientProductName";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { canViewFinancials, isStudioTeamRole } from "@/lib/permissions";
import { ServiceInvoiceCreator } from "@/components/ServiceInvoiceCreator";
import { TimelineCreator } from "@/components/TimelineCreator";
import { formatMoney } from "@/lib/money";
import { downloadInvoiceDocument, openInvoiceDocument } from "@/lib/invoiceDocuments";

type SharedDashboard = {
  projects: Array<{
    id: string;
    name: string;
    client_name: string;
    status: string;
    cover_image_url: string | null;
    access: {
      specBook: boolean;
      presentations: boolean;
      designBoards: boolean;
      constructionDocs: boolean;
      approvals: boolean;
    };
  }>;
  invoices: Array<{
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
  }>;
  timelines: Array<{
    id: string;
    project_id: string;
    project_name: string;
    title: string;
    timeline_date: string | null;
    html_data_url: string | null;
  }>;
  todos: Array<{
    id: string;
    kind: "invoice" | "approval" | "project_todo";
    title: string;
    project_id: string;
    project_name: string;
    amount?: number;
    due_date?: string | null;
    reminder_date?: string | null;
    notes?: string | null;
    todo_id?: string;
    invoice_id?: string;
    payment_url?: string | null;
    href?: string;
  }>;
};

type StudioReminder = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  project_client_name: string | null;
  title: string;
  notes: string | null;
  due_date: string | null;
  reminder_date: string | null;
  status: "open" | "complete";
  priority: "low" | "normal" | "high";
  assigned_to: "ken" | "katie" | "studio";
  created_at: string;
  completed_at: string | null;
};

type AssignedTodo = {
  id: string;
  project_id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  reminder_date: string | null;
  status: "open" | "complete";
  priority: "low" | "normal" | "high";
  created_at: string;
  project: {
    id: string;
    name: string;
    client_name: string | null;
  } | null;
};


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — MERAV Studio" },
      { name: "description", content: "Active projects, statuses, and quick access for MERAV Interiors." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const qc = useQueryClient();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await db.listProjects()) ?? [],
  });
  const { data: profile } = useQuery({
    queryKey: ["currentProfile"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) return null;
      return (await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle()).data;
    },
  });
  const canCreateInvoices = canViewFinancials(profile);
  const activeProjects = projects.filter((p) => p.status !== "Complete");
  const isClientUser = profile?.role === "Client";
  const isSharedUser = profile?.role === "Client" || profile?.role === "Contractor";
  const { data: sharedDashboard, isLoading: sharedDashboardLoading } = useQuery({
    queryKey: ["clientDashboard", profile?.id],
    enabled: isSharedUser,
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in to view your dashboard.");
      const res = await fetch("/api/client-dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not load dashboard.");
      return body as SharedDashboard;
    },
  });
  const { data: clientApprovalSummaries = [] } = useQuery({
    queryKey: ["clientApprovalSummaries", activeProjects.map((project) => project.id)],
    enabled: isClientUser && activeProjects.length > 0,
    queryFn: async () => {
      const summaries = await Promise.all(
        activeProjects.map(async (project) => {
          const rooms = ((await db.listRooms(project.id)) ?? []).filter((room) => room.approval_visible !== false);
          const roomSelections = await Promise.all(
            rooms.map(async (room) => ({
              room,
              items: ((await db.listRoomProducts(room.id)) ?? []).filter((item) => item.approval_visible !== false),
            })),
          );

          const counts = roomSelections.flatMap(({ items }) => items).reduce(
            (acc, item) => {
              const status = getApprovalStatus(item);
              acc[status] += 1;
              return acc;
            },
            { undecided: 0, approved: 0, declined: 0 } as Record<ApprovalStatus, number>,
          );

          return {
            project,
            roomCount: rooms.length,
            itemCount: counts.undecided + counts.approved + counts.declined,
            needReviewCount: counts.undecided,
            approvedCount: counts.approved,
            changesCount: counts.declined,
            live: project.approval_live === true,
          };
        }),
      );

      return summaries.filter((summary) => summary.itemCount > 0 && summary.live);
    },
  });
  const approvalsReady = clientApprovalSummaries.filter((summary) => summary.needReviewCount > 0);

  return (
    <AppShell>
      <div className="page-pad max-w-[1500px]">
        <div className="flex items-end justify-between mb-12 lg:mb-16 flex-wrap gap-6">
          <div>
            <div className="eyebrow mb-3">{isClientUser ? "Client Portal" : "The Studio"}</div>
            <h1 className="editorial-hero text-5xl lg:text-7xl">{isSharedUser ? "Your Projects" : "Active Projects"}</h1>
            <p className="mt-4 text-muted-foreground max-w-xl">
              {isSharedUser
                ? "Review what MERAV Studio has shared with you, including invoices, timelines, approvals, and project documents."
                : "Every selection lives here once. Use it for presentations, spec books, and procurement."}
            </p>
          </div>
          {!isSharedUser && <NewProjectDialog />}
        </div>

        {isSharedUser && (
          <SharedDashboardOverview
            dashboard={sharedDashboard}
            loading={sharedDashboardLoading}
            isClientUser={isClientUser}
          />
        )}

        {profile?.is_active === true && isStudioTeamRole(profile.role) && !isSharedUser && (
          <MyAssignedTodosPanel profileId={profile.id} />
        )}

        {canCreateInvoices && !isSharedUser && (
          <StudioRemindersPanel projects={activeProjects} />
        )}

        {canCreateInvoices && !isSharedUser && (
          <section className="border border-border bg-bone/20 p-6 mb-12">
            <div className="space-y-5">
              <div>
                <div className="eyebrow mb-2">Service Documents</div>
                <h2 className="font-display text-3xl">Pre-project builders</h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                  Create the invoice and timeline before the client officially becomes a project. When they accept or pay, create the project and attach the saved documents.
                </p>
              </div>
              <div className="flex w-full flex-col gap-3">
                <ServiceInvoiceCreator onSaved={() => qc.invalidateQueries({ queryKey: ["financialInvoices", "unattached"] })} />
                <TimelineCreator onSaved={() => qc.invalidateQueries({ queryKey: ["projectTimelines", "unattached"] })} />
              </div>
            </div>
          </section>
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : activeProjects.length === 0 ? (
          <EmptyState isClientUser={isSharedUser} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-14">
            {activeProjects.map((p) => {
              const approvalSummary = clientApprovalSummaries.find((summary) => summary.project.id === p.id);
              return <ProjectCard key={p.id} p={p} isClientUser={isClientUser} approvalSummary={approvalSummary} />;
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function MyAssignedTodosPanel({ profileId }: { profileId: string }) {
  const qc = useQueryClient();
  const [completingId, setCompletingId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["myAssignedTodos", profileId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in to view assigned to-dos.");
      const res = await fetch("/api/my-todos", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not load assigned to-dos.");
      return body as { todos: AssignedTodo[]; setupNeeded?: boolean };
    },
    refetchOnWindowFocus: true,
  });

  const todos = data?.todos ?? [];

  const completeTodo = async (todoId: string) => {
    setCompletingId(todoId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/project-todos", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: todoId, status: "complete" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not complete to-do.");
      toast.success("To-do completed");
      qc.invalidateQueries({ queryKey: ["myAssignedTodos", profileId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete to-do.");
    } finally {
      setCompletingId(null);
    }
  };

  if (data?.setupNeeded) {
    return (
      <section className="border border-dashed border-border bg-bone/20 p-5 mb-8 text-sm text-muted-foreground">
        Assigned to-dos are ready in Studio, but the Supabase to-do table still needs to be applied.
      </section>
    );
  }

  if (!isLoading && todos.length === 0) return null;

  return (
    <section className="border border-border bg-background p-6 mb-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Assigned To You</div>
            <h2 className="font-display text-3xl">To-do list</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Design board comments that tag you will appear here.
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {isLoading ? "Loading" : `${todos.length} open`}
          </div>
        </div>

        {isLoading ? (
          <div className="border border-border bg-bone/20 p-4 text-sm text-muted-foreground">
            Loading assigned to-dos…
          </div>
        ) : (
          <div className="divide-y divide-border border border-border">
            {todos.map((todo) => {
              const href = todoBoardHref(todo);
              const note = todoPrimaryNote(todo);
              return (
                <div key={todo.id} className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${todoTone(todo).className}`}>
                          {todoTone(todo).label}
                        </span>
                        {todo.priority === "high" && (
                          <span className="rounded-full bg-[#f8e6df] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[#8b2b15]">
                            High
                          </span>
                        )}
                      </div>
                      <div className="mt-2 font-medium">{todo.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {todo.project?.name || "Project"}
                        {todo.due_date ? ` - Due ${formatDashboardDate(todo.due_date)}` : ""}
                        {todo.reminder_date ? ` - Reminder ${formatDashboardDate(todo.reminder_date)}` : ""}
                      </div>
                      {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link to={href as any} className="inline-flex items-center justify-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink">
                        {todoIsDesignBoardComment(todo) ? "Open Comment" : "Open Board"} <ArrowRight className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => completeTodo(todo.id)}
                        disabled={completingId === todo.id}
                        className="inline-flex items-center justify-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {completingId === todo.id ? "Saving..." : "Mark Done"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function StudioRemindersPanel({ projects }: { projects: Project[] }) {
  const qc = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [assignedTo, setAssignedTo] = useState<StudioReminder["assigned_to"]>("studio");
  const [priority, setPriority] = useState<StudioReminder["priority"]>("normal");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["studioReminders"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in as Ken or Katie to load reminders.");
      const res = await fetch("/api/studio-reminders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not load reminders.");
      return body as { reminders: StudioReminder[]; setupNeeded?: boolean };
    },
  });

  const reminders = data?.reminders ?? [];
  const openReminders = reminders
    .filter((reminder) => reminder.status !== "complete")
    .sort(compareStudioReminders);
  const completedReminders = reminders
    .filter((reminder) => reminder.status === "complete")
    .slice(0, 3);

  const createReminder = async () => {
    if (!title.trim()) return toast.error("Add a reminder title first.");
    setBusy(true);
    try {
      await reminderRequest("POST", {
        title,
        project_id: projectId || null,
        due_date: dueDate || null,
        reminder_date: reminderDate || null,
        assigned_to: assignedTo,
        priority,
        notes,
      });
      setTitle("");
      setProjectId("");
      setDueDate("");
      setReminderDate("");
      setAssignedTo("studio");
      setPriority("normal");
      setNotes("");
      setIsAddDialogOpen(false);
      toast.success("Reminder added");
      qc.invalidateQueries({ queryKey: ["studioReminders"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add reminder.");
    } finally {
      setBusy(false);
    }
  };

  const updateReminder = async (id: string, updates: Partial<StudioReminder>) => {
    try {
      await reminderRequest("PATCH", { id, ...updates });
      qc.invalidateQueries({ queryKey: ["studioReminders"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update reminder.");
    }
  };

  const deleteReminder = async (id: string) => {
    try {
      await reminderRequest("DELETE", null, id);
      toast.success("Reminder removed");
      qc.invalidateQueries({ queryKey: ["studioReminders"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete reminder.");
    }
  };

  return (
    <section className="border border-border bg-background p-6 mb-12">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Internal Follow-Up</div>
            <h2 className="font-display text-3xl">Studio reminders</h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
              Ken/Katie-only reminders for due dates, follow-ups, and project items that should not fall through the cracks.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {openReminders.length} open
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <button type="button" className="inline-flex items-center justify-center gap-2 bg-ink px-5 py-2.5 text-sm text-primary-foreground">
                  <Plus className="h-4 w-4" /> Add Reminder
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle className="font-display text-3xl">Add Reminder</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2 space-y-1.5">
                    <Label className="eyebrow">Reminder</Label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up on cabinet quote" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="eyebrow">Project</Label>
                    <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-10 w-full border border-input bg-background px-3 text-sm">
                      <option value="">No project / general</option>
                      {projects
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="eyebrow">Assigned To</Label>
                    <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value as StudioReminder["assigned_to"])} className="h-10 w-full border border-input bg-background px-3 text-sm">
                      <option value="studio">Ken + Katie</option>
                      <option value="ken">Ken</option>
                      <option value="katie">Katie</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="eyebrow">Due Date</Label>
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="eyebrow">Reminder Date</Label>
                    <Input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="eyebrow">Priority</Label>
                    <select value={priority} onChange={(e) => setPriority(e.target.value as StudioReminder["priority"])} className="h-10 w-full border border-input bg-background px-3 text-sm">
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                  <div className="md:col-span-2 space-y-1.5">
                    <Label className="eyebrow">Notes</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional context, phone number, vendor note, etc." />
                  </div>
                </div>
                <button type="button" onClick={createReminder} disabled={busy || data?.setupNeeded} className="mt-2 inline-flex items-center justify-center gap-2 bg-ink px-5 py-2.5 text-sm text-primary-foreground disabled:opacity-50">
                  <Plus className="h-4 w-4" /> {busy ? "Adding..." : "Add Reminder"}
                </button>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {data?.setupNeeded ? (
          <div className="border border-dashed border-border bg-bone/30 p-4 text-sm text-muted-foreground">
            Reminder storage is ready in the app, but the Supabase migration still needs to be applied before reminders can save.
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6">
          <div className="border border-border bg-background">
            <div className="border-b border-border px-4 py-3">
              <div className="eyebrow">Open Items</div>
            </div>
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading reminders…</div>
            ) : openReminders.length === 0 ? (
              <div className="p-4">
                <p className="font-display text-2xl">Nothing due right now.</p>
                <p className="mt-1 text-sm text-muted-foreground">A rare and beautiful creature. Let’s protect it.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {openReminders.map((reminder) => (
                  <ReminderRow
                    key={reminder.id}
                    reminder={reminder}
                    onComplete={() => updateReminder(reminder.id, { status: "complete" })}
                    onDelete={() => deleteReminder(reminder.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {completedReminders.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="eyebrow mb-3">Recently Completed</div>
            <div className="flex flex-wrap gap-2">
              {completedReminders.map((reminder) => (
                <button
                  key={reminder.id}
                  type="button"
                  onClick={() => updateReminder(reminder.id, { status: "open" })}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-ink hover:text-ink"
                >
                  Reopen: {reminder.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ReminderRow({
  reminder,
  onComplete,
  onDelete,
}: {
  reminder: StudioReminder;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const tone = reminderTone(reminder);
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${tone.className}`}>
              {tone.label}
            </span>
            {reminder.priority === "high" && (
              <span className="rounded-full bg-[#f8e6df] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[#8b2b15]">
                High
              </span>
            )}
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {assigneeLabel(reminder.assigned_to)}
            </span>
          </div>
          <div className="mt-2 font-medium">{reminder.title}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {reminder.project_name || "General reminder"}
            {reminder.due_date ? ` - Due ${formatDashboardDate(reminder.due_date)}` : ""}
            {reminder.reminder_date ? ` - Reminder ${formatDashboardDate(reminder.reminder_date)}` : ""}
          </div>
          {reminder.notes && <p className="mt-2 text-sm text-muted-foreground">{reminder.notes}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onComplete} className="inline-flex h-9 w-9 items-center justify-center border border-border hover:border-ink" aria-label="Mark reminder complete">
            <CheckCircle2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDelete} className="inline-flex h-9 w-9 items-center justify-center border border-border text-red-600 hover:border-red-300" aria-label="Delete reminder">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

async function reminderRequest(method: "POST" | "PATCH" | "DELETE", body?: unknown, id?: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign in as Ken or Katie first.");
  const url = id ? `/api/studio-reminders?id=${encodeURIComponent(id)}` : "/api/studio-reminders";
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Reminder request failed.");
  return data;
}

function compareStudioReminders(a: StudioReminder, b: StudioReminder) {
  const aDate = a.due_date || a.reminder_date || "9999-12-31";
  const bDate = b.due_date || b.reminder_date || "9999-12-31";
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  const priorityRank = { high: 0, normal: 1, low: 2 };
  if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
  return a.created_at.localeCompare(b.created_at);
}

function reminderTone(reminder: StudioReminder) {
  const today = todayString();
  if (reminder.due_date && reminder.due_date < today) {
    return { label: "Overdue", className: "bg-[#f8e6df] text-[#8b2b15]" };
  }
  if (reminder.due_date === today) {
    return { label: "Due Today", className: "bg-[#f1e3c8] text-ink" };
  }
  if (reminder.reminder_date && reminder.reminder_date <= today) {
    return { label: "Reminder", className: "bg-[#e8efe6] text-ink" };
  }
  return { label: "Upcoming", className: "bg-bone text-muted-foreground" };
}

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assigneeLabel(value: StudioReminder["assigned_to"]) {
  if (value === "ken") return "Ken";
  if (value === "katie") return "Katie";
  return "Ken + Katie";
}

function SharedDashboardOverview({
  dashboard,
  loading,
  isClientUser,
}: {
  dashboard?: SharedDashboard;
  loading: boolean;
  isClientUser: boolean;
}) {
  if (loading) {
    return (
      <section className="mb-12 border border-border bg-bone/20 p-6 text-sm text-muted-foreground">
        Loading shared dashboard…
      </section>
    );
  }

  const todos = dashboard?.todos ?? [];
  const invoices = dashboard?.invoices ?? [];
  const timelines = dashboard?.timelines ?? [];
  const sharedProjects = dashboard?.projects ?? [];

  return (
    <section className="mb-12 space-y-8">
      <div className={`grid grid-cols-1 gap-6 ${isClientUser ? "" : "xl:grid-cols-[1.05fr_0.95fr]"}`}>
        {!isClientUser && <div className="border border-border bg-background p-6 lg:p-8">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <div className="eyebrow mb-2">To Do</div>
              <h2 className="font-display text-3xl">Needs review</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Invoices that are due and selections waiting for approval will show up here.
              </p>
            </div>
          </div>
          {todos.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border bg-bone/20 p-6">
              <p className="font-display text-2xl">Nothing needs review right now.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                When a payment is due or selections are ready, they’ll appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {todos.slice(0, 8).map((todo) => (
                <div key={todo.id} className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-bone px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {todo.kind === "invoice" ? "Invoice Due" : todo.kind === "approval" ? "Approval" : "To-Do"}
                      </span>
                      <div className="font-medium">{todo.title}</div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {todo.project_name}
                      {todo.amount != null ? ` - ${formatMoney(todo.amount)}` : ""}
                      {todo.due_date ? ` - Due ${formatDashboardDate(todo.due_date)}` : ""}
                      {todo.reminder_date ? ` - Reminder ${formatDashboardDate(todo.reminder_date)}` : ""}
                    </div>
                    {todo.notes && <p className="mt-2 text-sm text-muted-foreground">{todo.notes}</p>}
                  </div>
                  {todo.kind === "approval" && todo.href ? (
                    <Link to={todo.href as any} className="inline-flex items-center gap-2 text-sm border border-border px-4 py-2 hover:border-ink">
                      Review <ArrowRight className="h-4 w-4" />
                    </Link>
                  ) : todo.kind === "project_todo" ? (
                    <CompleteSharedTodoButton todoId={todo.todo_id} />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {todo.payment_url ? (
                        <a
                          href={todo.payment_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 text-sm border border-ink bg-ink px-4 py-2 text-white hover:bg-ink/90"
                        >
                          Pay online <ArrowRight className="h-4 w-4" />
                        </a>
                      ) : null}
                      <Link
                        to="/client/financials"
                        search={todo.project_id ? { project: todo.project_id } : undefined}
                        className="inline-flex items-center gap-2 text-sm border border-border px-4 py-2 hover:border-ink"
                      >
                        View invoice <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>}

        <div className="border border-border bg-bone/20 p-6 lg:p-8">
          <div className="eyebrow mb-2">Shared Projects</div>
          <h2 className="font-display text-3xl mb-5">Quick links</h2>
          {sharedProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shared project links yet.</p>
          ) : (
            <div className="space-y-4">
              {sharedProjects.map((project) => (
                <div key={project.id} className="border border-border bg-background p-4">
                  <div className="font-display text-2xl">{project.name}</div>
                  <div className="text-sm text-muted-foreground mb-3">{project.client_name}</div>
                  <div className="flex flex-wrap gap-2">
                    {project.access.approvals && (
                      <Link to="/client/approvals/$projectId" params={{ projectId: project.id }} className="text-xs border border-border px-3 py-1.5 hover:border-ink">
                        Approvals
                      </Link>
                    )}
                    {project.access.presentations && (
                      <Link to="/presentations/$id" params={{ id: project.id }} className="text-xs border border-border px-3 py-1.5 hover:border-ink">
                        Presentation
                      </Link>
                    )}
                    {project.access.specBook && (
                      <Link to="/specbooks/$id" params={{ id: project.id }} className="text-xs border border-border px-3 py-1.5 hover:border-ink">
                        Spec Book
                      </Link>
                    )}
                    {isClientUser && (
                      <Link
                        to="/client/financials"
                        search={{ project: project.id }}
                        className="text-xs border border-border px-3 py-1.5 hover:border-ink"
                      >
                        Invoices
                      </Link>
                    )}
                    {project.access.designBoards && (
                      <Link to="/projects/$id/design-boards" params={{ id: project.id }} className="text-xs border border-border px-3 py-1.5 hover:border-ink">
                        Design Boards
                      </Link>
                    )}
                    {project.access.constructionDocs && (
                      <Link to="/projects/$id/construction-docs" params={{ id: project.id }} className="text-xs border border-border px-3 py-1.5 hover:border-ink">
                        Construction Docs
                      </Link>
                    )}
                    {timelines.some((timeline) => timeline.project_id === project.id) && (
                      <span className="text-xs border border-border px-3 py-1.5 text-muted-foreground">
                        Timeline shared
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CompleteSharedTodoButton({ todoId }: { todoId?: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState("");
  const { data: discussion, isLoading: loadingDiscussion } = useQuery({
    queryKey: ["sharedTodoMessages", todoId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`/api/project-todos?taskId=${encodeURIComponent(todoId || "")}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not load replies.");
      return body as { messages: Array<{ id: string; body: string; created_at: string; author?: { full_name?: string; email?: string } }> };
    },
    enabled: replyOpen && Boolean(todoId),
  });

  const complete = async () => {
    if (!todoId) return;
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/project-todos", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: todoId, status: "complete" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not complete to-do.");
      toast.success("Sent to Studio for review");
      qc.invalidateQueries({ queryKey: ["clientDashboard"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete to-do.");
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!todoId || !reply.trim()) return;
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/project-todos", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "message", todo_id: todoId, message: reply }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not send reply.");
      setReply("");
      qc.invalidateQueries({ queryKey: ["sharedTodoMessages", todoId] });
      toast.success("Reply sent to Studio");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send reply.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setReplyOpen(true)}
        disabled={!todoId}
        className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink disabled:opacity-50"
      >
        Reply
      </button>
      <button
        type="button"
        onClick={complete}
        disabled={busy || !todoId}
        className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink disabled:opacity-50"
      >
        <CheckCircle2 className="h-4 w-4" />
        {busy ? "Sending..." : "Mark Ready"}
      </button>
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-3xl">Task Replies</DialogTitle></DialogHeader>
          <div className="space-y-2 border-y border-border py-4">
            {loadingDiscussion ? <p className="text-sm text-muted-foreground">Loading replies...</p> : discussion?.messages.length ? discussion.messages.map((message) => (
              <div key={message.id} className="border border-border bg-bone/20 p-3 text-sm">
                <div className="mb-1 text-xs text-muted-foreground">{message.author?.full_name || message.author?.email || "Studio"}</div>
                {message.body}
              </div>
            )) : <p className="text-sm text-muted-foreground">No replies yet.</p>}
          </div>
          <Textarea rows={3} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Add a question or update..." />
          <button type="button" disabled={busy || !reply.trim()} onClick={sendReply} className="bg-ink px-4 py-2.5 text-sm text-white disabled:opacity-50">{busy ? "Sending..." : "Send Reply"}</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClientInvoiceActions({ documentUrl, fileName }: { documentUrl: string | null; fileName?: string | null }) {
  const open = async () => {
    try {
      await openInvoiceDocument(documentUrl, fileName);
    } catch {
      toast.error("Could not open invoice.");
    }
  };

  const download = async () => {
    try {
      await downloadInvoiceDocument(documentUrl, fileName);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download invoice.");
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={open} className="inline-flex items-center justify-center gap-2 border border-border px-4 py-2 text-sm hover:border-ink">
        <FileText className="h-4 w-4" /> View
      </button>
      <button type="button" onClick={download} className="inline-flex items-center justify-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-primary-foreground">
        <FileText className="h-4 w-4" /> Download PDF
      </button>
    </div>
  );
}

function todoBoardHref(todo: AssignedTodo) {
  const commentLine = todo.notes
    ?.split("\n")
    .find((line) => line.trim().toLowerCase().startsWith("open comment:"));
  if (commentLine) return commentLine.replace(/open comment:/i, "").trim();
  const boardLine = todo.notes
    ?.split("\n")
    .find((line) => line.trim().toLowerCase().startsWith("open board:"));
  return boardLine?.replace(/open board:/i, "").trim() || `/projects/${todo.project_id}/design-boards`;
}

function todoPrimaryNote(todo: AssignedTodo) {
  return todo.notes?.split("\n").find((line) => line.trim().length > 0) ?? null;
}

function todoIsDesignBoardComment(todo: AssignedTodo) {
  return (
    todo.title.toLowerCase().startsWith("design board comment:") ||
    Boolean(todo.notes?.toLowerCase().includes("open comment:"))
  );
}

function todoTone(todo: AssignedTodo) {
  const today = todayString();
  if (todo.due_date && todo.due_date < today) {
    return { label: "Overdue", className: "bg-[#f8e6df] text-[#8b2b15]" };
  }
  if (todo.due_date === today) {
    return { label: "Due Today", className: "bg-[#f1e3c8] text-ink" };
  }
  if (todo.reminder_date && todo.reminder_date <= today) {
    return { label: "Reminder", className: "bg-[#e8efe6] text-ink" };
  }
  return { label: "Open", className: "bg-bone text-muted-foreground" };
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

function ProjectCard({
  p,
  isClientUser,
  approvalSummary,
}: {
  p: Project;
  isClientUser: boolean;
  approvalSummary?: {
    project: Project;
    roomCount: number;
    itemCount: number;
    needReviewCount: number;
    approvedCount: number;
    changesCount: number;
  };
}) {
  const projectLink = isClientUser && approvalSummary ? "/client/approvals/$projectId" : "/projects/$id";
  const projectParams = isClientUser && approvalSummary ? { projectId: p.id } : { id: p.id };

  return (
    <Link to={projectLink as any} params={projectParams as any} className="group block">
      <div className="aspect-[4/5] bg-bone overflow-hidden mb-5">
        {p.cover_image_url ? (
          <img
            src={resolveImage(p.cover_image_url)}
            alt={p.name}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground font-display text-2xl">
            {p.name.charAt(0)}
          </div>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow mb-1.5">{p.project_label || p.project_type}</div>
          <h3 className="font-display text-2xl leading-tight truncate">{p.name}</h3>
          <p className="text-sm text-muted-foreground mt-1">{p.client_name}</p>
          {isClientUser && approvalSummary && (
            <div className="mt-3 flex flex-wrap gap-2">
              {approvalSummary.needReviewCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f1e3c8] px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-ink">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {approvalSummary.needReviewCount} Need Review
                </span>
              )}
              {approvalSummary.needReviewCount === 0 && approvalSummary.itemCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8efe6] px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-ink">
                  All Reviewed
                </span>
              )}
            </div>
          )}
        </div>
        <StatusBadge status={p.status} />
      </div>
    </Link>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.18em] uppercase text-muted-foreground whitespace-nowrap">
      <span className="w-1 h-1 rounded-full bg-brass" />
      {status}
    </span>
  );
}

function EmptyState({ isClientUser }: { isClientUser: boolean }) {
  return (
    <div className="border border-dashed border-border py-24 text-center">
      <div className="eyebrow mb-4">{isClientUser ? "No projects assigned" : "No projects yet"}</div>
      <p className="font-display text-3xl mb-6">{isClientUser ? "Projects shared with you will appear here" : "Begin with your first project"}</p>
      {!isClientUser && <NewProjectDialog />}
    </div>
  );
}

function getApprovalStatus(item: Pick<RoomProduct, "approval_status" | "approved">): ApprovalStatus {
  return item.approval_status ?? (item.approved ? "approved" : "undecided");
}

export function NewProjectDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [others, setOthers] = useState<string[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [timelineId, setTimelineId] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: unattachedInvoices = [] } = useQuery({
    queryKey: ["financialInvoices", "unattached"],
    queryFn: async () => (await db.listUnattachedFinancialInvoices()) ?? [],
    enabled: open,
  });
  const { data: unattachedTimelines = [] } = useQuery({
    queryKey: ["projectTimelines", "unattached"],
    queryFn: async () => (await db.listUnattachedProjectTimelines()) ?? [],
    enabled: open,
  });

  const toggle = (r: string) =>
    setSelected(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);

  const reset = () => {
    setName(""); setClient(""); setNotes(""); setSelected([]); setOthers([]); setInvoiceId(""); setTimelineId("");
  };

  const submit = async () => {
    if (!name.trim() || !client.trim()) return toast.error("Project name and client are required");
    const roomNames = [...selected, ...others.map(o => o.trim()).filter(Boolean)];
    if (roomNames.length === 0) return toast.error("Select at least one room");

    setBusy(true);
    try {
      const p = await db.createProject({
        name: name.trim(),
        client_name: client.trim(),
        project_type: "Whole Home",
        design_notes: notes.trim() || undefined,
      });
      if (!p) throw new Error("Could not create project");
      if (invoiceId) {
        await db.attachFinancialInvoiceToProject(invoiceId, p.id);
      }
      if (timelineId) {
        await db.attachProjectTimelineToProject(timelineId, p.id);
      }

      // Create rooms + seed material_items for each
      for (let i = 0; i < roomNames.length; i++) {
        const rn = roomNames[i];
        const room = await db.createRoom({ project_id: p.id, name: rn });
        if (!room) continue;
        await db.updateRoom(room.id, { sort_order: i });
        const tpl = templateForRoomName(rn);
        if (tpl.length > 0) {
          await db.bulkInsertMaterialItems(
            tpl.map((t, idx) => ({
              room_id: room.id,
              project_id: p.id,
              item_label: t.label,
              client_product_name: buildClientProductName(rn, t.label),
              category: t.category,
              is_required: true,
              sort_order: idx,
              cad_label: null,
              product_url: null,
              quantity: null,
              color: null,
              notes: null,
              not_needed: false,
              product_id: null,
              scrape_status: "pending",
              scrape_error: null,
            })),
          );
        }
      }

      toast.success("Project created");
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["financialInvoices", "unattached"] });
      qc.invalidateQueries({ queryKey: ["financialInvoices", "all"] });
      qc.invalidateQueries({ queryKey: ["financialInvoices", p.id] });
      qc.invalidateQueries({ queryKey: ["projectTimelines", "unattached"] });
      qc.invalidateQueries({ queryKey: ["projectTimelines", p.id] });
      setOpen(false);
      reset();
    } catch (e: any) {
      toast.error(e?.message || "Could not create project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 px-6 py-3 bg-ink text-primary-foreground text-sm tracking-wide hover:bg-ink/90 transition-colors">
          <Plus className="w-4 h-4" /> New Project
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">New Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="eyebrow">Project Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Montecito Hillside" />
            </div>
            <div className="space-y-1.5">
              <Label className="eyebrow">Client Name</Label>
              <Input value={client} onChange={e => setClient(e.target.value)} placeholder="Smith Family" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow">Project Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Client priorities, scope, references…" />
          </div>

          {unattachedInvoices.length > 0 && (
            <div className="space-y-1.5">
              <Label className="eyebrow">Attach Service Invoice</Label>
              <select
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              >
                <option value="">No invoice attached yet</option>
                {unattachedInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoiceLabel(invoice)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Use this after the client accepts or pays, so the original service invoice follows the project.
              </p>
            </div>
          )}

          {unattachedTimelines.length > 0 && (
            <div className="space-y-1.5">
              <Label className="eyebrow">Attach Timeline</Label>
              <select
                value={timelineId}
                onChange={(e) => setTimelineId(e.target.value)}
                className="h-10 w-full border border-input bg-background px-3 text-sm"
              >
                <option value="">No timeline attached yet</option>
                {unattachedTimelines.map((timeline) => (
                  <option key={timeline.id} value={timeline.id}>
                    {timelineLabel(timeline)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Attach the pre-project service timeline so it follows this project for the team and client.
              </p>
            </div>
          )}

          <div className="space-y-3">
            <Label className="eyebrow">Rooms in this project</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PRESET_ROOMS.map(r => (
                <label key={r} className="flex items-center gap-2 text-sm cursor-pointer py-1.5 px-2 hover:bg-bone/60 rounded-sm">
                  <Checkbox checked={selected.includes(r)} onCheckedChange={() => toggle(r)} />
                  <span>{r}</span>
                </label>
              ))}
            </div>

            {others.map((val, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={val}
                  onChange={e => setOthers(o => o.map((x, i) => i === idx ? e.target.value : x))}
                  placeholder="Custom room name (e.g. Pantry, Mudroom)"
                />
                <button
                  type="button"
                  onClick={() => setOthers(o => o.filter((_, i) => i !== idx))}
                  className="text-muted-foreground hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setOthers(o => [...o, ""])}
              className="text-xs text-muted-foreground hover:text-ink underline-offset-4 hover:underline"
            >
              + Add other room
            </button>
          </div>

          <button onClick={submit} disabled={busy} className="w-full mt-2 py-3 bg-ink text-primary-foreground text-sm tracking-wide disabled:opacity-60">
            {busy ? "Creating…" : "Create Project"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function invoiceLabel(invoice: FinancialInvoice) {
  const client = invoice.client_name || "Unassigned client";
  const total = invoice.total_amount != null ? formatMoney(invoice.total_amount) : "No total";
  const date = invoice.invoice_date || "No date";
  return `${client} - ${total} - ${date}`;
}

function timelineLabel(timeline: ProjectTimeline) {
  const owner = timeline.project_name || timeline.client_name || "Unassigned project";
  const title = timeline.title || "Service timeline";
  const date = timeline.timeline_date || "No date";
  return `${owner} - ${title} - ${date}`;
}
