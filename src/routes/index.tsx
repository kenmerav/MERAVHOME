import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, CheckCircle2, Plus, X } from "lucide-react";
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
import { canViewFinancials } from "@/lib/permissions";
import { ServiceInvoiceCreator } from "@/components/ServiceInvoiceCreator";
import { TimelineCreator } from "@/components/TimelineCreator";
import { formatMoney } from "@/lib/money";


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
            <h1 className="editorial-hero text-5xl lg:text-7xl">{isClientUser ? "Your Projects" : "Active Projects"}</h1>
            <p className="mt-4 text-muted-foreground max-w-xl">
              {isClientUser
                ? "Review current selections, leave comments, and jump straight into approvals that are ready for your feedback."
                : "Every selection lives here once. Use it for presentations, spec books, and procurement."}
            </p>
          </div>
          {!isClientUser && <NewProjectDialog />}
        </div>

        {isClientUser && (
          <ClientApprovalsOverview summaries={clientApprovalSummaries} approvalsReady={approvalsReady} />
        )}

        {canCreateInvoices && !isClientUser && (
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
          <EmptyState isClientUser={isClientUser} />
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

function ClientApprovalsOverview({
  summaries,
  approvalsReady,
}: {
  summaries: Array<{
    project: Project;
    roomCount: number;
    itemCount: number;
    needReviewCount: number;
    approvedCount: number;
    changesCount: number;
  }>;
  approvalsReady: Array<{
    project: Project;
    roomCount: number;
    itemCount: number;
    needReviewCount: number;
    approvedCount: number;
    changesCount: number;
  }>;
}) {
  return (
    <section className="mb-12 space-y-6">
      <div className="border border-border bg-bone/30 p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div>
            <div className="eyebrow mb-2">Approvals</div>
            <h2 className="font-display text-3xl">{approvalsReady.length > 0 ? "Selections ready for your review" : "No approvals waiting right now"}</h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
              {approvalsReady.length > 0
                ? `You currently have ${approvalsReady.reduce((sum, summary) => sum + summary.needReviewCount, 0)} selection${approvalsReady.reduce((sum, summary) => sum + summary.needReviewCount, 0) === 1 ? "" : "s"} that still need your approval.`
                : "When new selections are ready, they’ll show up here so you can jump straight into review."}
            </p>
          </div>
        </div>
      </div>

      {approvalsReady.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {approvalsReady.map((summary) => (
            <Link
              key={summary.project.id}
              to="/client/approvals/$projectId"
              params={{ projectId: summary.project.id }}
              className="group border border-border bg-background p-6 hover:border-ink transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="eyebrow mb-2">Needs Review</div>
                  <h3 className="font-display text-3xl leading-tight">{summary.project.name}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{summary.project.client_name}</p>
                </div>
                <div className="rounded-full bg-[#f1e3c8] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-ink">
                  {summary.needReviewCount} Pending
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>{summary.roomCount} room{summary.roomCount === 1 ? "" : "s"}</span>
                <span>{summary.approvedCount} approved</span>
                <span>{summary.changesCount} changes</span>
              </div>
              <div className="mt-6 inline-flex items-center gap-2 text-sm text-ink group-hover:gap-3 transition-all">
                Open approvals <ArrowRight className="h-4 w-4" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {summaries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard label="Projects With Approvals" value={summaries.length} />
          <MetricCard label="Selections Need Review" value={summaries.reduce((sum, summary) => sum + summary.needReviewCount, 0)} />
          <MetricCard label="Selections Approved" value={summaries.reduce((sum, summary) => sum + summary.approvedCount, 0)} />
        </div>
      )}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border bg-background px-5 py-4">
      <div className="eyebrow mb-2">{label}</div>
      <div className="font-display text-3xl">{value}</div>
    </div>
  );
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
