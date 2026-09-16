import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FolderKanban,
  LayoutDashboard,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createEaCalendarEvent,
  askEaAgent,
  loadEaCalendar,
  loadEaDocumentEvidence,
  loadEaWorkspace,
  saveEaWorkspace,
  type EaProjectEmail,
  type EaProject,
  type EaWorkspaceData,
  type EaTask,
} from "@/lib/eaWorkspaceClient";
import type { MarvinMessage } from "@/lib/marvin";
import type { MarvinCitation } from "@/lib/marvin";
import type { EaCalendarData, EaCalendarEvent } from "@/lib/appleCalendar.server";
import {
  differenceInCalendarDays,
  healthLabel,
  localDateKey,
  type EaProjectHealth,
  type EaProjectHealthStatus,
} from "@/lib/eaProjectHealth";
import {
  EA_INTERNAL_ONLY_POLICY,
  responsibilityForTask,
  summarizeEaResponsibilities,
} from "@/lib/eaOperatingSystem";
import { toast } from "sonner";

export const Route = createFileRoute("/ea-desk")({
  head: () => ({ meta: [{ title: "EA Desk - MERAV Studio" }] }),
  component: EaDeskPage,
});

type SeedArtifactKind = "email_draft" | "action_plan";

type EaTaskAnswer = {
  task_id: string;
  potential_answer: string | null;
  suggested_response: string | null;
  confidence: "high" | "medium" | "low";
  confidence_reason: string;
  evidence: Array<{
    id: string;
    source_type: "email" | "fathom" | "document";
    title: string;
    author_name: string | null;
    author_email: string | null;
    occurred_at: string;
    source_url: string | null;
    support: string;
    document_id?: string | null;
    page_number?: number | null;
  }>;
};

type DocumentEvidenceItem = {
  title: string;
  source_url?: string | null;
  support: string;
  document_id?: string | null;
  page_number?: number | null;
};

function EaDeskPage() {
  const pageQueryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    "agent" | "morning" | "approvals" | "emails" | "projects" | "calendar"
  >("agent");
  const [task, setTask] = useState<EaTask | null>(null);
  const [reviewProject, setReviewProject] = useState<EaProject | null>(null);
  const [taskArtifact, setTaskArtifact] = useState<SeedArtifactKind | null>(null);
  const [refreshingEmailActions, setRefreshingEmailActions] = useState(false);
  const [runningOperations, setRunningOperations] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["eaWorkspace"],
    queryFn: loadEaWorkspace,
  });
  const calendarQuery = useQuery({
    queryKey: ["eaCalendar"],
    queryFn: () => loadEaCalendar(false),
    staleTime: 5 * 60 * 1000,
  });
  const tasks = data?.tasks ?? [];
  const inboxLastUpdated = useMemo(
    () =>
      data?.syncStatus.find(
        (row) =>
          row.provider === "gmail" &&
          String(row.account_email || "").toLowerCase() === "marvinbotai@gmail.com",
      )?.last_sync_at ?? null,
    [data?.syncStatus],
  );
  const openTasks = tasks.filter(
    (item) => !["complete", "cancelled", "suggested"].includes(item.status),
  );
  const openTask = (selectedTask: EaTask, artifactKind: SeedArtifactKind | null = null) => {
    setTaskArtifact(artifactKind);
    setTask(selectedTask);
  };
  const refreshEmailActions = async () => {
    setRefreshingEmailActions(true);
    try {
      const result = await saveEaWorkspace({ action: "refresh_email_actions" });
      await refetch();
      const emailCreated = Number(result?.emailActions?.created || 0);
      const emailHistoryStillIndexing =
        result?.gmail?.partial === true || result?.gmail?.coverage?.complete === false;
      toast.success(
        emailCreated
          ? `${emailCreated} new email action${emailCreated === 1 ? "" : "s"} added.${emailHistoryStillIndexing ? " Older email history is still indexing." : ""}`
          : emailHistoryStillIndexing
            ? "Inbox updated. Older email history is still indexing, so Refresh Inbox again later."
            : "Email and Fathom knowledge are current. No new email actions were found.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to refresh email and Fathom knowledge.",
      );
    } finally {
      setRefreshingEmailActions(false);
    }
  };
  const refreshCalendar = async () => {
    const value = await loadEaCalendar(true);
    pageQueryClient.setQueryData(["eaCalendar"], value);
  };
  const runOperatingReview = async () => {
    setRunningOperations(true);
    try {
      const result = await saveEaWorkspace({ action: "run_operating_review" });
      await refetch();
      const review = result?.operatingReview;
      toast.success(
        `EA review complete: ${Number(review?.created || 0)} new, ${Number(review?.updated || 0)} updated, and ${Number(review?.reopened || 0)} follow-up${Number(review?.reopened || 0) === 1 ? "" : "s"} reopened. Nothing was sent.`,
      );
    } catch (reviewError) {
      toast.error(
        reviewError instanceof Error ? reviewError.message : "Unable to run the EA review.",
      );
    } finally {
      setRunningOperations(false);
    }
  };

  return (
    <AppShell>
      <div className="min-h-screen bg-bone">
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-5 py-8 lg:flex-row lg:items-end lg:justify-between lg:px-10">
            <div>
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                <LayoutDashboard className="h-4 w-4" /> MERAV EA Desk
              </div>
              <h1 className="text-4xl font-semibold tracking-[-0.04em] text-ink">
                Good {greeting()}.
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Studio action brief for {longDate(new Date())}
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 lg:items-end">
              <button
                type="button"
                onClick={refreshEmailActions}
                disabled={isFetching || refreshingEmailActions}
                title="Pull new messages from marvinbotai@gmail.com, Blue Sky construction PDFs, and Fathom transcripts"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isFetching || refreshingEmailActions ? "animate-spin" : ""}`}
                />{" "}
                Refresh inbox
              </button>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {refreshingEmailActions
                  ? "Inbox updating now…"
                  : inboxLastUpdated
                    ? `Inbox last updated ${formatInboxLastUpdated(inboxLastUpdated)}`
                    : isLoading
                      ? "Checking inbox update time…"
                      : "Inbox has not been updated yet"}
              </p>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-10">
          <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-background p-2 shadow-sm">
            <DeskTab
              icon={Bot}
              label="EA Agent"
              active={activeTab === "agent"}
              onClick={() => setActiveTab("agent")}
            />
            <DeskTab
              icon={LayoutDashboard}
              label="Morning desk"
              active={activeTab === "morning"}
              onClick={() => setActiveTab("morning")}
            />
            <DeskTab
              icon={ClipboardCheck}
              label={`Katie approvals${tasks.some((item) => item.approval_status === "pending") ? ` (${tasks.filter((item) => item.approval_status === "pending").length})` : ""}`}
              active={activeTab === "approvals"}
              onClick={() => setActiveTab("approvals")}
            />
            <DeskTab
              icon={Mail}
              label="Project emails"
              active={activeTab === "emails"}
              onClick={() => setActiveTab("emails")}
            />
            <DeskTab
              icon={FolderKanban}
              label="Projects"
              active={activeTab === "projects"}
              onClick={() => setActiveTab("projects")}
            />
            <DeskTab
              icon={CalendarDays}
              label="Calendar"
              active={activeTab === "calendar"}
              onClick={() => setActiveTab("calendar")}
            />
          </nav>

          {data?.setupNeeded && <SetupNotice />}
          {error && (
            <div className="mt-6 border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error instanceof Error ? error.message : "Unable to load EA Desk."}
            </div>
          )}

          {activeTab === "agent" && (
            <EaAgentWorkspace projects={data?.projects ?? []} loading={isLoading} />
          )}

          {activeTab === "morning" && Boolean(data?.fathomReview?.length) && (
            <FathomReviewNotice
              meetings={data?.fathomReview ?? []}
              projects={data?.projects ?? []}
              onLabeled={refetch}
            />
          )}

          {activeTab === "morning" && (
            <MorningDesk
              tasks={tasks}
              projects={data?.projects ?? []}
              profiles={data?.profiles ?? []}
              onOpen={openTask}
            />
          )}

          {activeTab === "approvals" && (
            <ApprovalQueue tasks={tasks} onOpen={(selectedTask) => openTask(selectedTask)} />
          )}

          {activeTab === "emails" && (
            <>
              <div className="mt-6">
                <SyncCard rows={data?.syncStatus ?? []} />
              </div>
              <EmailInbox emails={data?.emails ?? []} loading={isLoading} />
            </>
          )}

          {activeTab === "calendar" && (
            <CalendarWorkspace
              tasks={openTasks}
              data={calendarQuery.data}
              loading={calendarQuery.isLoading || calendarQuery.isFetching}
              error={calendarQuery.error}
              onRefresh={refreshCalendar}
            />
          )}

          {activeTab === "projects" && (
            <ProjectsHealthWorkspace
              data={data}
              loading={isLoading}
              calendarEvents={calendarQuery.data?.events ?? []}
              onReview={setReviewProject}
            />
          )}

          {activeTab === "projects" && (
            <section className="mt-10 grid grid-cols-1 gap-4 border-t border-border pt-8 lg:grid-cols-[1fr_1.2fr]">
              <div className="border border-border bg-bone/20 p-5">
                <div className="eyebrow mb-2">Who do I ask?</div>
                <h2 className="font-display text-3xl">Operating boundaries</h2>
                <div className="mt-5 space-y-4 text-sm leading-6">
                  <Routing
                    name="Katie"
                    text="Final design direction, approvals, substitutions, scope, and escalated client/design issues."
                  />
                  <Routing
                    name="Brynn"
                    text="Assigned design support, Studio/spec clarification, revisions, details, and selection or quantity checks."
                  />
                  <Routing
                    name="EA"
                    text="Scheduling, routing, status tracking, follow-up, meeting preparation, and approved handoffs."
                  />
                  <Routing
                    name="GC / trade"
                    text="Field measurements, installation timing, site conditions, and construction quantity confirmation."
                  />
                  <Routing
                    name="Vendor / supplier"
                    text="Quotes, availability, lead times, orders, delivery, damages, and returns."
                  />
                </div>
              </div>
              <SyncCard rows={data?.syncStatus ?? []} />
            </section>
          )}
        </div>
      </div>
      <TaskDialog
        task={task}
        initialArtifactKind={taskArtifact}
        calendarEvents={calendarQuery.data?.events ?? []}
        calendarLoading={calendarQuery.isLoading || calendarQuery.isFetching}
        canReviewApprovals={Boolean(data?.canReviewApprovals)}
        onClose={() => {
          setTask(null);
          setTaskArtifact(null);
        }}
      />
      <ProjectReviewDialog
        project={reviewProject}
        data={data}
        calendarEvents={calendarQuery.data?.events ?? []}
        onClose={() => setReviewProject(null)}
        onChanged={async () => {
          await refetch();
        }}
      />
    </AppShell>
  );
}

function EaOperationsWorkspace({
  tasks,
  memoryRules,
  loading,
  running,
  onRun,
  onOpen,
  onMemorySaved,
}: {
  tasks: EaTask[];
  memoryRules: EaWorkspaceData["memoryRules"];
  loading: boolean;
  running: boolean;
  onRun: () => Promise<void>;
  onOpen: (task: EaTask, artifactKind?: SeedArtifactKind | null) => void;
  onMemorySaved: () => Promise<void>;
}) {
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryRule, setMemoryRule] = useState("");
  const [savingMemory, setSavingMemory] = useState(false);
  const summaries = summarizeEaResponsibilities(tasks);
  const operatorTasks = tasks
    .filter(
      (task) =>
        task.source_type === "ea_agent" &&
        !["complete", "cancelled", "suggested"].includes(task.status),
    )
    .sort(
      (left, right) =>
        Number(right.priority === "high") - Number(left.priority === "high") ||
        String(left.due_date || "9999").localeCompare(String(right.due_date || "9999")),
    );
  const due = summaries.reduce((total, item) => total + item.dueCount, 0);
  const waiting = summaries.reduce((total, item) => total + item.waitingCount, 0);
  const urgent = summaries.reduce((total, item) => total + item.urgentCount, 0);
  const saveMemory = async () => {
    if (!memoryTitle.trim() || !memoryRule.trim()) {
      toast.error("Add a short title and tell the EA what it should remember.");
      return;
    }
    setSavingMemory(true);
    try {
      await saveEaWorkspace({
        action: "save_memory_rule",
        title: memoryTitle,
        rule: memoryRule,
      });
      setMemoryTitle("");
      setMemoryRule("");
      await onMemorySaved();
      toast.success("Saved to MERAV operating memory. Nothing was sent.");
    } catch (memoryError) {
      toast.error(memoryError instanceof Error ? memoryError.message : "Unable to save the rule.");
    } finally {
      setSavingMemory(false);
    }
  };

  return (
    <section className="mt-7">
      <div className="rounded-2xl border border-border bg-background p-6 shadow-sm lg:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="eyebrow mb-2">Human EA operating loop</div>
            <h2 className="font-display text-4xl">Own the follow-through</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The agent checks commitments, meetings, client and vendor follow-ups, procurement,
              project files, invoices, travel, and quality exceptions. It prepares the internal work
              and keeps watching until Studio contains completion evidence.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onRun()}
            disabled={loading || running}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-medium text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {running ? "Reviewing Studio…" : "Run full EA review"}
          </button>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <DeskMetric
            label="Agent actions"
            value={operatorTasks.length}
            detail="Prepared internally"
            emphasis
          />
          <DeskMetric label="Due now" value={due} detail="Needs a next move" />
          <DeskMetric label="Waiting" value={waiting} detail="Watched until follow-up" />
          <DeskMetric label="Urgent / blocked" value={urgent} detail="Escalated for review" />
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {summaries.map((item) => (
          <article
            key={item.key}
            className="rounded-2xl border border-border bg-background p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-ink">{item.label}</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.openCount ? "bg-accent text-ink" : "bg-emerald-50 text-emerald-800"}`}
              >
                {item.openCount ? item.openCount : "Watching"}
              </span>
            </div>
            <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
              {item.automaticWork}
            </p>
            {item.dueCount + item.waitingCount + item.urgentCount > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[.1em] text-muted-foreground">
                {item.dueCount > 0 && <span>{item.dueCount} due</span>}
                {item.waitingCount > 0 && <span>{item.waitingCount} waiting</span>}
                {item.urgentCount > 0 && <span>{item.urgentCount} urgent</span>}
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="eyebrow mb-1">Prepared work</div>
              <h3 className="font-display text-3xl">Agent action plans</h3>
            </div>
            <div className="text-xs text-muted-foreground">Runs at 7:00 AM and noon Phoenix time</div>
          </div>
          {loading ? (
            <div className="rounded-2xl border border-border bg-background p-10 text-sm text-muted-foreground">
              Reviewing Studio operations…
            </div>
          ) : operatorTasks.length ? (
            <div className="space-y-3">
              {operatorTasks.map((task) => {
                const summary = summaries.find((item) => item.key === responsibilityForTask(task));
                return (
                  <article
                    key={task.id}
                    className="rounded-2xl border border-border bg-background p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
                          <span>{summary?.label || "EA action"}</span>
                          {task.priority === "high" && (
                            <span className="text-red-700">Priority</span>
                          )}
                          {task.due_date && <span>Due {formatDate(task.due_date)}</span>}
                        </div>
                        <h4 className="mt-2 text-lg font-semibold text-ink">{task.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{task.notes}</p>
                        {task.project?.name && (
                          <div className="mt-3 text-xs text-muted-foreground">
                            {task.project.name}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpen(task, "action_plan")}
                        className="shrink-0 rounded-xl border border-border px-4 py-2 text-sm font-medium hover:border-ink"
                      >
                        Open plan
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-background p-10 text-sm text-muted-foreground">
              No agent exceptions are open. Run the full review to check current Studio data.
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-ink bg-ink p-6 text-white shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-white/60">
            <ClipboardCheck className="h-4 w-4" /> Permanent authority rule
          </div>
          <h3 className="mt-3 font-display text-3xl">Internal work only</h3>
          <PolicyList title="Automatic" items={EA_INTERNAL_ONLY_POLICY.automatic} />
          <PolicyList
            title="Needs confirmation"
            items={EA_INTERNAL_ONLY_POLICY.confirmationRequired}
          />
          <PolicyList title="Never" items={EA_INTERNAL_ONLY_POLICY.never} danger />
        </aside>
      </div>

      <section className="mt-8 rounded-2xl border border-border bg-background p-6 shadow-sm lg:p-8">
        <div className="grid gap-7 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <div className="eyebrow mb-2">MERAV operating memory</div>
            <h3 className="font-display text-3xl">Teach the EA once</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Save an approved preference, responsibility, vendor route, escalation rule, or
              repeatable process. The EA will use it in later research and drafts, but it can never
              use a saved rule as permission to act externally.
            </p>
            <div className="mt-5 space-y-3">
              <Input
                value={memoryTitle}
                onChange={(event) => setMemoryTitle(event.target.value)}
                placeholder="Example: Cabinet ordering responsibility"
                className="rounded-xl"
              />
              <Textarea
                value={memoryRule}
                onChange={(event) => setMemoryRule(event.target.value)}
                placeholder="Tell the EA exactly what it should remember…"
                className="min-h-28 rounded-xl"
              />
              <button
                type="button"
                onClick={saveMemory}
                disabled={savingMemory || !memoryTitle.trim() || !memoryRule.trim()}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> {savingMemory ? "Saving…" : "Save operating rule"}
              </button>
            </div>
          </div>
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">
              Approved memory · {memoryRules.length}
            </div>
            {memoryRules.length ? (
              <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                {memoryRules.map((memory) => (
                  <article
                    key={memory.id}
                    className="rounded-xl border border-border bg-bone/40 p-4"
                  >
                    <div className="font-semibold text-ink">{memory.title}</div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {memory.body_text}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
                No approved operating rules have been saved yet.
              </div>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}

function PolicyList({
  title,
  items,
  danger = false,
}: {
  title: string;
  items: readonly string[];
  danger?: boolean;
}) {
  return (
    <div className="mt-6">
      <div
        className={`text-xs font-semibold uppercase tracking-[.12em] ${danger ? "text-rose-300" : "text-white/60"}`}
      >
        {title}
      </div>
      <ul className="mt-2 space-y-2 text-sm leading-5 text-white/85">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type ProjectHealthFilter = "active" | "attention" | "on_track" | "inactive";

const EA_AGENT_STARTERS = [
  "What needs to happen next on this project?",
  "Find the best supported answer to the most important open question.",
  "Who should we ask for missing information, and what exact questions should we send?",
  "Read the latest construction documents and summarize anything relevant to current open work.",
  "Prepare a concise project review with risks, decisions, waiting items, and next actions.",
];

function EaAgentWorkspace({ projects, loading }: { projects: EaProject[]; loading: boolean }) {
  const [projectId, setProjectId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<MarvinMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [working, setWorking] = useState(false);
  const selectedProject = projects.find((project) => project.id === projectId);
  const projectOptions = [...projects].sort((left, right) => left.name.localeCompare(right.name));

  const ask = async (prompt?: string) => {
    const message = String(prompt ?? question).trim();
    if (!projectId) return toast.error("Choose a project first.");
    if (!message) return;
    setWorking(true);
    setQuestion("");
    const localMessage: MarvinMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, localMessage]);
    try {
      const result = await askEaAgent({
        project_id: projectId,
        conversation_id: conversationId || null,
        message,
      });
      setConversationId(result.conversationId);
      setMessages((current) => [...current, result.message]);
    } catch (agentError) {
      toast.error(
        agentError instanceof Error ? agentError.message : "The EA Agent could not answer.",
      );
    } finally {
      setWorking(false);
    }
  };

  const changeProject = (value: string) => {
    setProjectId(value);
    setConversationId("");
    setMessages([]);
  };

  return (
    <section className="mt-7">
      <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
        <aside className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white">
            <Bot className="h-5 w-5" />
          </div>
          <div className="eyebrow mt-5">Private MERAV intelligence</div>
          <h2 className="mt-2 font-display text-4xl">EA Agent</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Finds answers, reads project evidence, identifies who to ask, and prepares the next
            action. It never sends a message or invitation.
          </p>

          <label className="mt-6 block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Project
            </span>
            <select
              value={projectId}
              disabled={loading}
              onChange={(event) => changeProject(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">Choose a project</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.client_name ? ` · ${project.client_name}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-6 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Start with
            </div>
            {EA_AGENT_STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                disabled={!projectId || working}
                onClick={() => ask(starter)}
                className="w-full rounded-xl border border-border px-3 py-2.5 text-left text-sm leading-5 transition-colors hover:border-ink disabled:opacity-40"
              >
                {starter}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[680px] flex-col rounded-2xl border border-border bg-background shadow-sm">
          <header className="border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-ink">
                  {selectedProject ? selectedProject.name : "Choose a project to begin"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Studio + Marvin Gmail + Fathom + tasks + construction documents
                </div>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[.12em] text-emerald-800">
                Draft only · nothing sent
              </span>
            </div>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto p-5 lg:p-7">
            {messages.length === 0 && (
              <div className="mx-auto max-w-xl py-24 text-center">
                <Sparkles className="mx-auto h-8 w-8 text-brass" />
                <h3 className="mt-4 font-display text-3xl">What do you need to know?</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Ask naturally. The agent will separate confirmed facts from assumptions, give a
                  confidence level, and show the evidence it used.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-2xl rounded-2xl bg-bone px-4 py-3"
                    : "max-w-3xl border-l-2 border-ink pl-4"
                }
              >
                <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                {message.role === "assistant" && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(message.content);
                        toast.success("Agent response copied.");
                      }}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-xs"
                    >
                      Copy
                    </button>
                    {(message.citations ?? [])
                      .filter(
                        (citation) =>
                          citation.sourceType !== "document" ||
                          !citation.documentId ||
                          !citation.pageNumber,
                      )
                      .map((citation, index) =>
                        citation.url ? (
                          <a
                            key={`${citation.title}-${index}`}
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs"
                          >
                            {citation.title} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span
                            key={`${citation.title}-${index}`}
                            className="rounded-lg bg-bone px-2.5 py-1.5 text-xs text-muted-foreground"
                          >
                            {citation.title}
                          </span>
                        ),
                      )}
                  </div>
                )}
                {message.role === "assistant" &&
                  (message.citations ?? [])
                    .filter(
                      (
                        citation,
                      ): citation is MarvinCitation & {
                        documentId: string;
                        pageNumber: number;
                      } =>
                        citation.sourceType === "document" &&
                        Boolean(citation.documentId) &&
                        Boolean(citation.pageNumber),
                    )
                    .map((citation, index) => (
                      <div
                        className="mt-4"
                        key={`${citation.documentId}-${citation.pageNumber}-${index}`}
                      >
                        <DocumentEvidenceCard
                          item={{
                            title: citation.title,
                            source_url: citation.url,
                            support: citation.support || "This page directly supports the answer.",
                            document_id: citation.documentId,
                            page_number: citation.pageNumber,
                          }}
                        />
                      </div>
                    ))}
              </article>
            ))}
            {working && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" /> Checking the project evidence…
              </div>
            )}
          </div>

          <div className="border-t border-border p-4">
            <div className="flex items-end gap-2">
              <Textarea
                value={question}
                disabled={!projectId || working}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    ask();
                  }
                }}
                placeholder={
                  projectId
                    ? "Ask for an answer, a project review, who to contact, or a draft reply…"
                    : "Choose a project first"
                }
                className="min-h-20 resize-none rounded-xl"
              />
              <button
                type="button"
                disabled={!projectId || !question.trim() || working}
                onClick={() => ask()}
                aria-label="Ask EA Agent"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink text-white disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Answers are assistance, not approval. Verify field conditions, dimensions, code,
              structural, and MEP decisions with the responsible professional.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProjectsHealthWorkspace({
  data,
  loading,
  calendarEvents,
  onReview,
}: {
  data: EaWorkspaceData | undefined;
  loading: boolean;
  calendarEvents: EaCalendarEvent[];
  onReview: (project: EaProject) => void;
}) {
  const [filter, setFilter] = useState<ProjectHealthFilter>("active");
  const [search, setSearch] = useState("");
  const operations = new Map((data?.operations ?? []).map((item) => [item.project_id, item]));
  const healthByProject = new Map(
    (data?.projectHealth ?? []).map((item) => [
      item.project_id,
      healthWithCalendar(
        item,
        data?.projects.find((project) => project.id === item.project_id),
        operations.get(item.project_id),
        data?.tasks ?? [],
        calendarEvents,
      ),
    ]),
  );
  const activeHealth = [...healthByProject.values()].filter(
    (item) => item.lifecycle_status === "active",
  );
  const summary = {
    needsTouch: activeHealth.filter((item) => item.health === "needs_touch").length,
    atRisk: activeHealth.filter((item) => item.health === "at_risk").length,
    behind: activeHealth.filter((item) => item.health === "behind").length,
    overdue: activeHealth.reduce((total, item) => total + item.overdue_count, 0),
  };
  const query = search.trim().toLowerCase();
  const projects = (data?.projects ?? [])
    .map((project) => ({
      project,
      operation: operations.get(project.id),
      health:
        healthByProject.get(project.id) ??
        fallbackProjectHealth(project, operations.get(project.id)),
    }))
    .filter(({ project, operation, health }) => {
      if (filter === "active" && health.lifecycle_status !== "active") return false;
      if (
        filter === "attention" &&
        (health.lifecycle_status !== "active" || health.health === "on_track")
      )
        return false;
      if (
        filter === "on_track" &&
        (health.lifecycle_status !== "active" || health.health !== "on_track")
      )
        return false;
      if (filter === "inactive" && health.lifecycle_status === "active") return false;
      if (!query) return true;
      return [project.name, project.client_name, operation?.phase, ...(operation?.aliases ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort(
      (left, right) =>
        healthRank(left.health.health) - healthRank(right.health.health) ||
        right.health.overdue_count - left.health.overdue_count ||
        left.project.name.localeCompare(right.project.name),
    );

  return (
    <section className="mt-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow mb-2">Projects</div>
          <h2 className="font-display text-3xl">Project checkup</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            What needs a touch, what is due, and what may be falling behind.
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ProjectHealthMetric label="Needs touch" value={summary.needsTouch} tone="touch" />
        <ProjectHealthMetric label="At risk" value={summary.atRisk} tone="risk" />
        <ProjectHealthMetric label="Behind" value={summary.behind} tone="behind" />
        <ProjectHealthMetric label="Overdue items" value={summary.overdue} tone="neutral" />
      </div>

      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-background p-1 shadow-sm">
          {(
            [
              ["active", "All active"],
              ["attention", "Needs attention"],
              ["on_track", "On track"],
              ["inactive", "On hold / completed"],
            ] as Array<[ProjectHealthFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${filter === value ? "bg-accent text-ink" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative block w-full lg:max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
            className="rounded-xl pl-9"
          />
        </label>
      </div>

      {loading ? (
        <div className="py-16 text-sm text-muted-foreground">Checking project health…</div>
      ) : projects.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-sm text-muted-foreground">
          No projects match this view.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {projects.map(({ project, operation, health }) => {
            const nextCalendar = nextProjectCalendarEvent(
              project,
              operation,
              data?.tasks ?? [],
              calendarEvents,
            );
            return (
              <article
                key={project.id}
                className={`rounded-2xl border bg-background p-5 shadow-sm lg:p-6 ${healthBorder(health.health, health.lifecycle_status)}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <HealthPill
                        health={health.health}
                        inactive={health.lifecycle_status !== "active"}
                      />
                      <StatusPill status={health.lifecycle_status} />
                      {health.missing_info.length > 0 && (
                        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] text-stone-700">
                          Missing info
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {operation?.phase || project.status}
                      </span>
                    </div>
                    <button type="button" onClick={() => onReview(project)} className="text-left">
                      <h3 className="mt-3 font-display text-3xl">{project.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{project.client_name}</p>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReview(project)}
                    className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs hover:border-ink"
                  >
                    Review
                  </button>
                </div>

                <div className="mt-4 rounded-xl bg-bone/50 p-3 text-sm">
                  <div className="font-medium">{health.reasons[0]}</div>
                  {health.reasons.length > 1 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {health.reasons.slice(1).join(" · ")}
                    </div>
                  )}
                  {health.missing_info.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Missing info: {health.missing_info.join(", ")}
                    </div>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
                  <HealthFact label="Last touch" value={lastTouchLabel(health.last_touch_at)} />
                  <HealthFact
                    label="Next touch"
                    value={
                      nextCalendar
                        ? formatCalendarTouch(nextCalendar)
                        : health.next_touch_date
                          ? formatDate(health.next_touch_date)
                          : "Not scheduled"
                    }
                  />
                  <HealthFact
                    label="Overdue"
                    value={String(health.overdue_count)}
                    alert={health.overdue_count > 0}
                  />
                  <HealthFact
                    label="Due next 7 days"
                    value={String(health.due_next_7_days_count)}
                  />
                </div>

                <div className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                  <ProjectFact
                    label="Timeline"
                    value={
                      health.next_milestone
                        ? `${health.next_milestone.title}${health.next_milestone.target_date ? ` · ${formatDate(health.next_milestone.target_date)}` : ""}${health.milestone_variance_days ? ` · ${health.milestone_variance_days}d late` : ""}`
                        : "No open milestone"
                    }
                  />
                  <ProjectFact
                    label="Open work"
                    value={`${health.open_count} open · ${health.blocked_count} blocked · ${health.waiting_count} waiting`}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProjectReviewDialog({
  project,
  data,
  calendarEvents,
  onClose,
  onChanged,
}: {
  project: EaProject | null;
  data: EaWorkspaceData | undefined;
  calendarEvents: EaCalendarEvent[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [nextTouch, setNextTouch] = useState("");
  const [lifecycle, setLifecycle] = useState<"active" | "on_hold" | "completed">("active");
  const [newItem, setNewItem] = useState({
    title: "",
    assigned_user_id: "",
    due_date: "",
    notes: "",
  });
  const operation = data?.operations.find((item) => item.project_id === project?.id);
  const rawHealth = data?.projectHealth.find((item) => item.project_id === project?.id);
  const health =
    rawHealth && project
      ? healthWithCalendar(rawHealth, project, operation, data?.tasks ?? [], calendarEvents)
      : null;
  const nextCalendar = project
    ? nextProjectCalendarEvent(project, operation, data?.tasks ?? [], calendarEvents)
    : null;
  const owners = eaOwnerProfiles(data?.profiles ?? []);

  useEffect(() => {
    setNextTouch(operation?.follow_up_date ?? "");
    setLifecycle(health?.lifecycle_status ?? "active");
    setNewItem({ title: "", assigned_user_id: "", due_date: "", notes: "" });
  }, [project?.id, operation?.follow_up_date, health?.lifecycle_status]);

  if (!project || !health) return null;

  const saveReview = async (includeDate: boolean) => {
    setBusy(includeDate ? "touch" : "review");
    try {
      await saveEaWorkspace({
        action: "review_project",
        project_id: project.id,
        ...(includeDate ? { follow_up_date: nextTouch } : {}),
      });
      await onChanged();
      toast.success(
        includeDate ? "Next touch saved. Nothing was sent." : "Project marked reviewed.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the project review.");
    } finally {
      setBusy(null);
    }
  };
  const saveLifecycle = async () => {
    setBusy("lifecycle");
    try {
      await saveEaWorkspace({
        action: "review_project",
        project_id: project.id,
        lifecycle_status: lifecycle,
      });
      await onChanged();
      toast.success(
        lifecycle === "on_hold"
          ? "Project placed on hold. It is out of active attention totals."
          : "Project status updated.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the project status.");
    } finally {
      setBusy(null);
    }
  };
  const addItem = async () => {
    if (!newItem.title.trim()) return toast.error("Enter the item that needs to be done.");
    setBusy("item");
    try {
      await saveEaWorkspace({ action: "add_task", project_id: project.id, ...newItem });
      setNewItem({ title: "", assigned_user_id: "", due_date: "", notes: "" });
      await onChanged();
      toast.success("Project item added. Nothing was sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add the project item.");
    } finally {
      setBusy(null);
    }
  };
  const updateMilestone = async (patch: Record<string, unknown>) => {
    if (!health.next_milestone) return;
    setBusy("milestone");
    try {
      await saveEaWorkspace({
        action: "update_milestone",
        project_id: project.id,
        id: health.next_milestone.id,
        ...patch,
      });
      await onChanged();
      toast.success("Milestone updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the milestone.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="eyebrow">Project checkup</div>
          <DialogTitle className="font-display text-4xl">{project.name}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <HealthPill health={health.health} inactive={health.lifecycle_status !== "active"} />
          {health.missing_info.length > 0 && (
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] text-stone-700">
              Missing info
            </span>
          )}
          <span className="text-sm text-muted-foreground">{health.reasons.join(" · ")}</span>
        </div>

        {health.missing_info.length > 0 && (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-3 text-sm text-stone-700">
            Missing info: {health.missing_info.join(", ")}. This does not make the project at risk.
          </div>
        )}

        <section className="rounded-2xl border border-border p-4">
          <div className="eyebrow">Project status</div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select
              value={lifecycle}
              onChange={(event) =>
                setLifecycle(event.target.value as "active" | "on_hold" | "completed")
              }
              className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="completed">Completed</option>
            </select>
            <button
              type="button"
              disabled={busy !== null}
              onClick={saveLifecycle}
              className="shrink-0 rounded-lg border border-ink px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy === "lifecycle" ? "Saving…" : "Save project status"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            On-hold and completed projects are removed from active attention and overdue totals.
          </p>
        </section>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          <HealthFact label="Last touch" value={lastTouchLabel(health.last_touch_at)} />
          <HealthFact
            label="Overdue"
            value={String(health.overdue_count)}
            alert={health.overdue_count > 0}
          />
          <HealthFact label="Due next 7 days" value={String(health.due_next_7_days_count)} />
          <HealthFact label="Open items" value={String(health.open_count)} />
        </div>

        {nextCalendar && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
            <div className="font-medium">
              Scheduled on {nextCalendar.calendar === "FAMILY" ? "Family" : nextCalendar.calendar}
            </div>
            <div className="mt-1">
              {nextCalendar.title} · {formatCalendarTouch(nextCalendar)}
            </div>
          </div>
        )}

        <section className="rounded-2xl border border-border p-4">
          <div className="eyebrow">Next touch</div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              type="date"
              value={nextTouch}
              onChange={(event) => setNextTouch(event.target.value)}
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => saveReview(true)}
              className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {busy === "touch" ? "Saving…" : "Save next touch"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => saveReview(false)}
              className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy === "review" ? "Saving…" : "Mark reviewed"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            These are internal tracking actions. They do not email or invite anyone.
          </p>
        </section>

        {health.next_milestone && (
          <section className="rounded-2xl border border-border p-4">
            <div className="eyebrow">Current milestone</div>
            <div className="mt-2 font-medium">{health.next_milestone.title}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select
                value={health.next_milestone.status}
                disabled={busy !== null}
                onChange={(event) => updateMilestone({ status: event.target.value })}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="complete">Complete</option>
                <option value="skipped">Skipped</option>
              </select>
              <Input
                type="date"
                value={health.next_milestone.target_date ?? ""}
                disabled={busy !== null}
                onChange={(event) => updateMilestone({ target_date: event.target.value })}
              />
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-border p-4">
          <div className="eyebrow">Add project item</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Input
              value={newItem.title}
              onChange={(event) => setNewItem((prior) => ({ ...prior, title: event.target.value }))}
              placeholder="What needs to be done?"
            />
            <select
              value={newItem.assigned_user_id}
              onChange={(event) =>
                setNewItem((prior) => ({ ...prior, assigned_user_id: event.target.value }))
              }
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">Unassigned</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.full_name || owner.email}
                </option>
              ))}
            </select>
            <Input
              value={newItem.notes}
              onChange={(event) => setNewItem((prior) => ({ ...prior, notes: event.target.value }))}
              placeholder="Optional note"
            />
            <Input
              type="date"
              value={newItem.due_date}
              onChange={(event) =>
                setNewItem((prior) => ({ ...prior, due_date: event.target.value }))
              }
            />
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={addItem}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {busy === "item" ? "Adding…" : "Add item"}
          </button>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-border p-4">
            <div className="eyebrow">Open work</div>
            <div className="mt-3 divide-y divide-border">
              {health.open_items.slice(0, 6).map((item) => (
                <div key={item.id} className="py-3 text-sm">
                  <div className="font-medium">{item.title}</div>
                  <div className="mt-1 text-xs capitalize text-muted-foreground">
                    {item.status.replaceAll("_", " ")}
                    {item.due_date ? ` · ${formatDate(item.due_date)}` : ""}
                  </div>
                </div>
              ))}
              {!health.open_items.length && (
                <div className="py-4 text-sm text-muted-foreground">No open items.</div>
              )}
            </div>
          </section>
          <section className="rounded-2xl border border-border p-4">
            <div className="eyebrow">Recent activity</div>
            <div className="mt-3 divide-y divide-border">
              {health.recent_activity.slice(0, 6).map((activity) => (
                <div key={`${activity.kind}-${activity.id}`} className="py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium">{activity.title}</div>
                    <span className="shrink-0 text-[10px] uppercase tracking-[.12em] text-muted-foreground">
                      {activity.kind}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatActivityDate(activity.occurred_at)}
                  </div>
                </div>
              ))}
              {!health.recent_activity.length && (
                <div className="py-4 text-sm text-muted-foreground">No linked activity yet.</div>
              )}
            </div>
          </section>
        </div>

        <div className="flex justify-end">
          <Link
            to="/projects/$id/operations"
            params={{ id: project.id }}
            className="inline-flex items-center gap-2 text-sm underline underline-offset-4"
          >
            Open full project operations <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectHealthMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "touch" | "risk" | "behind" | "neutral";
}) {
  const Icon =
    tone === "behind"
      ? AlertTriangle
      : tone === "touch"
        ? Activity
        : tone === "risk"
          ? CircleDot
          : Clock3;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-2 text-4xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function HealthPill({
  health,
  inactive = false,
}: {
  health: EaProjectHealthStatus;
  inactive?: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.12em] ${inactive ? "bg-stone-100 text-stone-600" : health === "behind" ? "bg-red-100 text-red-800" : health === "at_risk" ? "bg-amber-100 text-amber-900" : health === "needs_touch" ? "bg-brass/20 text-ink" : "bg-emerald-100 text-emerald-800"}`}
    >
      {healthLabel(health)}
    </span>
  );
}

function HealthFact({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="bg-background p-3">
      <div className="text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-medium ${alert ? "text-red-700" : ""}`}>{value}</div>
    </div>
  );
}

function fallbackProjectHealth(
  project: EaProject,
  operation?: EaWorkspaceData["operations"][number],
): EaProjectHealth {
  const status = project.status.toLowerCase();
  const lifecycle =
    operation?.lifecycle_status ??
    (status === "complete" ? "completed" : status.includes("hold") ? "on_hold" : "active");
  return {
    project_id: project.id,
    lifecycle_status: lifecycle,
    health: "on_track",
    reasons: [
      lifecycle === "active"
        ? "No current warning signs"
        : lifecycle === "on_hold"
          ? "Project is on hold"
          : "Project is completed",
    ],
    missing_info: lifecycle === "active" ? ["project health data"] : [],
    last_touch_at: null,
    next_touch_date: operation?.follow_up_date ?? null,
    overdue_count: 0,
    due_next_7_days_count: 0,
    open_count: 0,
    blocked_count: 0,
    waiting_count: 0,
    milestone_variance_days: null,
    next_milestone: null,
    open_items: [],
    recent_activity: [],
    reviewed_at: operation?.last_reviewed_at ?? null,
  };
}

function healthWithCalendar(
  health: EaProjectHealth,
  project: EaProject | undefined,
  operation: EaWorkspaceData["operations"][number] | undefined,
  tasks: EaTask[],
  events: EaCalendarEvent[],
) {
  if (!project || health.lifecycle_status !== "active" || health.health !== "needs_touch")
    return health;
  const event = nextProjectCalendarEvent(project, operation, tasks, events);
  if (!event) return health;
  return {
    ...health,
    health: "on_track" as const,
    reasons: [`Appointment scheduled for ${formatCalendarTouch(event)}`],
  };
}

function nextProjectCalendarEvent(
  project: EaProject,
  operation: EaWorkspaceData["operations"][number] | undefined,
  tasks: EaTask[],
  events: EaCalendarEvent[],
) {
  const projectTaskIds = new Set(
    tasks.filter((task) => task.project_id === project.id).map((task) => task.id),
  );
  const aliases = [project.name, project.client_name, ...(operation?.aliases ?? [])]
    .map(normalizeProjectMatch)
    .filter((value) => value.length >= 4);
  const now = Date.now();
  return (
    events
      .filter((event) => new Date(event.end_at).getTime() >= now)
      .filter((event) => {
        const marker = /^merav-ea:\/\/task\/(.+)$/i.exec(event.url || "");
        if (marker) {
          try {
            return projectTaskIds.has(decodeURIComponent(marker[1]));
          } catch {
            return projectTaskIds.has(marker[1]);
          }
        }
        const haystack = normalizeProjectMatch(`${event.title} ${event.location || ""}`);
        return aliases.some((alias) => haystack.includes(alias));
      })
      .sort((left, right) => left.start_at.localeCompare(right.start_at))[0] ?? null
  );
}

function normalizeProjectMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function healthRank(health: EaProjectHealthStatus) {
  return health === "behind" ? 0 : health === "at_risk" ? 1 : health === "needs_touch" ? 2 : 3;
}

function healthBorder(health: EaProjectHealthStatus, lifecycle: string) {
  if (lifecycle !== "active") return "border-border opacity-75";
  if (health === "behind") return "border-red-200";
  if (health === "at_risk") return "border-amber-200";
  if (health === "needs_touch") return "border-brass/50";
  return "border-border";
}

function lastTouchLabel(value: string | null) {
  if (!value) return "No linked touch";
  const days = differenceInCalendarDays(localDateKey(), value.slice(0, 10));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function formatCalendarTouch(event: EaCalendarEvent) {
  return new Date(event.start_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: event.all_day ? undefined : "numeric",
    minute: event.all_day ? undefined : "2-digit",
  });
}

function formatActivityDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function eaOwnerProfiles(profiles: EaWorkspaceData["profiles"]) {
  return ["katie", "brynn", "ken"]
    .map((name) =>
      profiles.find((profile) => {
        const firstName = String(profile.full_name || "")
          .trim()
          .split(/\s+/)[0]
          .toLowerCase();
        const emailName = String(profile.email || "")
          .split("@")[0]
          .toLowerCase();
        return firstName === name || emailName === name;
      }),
    )
    .filter((profile): profile is EaWorkspaceData["profiles"][number] => Boolean(profile));
}

function FathomReviewNotice({
  meetings,
  projects,
  onLabeled,
}: {
  meetings: Array<{
    id: string;
    title: string;
    occurred_at: string | null;
    source_url: string | null;
    suggested_project_id: string | null;
    match_confidence: number | null;
    match_reason: string | null;
  }>;
  projects: Array<{ id: string; name: string; status: string }>;
  onLabeled: () => Promise<unknown>;
}) {
  const [labelingId, setLabelingId] = useState<string | null>(null);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const labelProject = async (meetingId: string, projectId: string) => {
    if (!projectId) return;
    setLabelingId(meetingId);
    try {
      await saveEaWorkspace({
        action: "label_fathom_project",
        id: meetingId,
        project_id: projectId,
      });
      await onLabeled();
      toast.success("Transcript labeled to the project knowledge base.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to label the transcript.");
    } finally {
      setLabelingId(null);
    }
  };
  return (
    <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4 text-amber-950">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <div className="text-sm font-semibold">
            {meetings.length} Fathom meeting{meetings.length === 1 ? "" : "s"} need a project match
          </div>
          <p className="mt-1 text-sm leading-6 text-amber-900/80">
            Label these transcripts so the EA Agent can use their meeting details when answering
            project questions. Fathom transcripts do not create Morning Desk actions.
          </p>
          <div className="mt-3 space-y-2">
            {meetings.map((meeting) => (
              <div
                key={meeting.id}
                className="flex flex-col gap-2 rounded-xl border border-amber-200/80 bg-white/60 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 text-xs text-amber-900/80">
                  <div className="font-medium text-amber-950">
                    {meeting.source_url ? (
                      <a href={meeting.source_url} target="_blank" rel="noreferrer">
                        {meeting.title}
                      </a>
                    ) : (
                      meeting.title
                    )}
                    {meeting.occurred_at
                      ? ` · ${new Date(meeting.occurred_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}`
                      : ""}
                  </div>
                  {meeting.suggested_project_id &&
                    projectById.has(meeting.suggested_project_id) && (
                      <div className="mt-1">
                        Possible match: {projectById.get(meeting.suggested_project_id)?.name}
                        {meeting.match_confidence != null
                          ? ` · ${Math.round(meeting.match_confidence * 100)}%`
                          : ""}
                      </div>
                    )}
                </div>
                <select
                  aria-label={`Project label for ${meeting.title}`}
                  defaultValue=""
                  disabled={labelingId === meeting.id}
                  onChange={(event) => labelProject(meeting.id, event.target.value)}
                  className="h-9 min-w-52 rounded-lg border border-amber-300 bg-background px-3 text-xs text-foreground disabled:opacity-50"
                >
                  <option value="">
                    {labelingId === meeting.id ? "Labeling transcript…" : "Label project…"}
                  </option>
                  {projects
                    .filter((project) => project.status !== "Complete")
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DeskTab({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Clock3;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors ${active ? "bg-ink text-primary-foreground" : "text-foreground hover:bg-accent"}`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function MorningDesk({
  tasks,
  projects,
  profiles,
  onOpen,
}: {
  tasks: EaTask[];
  projects: EaProject[];
  profiles: Array<{ id: string; email: string; full_name: string; role: string }>;
  onOpen: (task: EaTask, artifactKind?: SeedArtifactKind | null) => void;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<"open" | "complete" | "all">("open");
  const [grouping, setGrouping] = useState<"project" | "priority">("project");
  const [owner, setOwner] = useState("all");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [newItem, setNewItem] = useState({
    title: "",
    project_id: "",
    assigned_user_id: "",
    due_date: "",
    notes: "",
  });
  const ownerFilterProfiles = ["katie", "brynn", "ken"]
    .map((name) =>
      profiles.find((profile) => {
        const firstName = String(profile.full_name || "")
          .trim()
          .split(/\s+/)[0]
          .toLowerCase();
        const emailName = String(profile.email || "")
          .split("@")[0]
          .toLowerCase();
        return firstName === name || emailName === name;
      }),
    )
    .filter((profile): profile is (typeof profiles)[number] => Boolean(profile));
  const visible = tasks.filter(
    (task) => task.status !== "cancelled" && task.status !== "suggested",
  );
  const open = visible.filter((task) => task.status !== "complete");
  const complete = visible.filter((task) => task.status === "complete");
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Phoenix",
  }).format(new Date());
  const completedToday = complete.filter((task) => task.completed_at?.slice(0, 10) === today);
  const progressTotal = open.length + completedToday.length;
  const ownerFiltered = visible.filter(
    (task) =>
      owner === "all" ||
      task.assigned_user_id === owner ||
      (owner === "unassigned" && !task.assigned_user_id),
  );
  const filtered = ownerFiltered.filter((task) =>
    view === "all"
      ? true
      : view === "complete"
        ? task.status === "complete"
        : task.status !== "complete",
  );
  const first = filtered.filter(
    (task) =>
      task.status !== "complete" &&
      (task.priority === "high" ||
        task.status === "blocked" ||
        isPast(task.next_follow_up_date || task.due_date)),
  );
  const follow = filtered.filter(
    (task) =>
      task.status !== "complete" &&
      !first.includes(task) &&
      (task.status === "waiting" || Boolean(task.waiting_on) || Boolean(task.next_follow_up_date)),
  );
  const active = filtered.filter((task) => !first.includes(task) && !follow.includes(task));
  const groupedByProject = useMemo(() => {
    const groups = new Map<
      string,
      {
        title: string;
        clientName: string | null;
        tasks: EaTask[];
        attentionCount: number;
      }
    >();
    for (const item of filtered) {
      const key = item.project_id || "general-admin";
      const current = groups.get(key) ?? {
        title: item.project?.name || "General Admin",
        clientName: item.project?.client_name || null,
        tasks: [],
        attentionCount: 0,
      };
      current.tasks.push(item);
      if (first.includes(item)) current.attentionCount += 1;
      groups.set(key, current);
    }
    return Array.from(groups.entries())
      .map(([key, group]) => {
        const taskRank = (task: EaTask) => {
          const deadline = String(task.next_follow_up_date || task.due_date || "").slice(0, 10);
          if ((deadline && deadline < today) || task.status === "blocked") return 0;
          if (task.priority === "high") return 1;
          if (deadline) return 2;
          if (task.status === "waiting" || task.waiting_on) return 3;
          return 4;
        };
        const sortedTasks = [...group.tasks].sort((left, right) => {
          const leftDate = String(left.next_follow_up_date || left.due_date || "9999").slice(0, 10);
          const rightDate = String(right.next_follow_up_date || right.due_date || "9999").slice(
            0,
            10,
          );
          return (
            taskRank(left) - taskRank(right) ||
            leftDate.localeCompare(rightDate) ||
            left.title.localeCompare(right.title)
          );
        });
        const deadlines = group.tasks
          .map((task) => String(task.next_follow_up_date || task.due_date || "").slice(0, 10))
          .filter(Boolean)
          .sort();
        return {
          key,
          ...group,
          tasks: sortedTasks,
          urgencyRank: Math.min(...group.tasks.map(taskRank)),
          earliestDate: deadlines[0] || "9999-12-31",
          overdueCount: group.tasks.filter((task) => {
            const deadline = String(task.next_follow_up_date || task.due_date || "").slice(0, 10);
            return Boolean(deadline && deadline < today);
          }).length,
          blockedCount: group.tasks.filter((task) => task.status === "blocked").length,
          highPriorityCount: group.tasks.filter((task) => task.priority === "high").length,
        };
      })
      .sort(
        (left, right) =>
          left.urgencyRank - right.urgencyRank ||
          left.earliestDate.localeCompare(right.earliestDate) ||
          right.attentionCount - left.attentionCount ||
          Number(left.key === "general-admin") - Number(right.key === "general-admin") ||
          left.title.localeCompare(right.title),
      );
  }, [filtered, first, today]);
  const progress = progressTotal ? Math.round((completedToday.length / progressTotal) * 100) : 0;
  const updateTask = async (task: EaTask, patch: Record<string, unknown>) => {
    try {
      await saveEaWorkspace({
        action: "save_task",
        id: task.id,
        project_id: task.project_id,
        ...patch,
      });
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
      if (patch.mark_complete === true) toast.success("Marked complete");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update this item.");
    }
  };
  const prepareTaskDraft = async (task: EaTask) => {
    const result = await saveEaWorkspace({ action: "prepare_task_draft", id: task.id });
    const refreshed = await qc.fetchQuery({
      queryKey: ["eaWorkspace"],
      queryFn: loadEaWorkspace,
    });
    const updatedTask = refreshed.tasks.find((item) => item.id === task.id) || task;
    onOpen(updatedTask);
    toast.success(
      result?.draft?.reason || "Evidence checked. The draft is ready in Katie approvals.",
    );
  };
  const assignSuggested = async () => {
    setBusy(true);
    try {
      const result = await saveEaWorkspace({ action: "assign_suggested_owners" });
      toast.success(
        `${Number(result.updated || 0)} suggested owner${Number(result.updated || 0) === 1 ? "" : "s"} assigned.`,
      );
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to assign suggested owners.");
    } finally {
      setBusy(false);
    }
  };
  const addItem = async () => {
    if (!newItem.title.trim() || !newItem.project_id) {
      toast.error("Choose a project and enter the item.");
      return;
    }
    setAddBusy(true);
    try {
      await saveEaWorkspace({ action: "add_task", ...newItem });
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
      setNewItem({
        title: "",
        project_id: "",
        assigned_user_id: "",
        due_date: "",
        notes: "",
      });
      setAdding(false);
      toast.success("EA item added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add the item.");
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <div className="mt-6">
      <div className="grid gap-3 md:grid-cols-3">
        <DeskMetric
          label="Do first"
          value={first.length}
          detail="Items that need attention now"
          emphasis
        />
        <DeskMetric label="Open work" value={open.length} detail="Across projects and operations" />
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Morning progress</span>
            <strong className="text-ink">
              {completedToday.length}/{progressTotal}
            </strong>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-brass" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 text-sm text-muted-foreground">{progress}% cleared</div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex w-fit rounded-xl border border-border bg-background p-1 shadow-sm">
            {(["open", "complete", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                className={`rounded-lg px-3 py-1.5 text-sm capitalize ${view === value ? "bg-accent text-ink" : "text-muted-foreground"}`}
              >
                {value === "complete" ? "Completed" : value}
              </button>
            ))}
          </div>
          <div className="inline-flex w-fit rounded-xl border border-border bg-background p-1 shadow-sm">
            {(["project", "priority"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setGrouping(value)}
                className={`rounded-lg px-3 py-1.5 text-sm ${grouping === value ? "bg-accent text-ink" : "text-muted-foreground"}`}
              >
                By {value}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
          >
            <option value="all">All owners</option>
            {ownerFilterProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.full_name || profile.email}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={assignSuggested}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" /> Assign suggested owners
          </button>
          <button
            type="button"
            onClick={() => setAdding((value) => !value)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-ink bg-background px-4 text-sm font-medium text-ink"
          >
            <Plus className="h-4 w-4" /> Add item
          </button>
        </div>
      </div>

      {adding && (
        <section className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="eyebrow">New EA item</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Add it directly to the Morning Desk. Nothing is sent.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-sm text-muted-foreground"
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Item" className="md:col-span-2">
              <Input
                value={newItem.title}
                onChange={(event) =>
                  setNewItem((prior) => ({ ...prior, title: event.target.value }))
                }
                placeholder="What needs to be done?"
              />
            </Field>
            <Field label="Project">
              <select
                value={newItem.project_id}
                onChange={(event) =>
                  setNewItem((prior) => ({ ...prior, project_id: event.target.value }))
                }
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">Choose project…</option>
                {projects
                  .filter((project) => project.status !== "Complete")
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Owner">
              <select
                value={newItem.assigned_user_id}
                onChange={(event) =>
                  setNewItem((prior) => ({ ...prior, assigned_user_id: event.target.value }))
                }
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">Unassigned</option>
                {ownerFilterProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.full_name || profile.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note (optional)" className="md:col-span-2 lg:col-span-3">
              <Input
                value={newItem.notes}
                onChange={(event) =>
                  setNewItem((prior) => ({ ...prior, notes: event.target.value }))
                }
                placeholder="Any context worth keeping"
              />
            </Field>
            <Field label="Due date (optional)">
              <Input
                type="date"
                value={newItem.due_date}
                onChange={(event) =>
                  setNewItem((prior) => ({ ...prior, due_date: event.target.value }))
                }
              />
            </Field>
          </div>
          <button
            type="button"
            disabled={addBusy}
            onClick={addItem}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {addBusy ? "Adding…" : "Add to Morning Desk"}
          </button>
        </section>
      )}

      <p className="mt-5 text-sm text-muted-foreground">
        Action items from marvinbotai@gmail.com, the EA Agent, and items you add are shown here.
        Fathom transcripts are used as project knowledge, not turned into action items.
      </p>
      {grouping === "project" ? (
        groupedByProject.length ? (
          <div className="mt-7 space-y-7">
            {groupedByProject.map((group) => (
              <TaskGroup
                key={group.key}
                title={group.clientName ? `${group.title} · ${group.clientName}` : group.title}
                tasks={group.tasks}
                profiles={ownerFilterProfiles}
                onOpen={onOpen}
                onUpdate={updateTask}
                onPrepareDraft={prepareTaskDraft}
                attentionCount={group.attentionCount}
                summary={
                  group.overdueCount
                    ? `${group.overdueCount} overdue`
                    : group.blockedCount
                      ? `${group.blockedCount} blocked`
                      : group.highPriorityCount
                        ? `${group.highPriorityCount} high priority`
                        : group.earliestDate !== "9999-12-31"
                          ? `Due ${formatDate(group.earliestDate)}`
                          : "No due date"
                }
                collapsible
                defaultCollapsed
                compactSpacing
              />
            ))}
          </div>
        ) : (
          <div className="mt-7 rounded-2xl border border-dashed border-border bg-background p-8 text-center text-sm text-muted-foreground">
            No items match these filters.
          </div>
        )
      ) : (
        <>
          <TaskGroup
            title="Do first"
            tasks={first}
            profiles={ownerFilterProfiles}
            onOpen={onOpen}
            onUpdate={updateTask}
            onPrepareDraft={prepareTaskDraft}
          />
          <TaskGroup
            title={view === "complete" ? "Completed" : "Active project items"}
            tasks={active}
            profiles={ownerFilterProfiles}
            onOpen={onOpen}
            onUpdate={updateTask}
            onPrepareDraft={prepareTaskDraft}
          />
          {view !== "complete" && (
            <TaskGroup
              title="Follow-ups to track"
              tasks={follow}
              profiles={ownerFilterProfiles}
              onOpen={onOpen}
              onUpdate={updateTask}
              onPrepareDraft={prepareTaskDraft}
            />
          )}
        </>
      )}
    </div>
  );
}

function DeskMetric({
  label,
  value,
  detail,
  emphasis = false,
}: {
  label: string;
  value: number;
  detail: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm ${emphasis ? "border-ink bg-ink text-primary-foreground" : "border-border bg-card text-ink"}`}
    >
      <div
        className={`text-sm ${emphasis ? "text-primary-foreground/70" : "text-muted-foreground"}`}
      >
        {label}
      </div>
      <div className="mt-2 text-4xl font-semibold tracking-tight">{value}</div>
      <div
        className={`mt-3 text-sm ${emphasis ? "text-primary-foreground/70" : "text-muted-foreground"}`}
      >
        {detail}
      </div>
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  profiles,
  onOpen,
  onUpdate,
  onPrepareDraft,
  attentionCount = 0,
  summary,
  collapsible = false,
  defaultCollapsed = false,
  compactSpacing = false,
}: {
  title: string;
  tasks: EaTask[];
  profiles: Array<{ id: string; email: string; full_name: string }>;
  onOpen: (task: EaTask, artifactKind?: SeedArtifactKind | null) => void;
  onUpdate: (task: EaTask, patch: Record<string, unknown>) => Promise<void>;
  onPrepareDraft: (task: EaTask) => Promise<void>;
  attentionCount?: number;
  summary?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  compactSpacing?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (!tasks.length) return null;
  const heading = (
    <>
      {collapsible &&
        (collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ))}
      <h2 className="text-left text-lg font-semibold text-ink">{title}</h2>
      <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">
        {tasks.length}
      </span>
      {attentionCount > 0 && (
        <span className="rounded-full bg-ink px-2 py-0.5 text-xs text-primary-foreground">
          {attentionCount} do first
        </span>
      )}
      {summary && (
        <span className="ml-auto text-xs font-medium text-muted-foreground">{summary}</span>
      )}
    </>
  );
  return (
    <section className={compactSpacing ? "" : "mt-7"}>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          className="mb-3 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent/60"
        >
          {heading}
        </button>
      ) : (
        <div className="mb-3 flex items-center gap-2">{heading}</div>
      )}
      {!collapsed && (
        <div className="space-y-3">
          {tasks.map((task) => (
            <MorningTaskCard
              key={task.id}
              task={task}
              profiles={profiles}
              onOpen={(artifactKind) => onOpen(task, artifactKind)}
              onUpdate={(patch) => onUpdate(task, patch)}
              onPrepareDraft={() => onPrepareDraft(task)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MorningTaskCard({
  task,
  profiles,
  onOpen,
  onUpdate,
  onPrepareDraft,
}: {
  task: EaTask;
  profiles: Array<{ id: string; email: string; full_name: string }>;
  onOpen: (artifactKind?: SeedArtifactKind) => void;
  onUpdate: (patch: Record<string, unknown>) => Promise<void>;
  onPrepareDraft: () => Promise<void>;
}) {
  const [answerBusy, setAnswerBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [answer, setAnswer] = useState<EaTaskAnswer | null>(null);
  const due = task.next_follow_up_date || task.due_date;
  const suggested = !task.assigned_user_id ? task.recommended_assignee : null;
  const nextAction =
    task.ea_next_action ||
    cleanTaskText(task.internal_notes) ||
    (["ea_email", "ea_fathom"].includes(task.source_type || "")
      ? task.title
      : cleanTaskText(task.notes)) ||
    task.title;
  const findPossibleAnswer = async () => {
    setAnswerBusy(true);
    setAnswer(null);
    try {
      const result = await saveEaWorkspace({
        action: "find_task_answer",
        id: task.id,
        project_id: task.project_id,
      });
      setAnswer(result.answer as EaTaskAnswer);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to search project email and transcripts.",
      );
    } finally {
      setAnswerBusy(false);
    }
  };
  const prepareDraft = async () => {
    setDraftBusy(true);
    try {
      await onPrepareDraft();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to prepare the email draft.");
    } finally {
      setDraftBusy(false);
    }
  };
  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <button
            type="button"
            aria-label={
              task.status === "complete"
                ? `${task.title} is complete`
                : `Mark ${task.title} complete`
            }
            disabled={task.status === "complete"}
            onClick={() => onUpdate({ mark_complete: true })}
            className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
              task.status === "complete"
                ? "border-[#73806b] bg-[#73806b] text-white"
                : "border-border bg-background hover:border-[#73806b] hover:bg-[#73806b]/10"
            }`}
          >
            {task.status === "complete" && <Check className="h-3.5 w-3.5" />}
          </button>
          <div className="min-w-0 flex-1 text-left">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-brass">
              {task.source_type === "ea_fathom"
                ? "Fathom"
                : task.source_type === "ea_manual"
                  ? "Added item"
                  : "Email"}
            </span>
            <span className="block text-lg font-semibold text-ink">
              {task.project?.name || "General Admin"}
              {task.title.toLowerCase().includes(task.project?.name?.toLowerCase() || "__")
                ? ""
                : ` · ${task.title}`}
            </span>
            {nextAction !== task.title && (
              <span className="mt-1 block text-sm leading-6 text-foreground">{nextAction}</span>
            )}
            <span className="mt-2 block text-sm text-muted-foreground">
              <strong className="font-medium text-foreground">Why open:</strong> {reasonOpen(task)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {due && (
            <span
              className={`rounded-full border px-3 py-1.5 text-xs ${isPast(due) ? "border-amber-200 bg-amber-50 text-amber-900" : "border-border text-muted-foreground"}`}
            >
              {isPast(due) ? "Overdue · " : "Due · "}
              {formatDate(due)}
            </span>
          )}
          <select
            aria-label={`Owner for ${task.title}`}
            value={task.assigned_user_id ?? ""}
            onChange={(event) => onUpdate({ assigned_user_id: event.target.value || null })}
            className="h-9 rounded-xl border border-border bg-background px-2 text-xs"
          >
            <option value="">Unassigned</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.full_name || profile.email}
              </option>
            ))}
          </select>
          <select
            aria-label={`Status for ${task.title}`}
            value={task.status}
            onChange={(event) => onUpdate({ status: event.target.value })}
            className="h-9 rounded-xl border border-border bg-background px-2 text-xs"
          >
            <option value="open">To do</option>
            <option value="ready">Ready</option>
            <option value="in_progress">In progress</option>
            <option value="waiting">Waiting</option>
            <option value="blocked">Blocked</option>
            {task.status === "complete" && <option value="complete">Complete</option>}
          </select>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {suggested && (
            <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-bone px-3 py-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Suggested:{" "}
              {suggested.full_name || suggested.email}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onUpdate({ status: "cancelled" })}
            className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900"
          >
            Not needed
          </button>
          {isAppointmentTask(task) && (
            <button
              type="button"
              onClick={() => onOpen()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium"
            >
              <CalendarDays className="h-3.5 w-3.5" /> Calendar
            </button>
          )}
          {task.project_id && (
            <button
              type="button"
              disabled={answerBusy}
              onClick={findPossibleAnswer}
              className="inline-flex items-center gap-1.5 rounded-xl border border-brass bg-brass/10 px-3 py-2 text-xs font-medium disabled:opacity-50"
            >
              {answerBusy ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              {answerBusy ? "Scanning evidence…" : "Find answer & evidence"}
            </button>
          )}
          <button
            type="button"
            disabled={draftBusy}
            onClick={prepareDraft}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium disabled:opacity-50"
          >
            {draftBusy && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
            {draftBusy ? "Researching…" : task.work_artifact_text ? "Refresh draft" : "Draft email"}
          </button>
          <button
            type="button"
            onClick={() => onOpen("action_plan")}
            className="rounded-xl border border-border px-3 py-2 text-xs font-medium"
          >
            Create action plan
          </button>
        </div>
      </div>
      {answer?.task_id === task.id && <PossibleAnswerPanel answer={answer} />}
    </article>
  );
}

function PossibleAnswerPanel({ answer }: { answer: EaTaskAnswer }) {
  return (
    <div className="mt-4 rounded-xl border border-brass/40 bg-bone p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brass" />
          <span className="text-sm font-semibold text-ink">Possible answer</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
            answer.confidence === "high"
              ? "bg-emerald-100 text-emerald-800"
              : answer.confidence === "medium"
                ? "bg-amber-100 text-amber-900"
                : "bg-stone-200 text-stone-700"
          }`}
        >
          {answer.confidence} confidence
        </span>
      </div>
      {answer.potential_answer ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">
          {answer.potential_answer}
        </p>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          I could not find a supported answer in this project’s construction documents, connected
          emails, or Fathom transcripts.
        </p>
      )}
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{answer.confidence_reason}</p>
      {answer.suggested_response && (
        <div className="mt-4 rounded-lg bg-background p-3">
          <div className="eyebrow mb-2">Suggested response</div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
            {answer.suggested_response}
          </p>
        </div>
      )}
      {answer.evidence.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="eyebrow mb-2">Evidence</div>
          <div className="grid gap-2 md:grid-cols-2">
            {answer.evidence.map((item) => {
              if (item.source_type === "document") {
                return <DocumentEvidenceCard key={item.id} item={item} />;
              }
              const content = (
                <>
                  <span className="block text-sm font-medium text-ink">
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-brass">
                      {item.source_type === "fathom" ? "Fathom" : "Email"}
                    </span>
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {[item.author_name || item.author_email, formatDateTime(item.occurred_at)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-foreground">
                    {item.support}
                  </span>
                </>
              );
              return item.source_url ? (
                <a
                  key={item.id}
                  href={item.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-border bg-background p-3 transition-colors hover:bg-card"
                >
                  {content}
                </a>
              ) : (
                <div key={item.id} className="rounded-lg border border-border bg-background p-3">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentEvidenceCard({ item }: { item: DocumentEvidenceItem }) {
  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    if (!item.document_id || !item.page_number) return;
    loadEaDocumentEvidence(item.document_id, item.page_number)
      .then((url) => {
        objectUrl = url;
        if (active) setImageUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch((error) => {
        if (active) {
          setImageError(error instanceof Error ? error.message : "Evidence preview unavailable.");
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.document_id, item.page_number]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3 p-3">
        <div>
          <div className="text-sm font-medium text-ink">
            <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-brass">
              Construction document
            </span>
            {item.title}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            PDF page {item.page_number} · {item.support}
          </div>
        </div>
        {item.source_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-ink underline underline-offset-4"
          >
            Open full PDF <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="border-t border-border bg-stone-100">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${item.title}, PDF page ${item.page_number}`}
            className="max-h-[720px] w-full object-contain"
          />
        ) : imageError ? (
          <div className="p-4 text-xs text-amber-900">{imageError}</div>
        ) : (
          <div className="flex h-44 items-center justify-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" /> Rendering evidence page…
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalQueue({ tasks, onOpen }: { tasks: EaTask[]; onOpen: (task: EaTask) => void }) {
  const qc = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const pending = tasks.filter((task) => task.approval_status === "pending");
  const deleteApproval = async (task: EaTask) => {
    const confirmed = window.confirm(
      `Remove this draft from Katie approvals?\n\n${task.title}\n\nThe EA task will remain open.`,
    );
    if (!confirmed) return;
    setDeletingId(task.id);
    try {
      await saveEaWorkspace({ action: "delete_approval", id: task.id });
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
      toast.success("Approval removed. The EA task is still open.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove this approval.");
    } finally {
      setDeletingId(null);
    }
  };
  return (
    <section className="mt-7">
      <h2 className="text-2xl font-semibold tracking-tight text-ink">Katie approval queue</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Automatic drafts are saved privately in Studio—not Gmail—and arrive here for Katie to
        review. Approval records the decision only; nothing is sent or scheduled.
      </p>
      {pending.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-10 text-sm text-muted-foreground">
          No drafts are waiting for Katie.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {pending.map((task) => (
            <article
              key={task.id}
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <button
                type="button"
                onClick={() => onOpen(task)}
                className="block w-full p-5 text-left hover:bg-accent/30"
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brass">
                  {task.work_artifact_kind?.replace("_", " ") || "Work draft"}
                </span>
                <span className="mt-2 block text-lg font-semibold">
                  {task.project?.name || "General Admin"} · {task.title}
                </span>
                <span className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {task.work_artifact_text || "Open to review the draft."}
                </span>
              </button>
              <div className="flex justify-end border-t border-border px-5 py-3">
                <button
                  type="button"
                  disabled={deletingId === task.id}
                  onClick={() => deleteApproval(task)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-red-200 hover:bg-red-50 hover:text-red-800 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingId === task.id ? "Deleting…" : "Delete approval"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CalendarWorkspace({
  tasks,
  data,
  loading,
  error,
  onRefresh,
}: {
  tasks: EaTask[];
  data?: EaCalendarData;
  loading: boolean;
  error: unknown;
  onRefresh: () => Promise<void>;
}) {
  const scheduling = tasks.filter(
    (task) =>
      /schedule|calendar|meeting|call|zoom|appointment/i.test(
        [task.title, task.notes, task.ea_next_action].filter(Boolean).join(" "),
      ) || Boolean(task.next_follow_up_date),
  );
  const events = useMemo(() => data?.events ?? [], [data?.events]);
  const [refreshing, setRefreshing] = useState(false);
  const [calendarView, setCalendarView] = useState<"calendar" | "agenda">("calendar");
  const month = useMemo(() => calendarMonth(new Date()), []);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, EaCalendarEvent[]>();
    for (const event of events) {
      const key = calendarDateKey(event.start_at);
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }
    return grouped;
  }, [events]);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
      toast.success("Apple Calendar is current.");
    } catch (refreshError) {
      toast.error(
        refreshError instanceof Error ? refreshError.message : "Unable to refresh Apple Calendar.",
      );
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <section className="mt-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Calendar handoffs</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Scheduling work from Studio, shown in Arizona time.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || refreshing}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium"
        >
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} />
          Refresh calendars
        </button>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {["Katie", "Ken", "FAMILY"].map((calendar) => (
          <div key={calendar} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span
                className={`h-2.5 w-2.5 rounded-full ${calendar === "Katie" ? "bg-brass" : calendar === "Ken" ? "bg-ink" : "bg-[#73806b]"}`}
              />
              {calendar === "FAMILY" ? "Family" : calendar}
            </div>
            <div className="mt-2 text-2xl font-semibold text-ink">
              {events.filter((event) => event.calendar === calendar).length}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">next 30 days</div>
          </div>
        ))}
      </div>
      {(error || data?.message) && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error instanceof Error
            ? error.message
            : data?.message || "Apple Calendar is not available."}
        </div>
      )}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">
            {calendarView === "calendar" ? month.label : "Upcoming"}
          </h3>
          {data?.refreshed_at && (
            <span className="text-xs text-muted-foreground">
              Updated{" "}
              {new Date(data.refreshed_at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        <div className="inline-flex w-fit rounded-xl border border-border bg-bone p-1">
          <button
            type="button"
            onClick={() => setCalendarView("calendar")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              calendarView === "calendar"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setCalendarView("agenda")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              calendarView === "agenda"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            Agenda
          </button>
        </div>
      </div>
      {loading && !events.length ? (
        <div className="mt-4 rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground shadow-sm">
          Reading Katie, Ken, and Family from Apple Calendar…
        </div>
      ) : calendarView === "calendar" ? (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-7 border-b border-border bg-bone/60">
              {calendarWeekdays.map((day) => (
                <div
                  key={day}
                  className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                >
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {month.days.map((day) => {
                const dayEvents = eventsByDate.get(day.key) ?? [];
                return (
                  <div
                    key={day.key}
                    className={`min-h-32 border-b border-r border-border p-2 ${
                      day.inMonth ? "bg-card" : "bg-bone/35"
                    }`}
                  >
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                        day.isToday
                          ? "bg-ink text-background"
                          : day.inMonth
                            ? "text-ink"
                            : "text-muted-foreground/50"
                      }`}
                    >
                      {day.day}
                    </div>
                    <div className="mt-1 space-y-1">
                      {dayEvents.slice(0, 3).map((event) => (
                        <div
                          key={`${event.calendar}-${event.id}-${event.start_at}`}
                          title={`${event.title}${event.location ? ` · ${event.location}` : ""}`}
                          className={`truncate rounded-md border-l-2 px-1.5 py-1 text-[10px] font-medium leading-tight ${calendarEventColor(event)}`}
                        >
                          <span className="mr-1 opacity-70">{calendarEventTime(event)}</span>
                          {event.title}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="px-1 text-[10px] font-medium text-muted-foreground">
                          +{dayEvents.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : events.length ? (
        <div className="mt-4 space-y-2">
          {events.slice(0, 40).map((event) => (
            <div
              key={`${event.calendar}-${event.id}-${event.start_at}`}
              className="grid gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm sm:grid-cols-[150px_1fr_auto] sm:items-center"
            >
              <div className="text-sm font-medium text-muted-foreground">
                {calendarEventDate(event)}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{event.title}</div>
                {event.location && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {event.location}
                  </div>
                )}
              </div>
              <span className="w-fit rounded-full bg-bone px-2.5 py-1 text-xs text-muted-foreground">
                {event.calendar === "FAMILY" ? "Family" : event.calendar}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
          No upcoming events were found on Katie, Ken, or Family.
        </div>
      )}
      <h3 className="mt-7 text-lg font-semibold">
        Scheduling queue{" "}
        <span className="ml-1 rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">
          {scheduling.length}
        </span>
      </h3>
      <div className="mt-3 space-y-3">
        {scheduling.length ? (
          scheduling.map((task) => (
            <div key={task.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="font-semibold">
                {task.project?.name || "General Admin"} · {task.title}
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {task.ea_next_action ||
                  cleanTaskText(task.notes) ||
                  "Confirm the scheduling details and next handoff."}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
            No scheduling items are currently open.
          </div>
        )}
      </div>
    </section>
  );
}

function reasonOpen(task: EaTask) {
  if (["ea_email", "ea_fathom", "ea_manual"].includes(task.source_type || "") && task.notes)
    return cleanTaskText(task.notes);
  if (task.status === "blocked") return "The item is blocked and needs a new handoff.";
  if (task.status === "waiting" || task.waiting_on)
    return "The next answer is still owed by someone else.";
  if (isPast(task.next_follow_up_date || task.due_date))
    return "The recorded due or follow-up date has passed.";
  return "Studio shows this as active work that has not been checked off yet.";
}

function cleanTaskText(value: string | null | undefined) {
  return String(value ?? "")
    .split(/\s+(?:Project:|Open comment:|Open board:|Comment ID:)/i)[0]
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .slice(0, 320);
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Phoenix",
    }).format(new Date()),
  );
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

function longDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Phoenix",
  }).format(value);
}

function calendarEventDate(event: EaCalendarEvent) {
  const start = new Date(event.start_at);
  if (event.all_day) {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "America/Phoenix",
    }).format(start);
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Phoenix",
  }).format(start);
}

const calendarWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function calendarDateKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Phoenix",
  }).format(new Date(value));
}

function calendarMonth(reference: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    timeZone: "America/Phoenix",
  }).formatToParts(reference);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - first.getUTCDay());
  const today = calendarDateKey(reference);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1,
      isToday: key === today,
    };
  });
  return {
    label: new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(first),
    days,
  };
}

function calendarEventTime(event: EaCalendarEvent) {
  if (event.all_day) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Phoenix",
  }).format(new Date(event.start_at));
}

function calendarEventColor(event: EaCalendarEvent) {
  if (event.calendar === "Katie") return "border-brass bg-brass/10 text-ink";
  if (event.calendar === "Ken") return "border-ink bg-ink/5 text-ink";
  return "border-[#73806b] bg-[#73806b]/10 text-ink";
}

function calendarEventsForTask(task: EaTask, events: EaCalendarEvent[]) {
  const taskText = [task.project?.name, task.title, task.notes, task.ea_next_action]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const ignored = new Set([
    "and",
    "calendar",
    "call",
    "check",
    "confirm",
    "design",
    "for",
    "meeting",
    "project",
    "the",
    "with",
  ]);
  const words = new Set(
    taskText
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !ignored.has(word)),
  );
  return events.filter((event) => {
    const eventText = `${event.title} ${event.location || ""}`.toLowerCase();
    const projectName = String(task.project?.name || "").toLowerCase();
    if (projectName.length >= 4 && eventText.includes(projectName)) return true;
    const overlap = Array.from(words).filter((word) => eventText.includes(word));
    const taskDate = task.next_follow_up_date || task.due_date;
    const eventDate = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/Phoenix",
    }).format(new Date(event.start_at));
    if (taskDate === eventDate && overlap.length >= 1) return true;
    return overlap.length >= 2;
  });
}

function artifactTemplate(
  task: EaTask,
  kind: SeedArtifactKind,
  calendarEvents: EaCalendarEvent[] = [],
  calendarLoading = false,
) {
  const project = task.project?.name || "General Admin";
  const matchingEvents = calendarEventsForTask(task, calendarEvents).slice(0, 3);
  const calendarCheck = calendarLoading
    ? "Apple Calendar is still loading. Check Katie, Ken, and Family before sending."
    : matchingEvents.length
      ? matchingEvents
          .map(
            (event) =>
              `${event.calendar === "FAMILY" ? "Family" : event.calendar} · ${calendarEventDate(event)} · ${event.title}`,
          )
          .join("\n")
      : "No matching event was found on Katie, Ken, or Family in the next 30 days.";
  return kind === "email_draft"
    ? `INTERNAL CALENDAR CHECK — REMOVE BEFORE SENDING\n${calendarCheck}\n\nSubject: ${project} — ${task.title}\n\nHi,\n\nI’m following up regarding ${task.ea_next_action || cleanTaskText(task.notes) || task.title}. Could you please confirm the current status and next step?\n\nThank you,`
    : `ACTION PLAN — ${project} · ${task.title}\n\nCALENDAR CHECK\n${calendarCheck}\n\n☐ Confirm the responsible person\n☐ Review the source and latest Studio status\n☐ Check Katie, Ken, and Family for conflicts or an existing event\n☐ Complete the next action or record the blocker\n☐ Set the next follow-up date\n☐ Add a note if useful, then mark complete`;
}

function isAppointmentTask(task: EaTask) {
  return /schedule|calendar|meeting|appointment|zoom|\bcall\b/i.test(
    [task.title, task.notes, task.ea_next_action].filter(Boolean).join(" "),
  );
}

function taskAppointmentDefaults(task: EaTask) {
  const text = [task.notes, task.ea_next_action, task.title].filter(Boolean).join(" ");
  const timeMatch = text.match(/\b(1[0-2]|0?\d)(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  let hour = 9;
  let minute = 0;
  if (timeMatch) {
    hour = Number(timeMatch[1]) % 12;
    minute = Number(timeMatch[2] || 0);
    if (timeMatch[3].toLowerCase().startsWith("p")) hour += 12;
  }
  const endMinutes = hour * 60 + minute + 60;
  const assigned = `${task.assigned_user?.email || ""} ${task.assigned_user?.full_name || ""}`;
  const calendar = /\bken\b/i.test(assigned) ? "Ken" : /family/i.test(text) ? "FAMILY" : "Katie";
  return {
    appointment_calendar: calendar,
    appointment_title: `${task.project?.name || "Appointment"} · ${task.title.replace(/^Confirm\s+/i, "")}`,
    appointment_date: task.next_follow_up_date || task.due_date || calendarDateKey(new Date()),
    appointment_start_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    appointment_end_time: `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
    appointment_location: "",
    detectedTime: Boolean(timeMatch),
  };
}

function calendarEventTimeValue(event: EaCalendarEvent) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Phoenix",
  }).formatToParts(new Date(event.start_at));
  return `${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value}`;
}

function TaskDialog({
  task,
  initialArtifactKind,
  calendarEvents,
  calendarLoading,
  canReviewApprovals,
  onClose,
}: {
  task: EaTask | null;
  initialArtifactKind: SeedArtifactKind | null;
  calendarEvents: EaCalendarEvent[];
  calendarLoading: boolean;
  canReviewApprovals: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const appointmentDefaults = task ? taskAppointmentDefaults(task) : null;
  const current = task
    ? {
        relevant_contact_id: task.relevant_contact_id ?? "",
        waiting_contact_id: task.waiting_contact_id ?? "",
        ea_next_action: task.ea_next_action ?? "",
        next_follow_up_date: task.next_follow_up_date ?? "",
        completion_evidence: task.completion_evidence ?? "",
        work_artifact_kind: task.work_artifact_kind ?? initialArtifactKind ?? "work_note",
        work_artifact_text:
          task.work_artifact_text ||
          (initialArtifactKind
            ? artifactTemplate(task, initialArtifactKind, calendarEvents, calendarLoading)
            : ""),
        approval_status: task.approval_status ?? "draft",
        acknowledged: Boolean(task.acknowledged_at),
        ...appointmentDefaults,
        ...form,
      }
    : null;
  const matchingAppointment =
    task && current && appointmentDefaults?.detectedTime
      ? calendarEventsForTask(task, calendarEvents).find(
          (event) =>
            calendarDateKey(event.start_at) === String(current.appointment_date) &&
            calendarEventTimeValue(event) === String(current.appointment_start_time),
        )
      : undefined;
  const set = (key: string, value: string | boolean) =>
    setForm((prior) => ({ ...prior, [key]: value }));
  const seedArtifact = (kind: "email_draft" | "action_plan") => {
    if (!task) return;
    set("work_artifact_kind", kind);
    set("work_artifact_text", artifactTemplate(task, kind, calendarEvents, calendarLoading));
  };
  const prepareDetailedDraft = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const result = await saveEaWorkspace({ action: "prepare_task_draft", id: task.id });
      const context = result?.draft?.context;
      if (context) {
        setForm((prior) => ({
          ...prior,
          relevant_contact_id: context.relevant_contact_id ?? "",
          waiting_contact_id: context.waiting_contact_id ?? "",
          ea_next_action: context.ea_next_action ?? "",
          work_artifact_kind: context.work_artifact_kind ?? "email_draft",
          work_artifact_text: context.work_artifact_text ?? "",
          approval_status: context.approval_status ?? "pending",
        }));
      }
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
      toast.success(result?.draft?.reason || "Evidence checked and draft prepared.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to prepare the email draft.");
    } finally {
      setBusy(false);
    }
  };
  const save = async (complete = false, approvalStatus?: string) => {
    if (!task || !current) return;
    setBusy(true);
    try {
      await saveEaWorkspace({
        action: "save_task",
        id: task.id,
        project_id: task.project_id,
        ...current,
        ...(approvalStatus ? { approval_status: approvalStatus } : {}),
        mark_complete: complete,
      });
      toast.success(
        complete
          ? "Follow-up completed"
          : approvalStatus === "pending"
            ? "Sent to Katie’s approval queue"
            : approvalStatus === "approved"
              ? "Draft approved"
              : approvalStatus === "changes_requested"
                ? "Changes requested"
                : "Follow-up updated",
      );
      await qc.invalidateQueries({ queryKey: ["eaWorkspace"] });
      setForm({});
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save follow-up.");
    } finally {
      setBusy(false);
    }
  };
  const confirmAppointment = async () => {
    if (!task || !current) return;
    setBusy(true);
    let eventWasAdded = false;
    try {
      const calendarResult = matchingAppointment
        ? { created: false, event: matchingAppointment }
        : await createEaCalendarEvent({
            task_id: task.id,
            calendar: String(current.appointment_calendar) as "Katie" | "Ken" | "FAMILY",
            title: String(current.appointment_title),
            date: String(current.appointment_date),
            start_time: String(current.appointment_start_time),
            end_time: String(current.appointment_end_time),
            location: String(current.appointment_location || "") || null,
          });
      const event = calendarResult.event;
      eventWasAdded = calendarResult.created;
      const calendarName = event.calendar === "FAMILY" ? "Family" : event.calendar;
      const calendarEvidence = `Calendar entry recorded on ${calendarName}: ${event.title} · ${calendarEventDate(event)}`;
      await saveEaWorkspace({
        action: "save_task",
        id: task.id,
        project_id: task.project_id,
        relevant_contact_id: current.relevant_contact_id,
        waiting_contact_id: current.waiting_contact_id,
        ea_next_action: current.ea_next_action,
        next_follow_up_date: current.next_follow_up_date,
        completion_evidence: current.completion_evidence
          ? `${current.completion_evidence}\n${calendarEvidence}`
          : calendarEvidence,
        acknowledged: current.acknowledged,
        work_artifact_kind: current.work_artifact_kind,
        work_artifact_text: current.work_artifact_text,
        approval_status: current.approval_status,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["eaWorkspace"] }),
        qc.invalidateQueries({ queryKey: ["eaCalendar"] }),
      ]);
      toast.success(
        !calendarResult.created
          ? "Existing calendar event confirmed. The EA task is still open."
          : "Added to Apple Calendar. The EA task is still open until you reply.",
      );
      setForm({});
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to confirm the appointment.";
      toast.error(
        eventWasAdded
          ? `The calendar event was added, but Studio could not record it on the open task: ${message}`
          : message,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) {
          setForm({});
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="eyebrow mb-2">Task tools</div>
          <DialogTitle className="font-display text-3xl">{task?.title}</DialogTitle>
        </DialogHeader>
        {current && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {task && isAppointmentTask(task) && (
              <div className="md:col-span-2 rounded-xl border border-brass/40 bg-brass/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Label className="eyebrow">Calendar entry</Label>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Adding this does not message anyone and keeps the EA task open. Complete the
                      task only after you have replied that you are good to go.
                    </p>
                  </div>
                  {matchingAppointment && (
                    <span className="rounded-full bg-[#73806b]/10 px-2.5 py-1 text-xs font-medium text-[#55604f]">
                      Matching event found
                    </span>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Calendar">
                    <select
                      value={String(current.appointment_calendar)}
                      onChange={(event) => set("appointment_calendar", event.target.value)}
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="Katie">Katie</option>
                      <option value="Ken">Ken</option>
                      <option value="FAMILY">Family</option>
                    </select>
                  </Field>
                  <Field label="Date">
                    <Input
                      type="date"
                      value={String(current.appointment_date)}
                      onChange={(event) => set("appointment_date", event.target.value)}
                    />
                  </Field>
                  <Field label="Starts">
                    <Input
                      type="time"
                      value={String(current.appointment_start_time)}
                      onChange={(event) => set("appointment_start_time", event.target.value)}
                    />
                  </Field>
                  <Field label="Ends">
                    <Input
                      type="time"
                      value={String(current.appointment_end_time)}
                      onChange={(event) => set("appointment_end_time", event.target.value)}
                    />
                  </Field>
                  <Field label="Appointment title" className="sm:col-span-2">
                    <Input
                      value={String(current.appointment_title)}
                      onChange={(event) => set("appointment_title", event.target.value)}
                    />
                  </Field>
                  <Field label="Location or meeting link" className="sm:col-span-2">
                    <Input
                      value={String(current.appointment_location)}
                      onChange={(event) => set("appointment_location", event.target.value)}
                      placeholder="Optional"
                    />
                  </Field>
                </div>
                {matchingAppointment && (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Already on{" "}
                    {matchingAppointment.calendar === "FAMILY"
                      ? "Family"
                      : matchingAppointment.calendar}
                    : {matchingAppointment.title} · {calendarEventDate(matchingAppointment)}
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={confirmAppointment}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  <CalendarDays className="h-4 w-4" />
                  {matchingAppointment
                    ? "Confirm existing event & keep task open"
                    : "Add to calendar & keep task open"}
                </button>
              </div>
            )}
            <div className="md:col-span-2 rounded-xl border border-border bg-bone p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="eyebrow">Work note, email draft, or action plan</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={prepareDetailedDraft}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
                  >
                    {busy ? "Researching…" : "Research & refresh draft"}
                  </button>
                  <button
                    type="button"
                    onClick={() => seedArtifact("action_plan")}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
                  >
                    Create action plan
                  </button>
                </div>
              </div>
              <select
                value={String(current.work_artifact_kind)}
                onChange={(event) => set("work_artifact_kind", event.target.value)}
                className="mt-3 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="work_note">Work note</option>
                <option value="email_draft">Email draft</option>
                <option value="action_plan">Action plan</option>
              </select>
              <Textarea
                rows={8}
                value={String(current.work_artifact_text)}
                onChange={(event) => set("work_artifact_text", event.target.value)}
                className="mt-3 bg-background"
                placeholder="Prepare the work here. Nothing is sent automatically."
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Approval records the decision in Studio. It does not send an email. Confirmed
                appointments use the calendar section above.
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {task?.link_url && (
            <a
              href={task.link_url}
              target="_blank"
              rel="noreferrer"
              className="mr-auto inline-flex items-center gap-2 border border-border px-4 py-2 text-sm"
            >
              <ExternalLink className="h-4 w-4" /> Source
            </a>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => save(false)}
            className="border border-ink px-4 py-2 text-sm"
          >
            Save
          </button>
          {current?.work_artifact_text && current.approval_status !== "pending" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => save(false, "pending")}
              className="rounded-lg border border-brass px-4 py-2 text-sm text-foreground"
            >
              Add to Katie approvals
            </button>
          )}
          {current?.approval_status === "pending" && canReviewApprovals && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => save(false, "changes_requested")}
                className="rounded-lg border border-amber-300 px-4 py-2 text-sm text-amber-900"
              >
                Request changes
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => save(false, "approved")}
                className="rounded-lg bg-ink px-4 py-2 text-sm text-primary-foreground"
              >
                Approve
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="eyebrow">{label}</Label>
      {children}
    </div>
  );
}
function ProjectFact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <p className="text-sm leading-5">{value || "Needs confirmation"}</p>
    </div>
  );
}
function Routing({ name, text }: { name: string; text: string }) {
  return (
    <div>
      <span className="font-medium">{name}: </span>
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}
function StatusPill({ status }: { status: string }) {
  const label = status === "on_hold" ? "On hold" : status === "completed" ? "Completed" : "Active";
  return (
    <span
      className={`px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${status === "active" ? "bg-emerald-50 text-emerald-800" : status === "on_hold" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}
    >
      {label}
    </span>
  );
}
function SetupNotice() {
  return (
    <div className="mt-6 rounded-2xl border border-brass/40 bg-background p-4 text-sm text-muted-foreground">
      Some EA tools are still in local preview. Notes, drafts, approvals, and directory changes will
      become persistent after local setup is completed.
    </div>
  );
}
function isPast(value: string | null) {
  return Boolean(value && value < new Date().toISOString().slice(0, 10));
}
function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function EmailInbox({ emails, loading }: { emails: EaProjectEmail[]; loading: boolean }) {
  return (
    <section className="mt-10 border-t border-border pt-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">Project communications</div>
          <h2 className="font-display text-3xl">Recent project emails</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Confirmed project-linked emails from Studio Marvin. Unmatched and general inbox mail
            stays private and does not appear here.
          </p>
        </div>
        <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
      </div>

      {loading ? (
        <div className="py-10 text-sm text-muted-foreground">Loading project emails…</div>
      ) : emails.length === 0 ? (
        <div className="mt-5 border border-dashed border-border p-6 text-sm text-muted-foreground">
          No confirmed project emails are available yet. Marvin must sync the mailbox and link an
          email to a project before it appears here.
        </div>
      ) : (
        <div className="mt-5 divide-y divide-border border-y border-border">
          {emails.map((email) => (
            <article key={email.id} className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{email.author_name || email.author_email || "Unknown sender"}</span>
                  {email.occurred_at && <span>{formatDateTime(email.occurred_at)}</span>}
                  {email.projects.map((project) => (
                    <span key={project.id} className="border border-border px-2 py-0.5 text-ink">
                      {project.name}
                    </span>
                  ))}
                </div>
                <h3 className="mt-2 text-sm font-medium">{email.title}</h3>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground">
                  {email.summary ||
                    (email.processing_status === "ready"
                      ? "No summary is available."
                      : "Marvin is still preparing this email.")}
                </p>
              </div>
              {email.source_url && (
                <a
                  href={email.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-2 self-start border border-border px-3 text-xs hover:border-ink"
                >
                  Open source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatInboxLastUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unavailable";
  const today = new Date();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `today at ${time}`;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SyncCard({
  rows,
}: {
  rows: Array<{
    provider: string;
    account_email: string | null;
    status: string;
    last_sync_at: string | null;
    last_error: string | null;
    updated_at: string;
    metadata?: Record<string, unknown> | null;
  }>;
}) {
  return (
    <div className="border border-border p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow mb-2">Email freshness</div>
          <h2 className="font-display text-3xl">Studio Marvin sources</h2>
        </div>
        <Mail className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        This reports Studio’s existing Gmail/Fathom connections. It does not imply the external
        Morning Desk fetched new mail.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href="https://merav-morning-desk.kroberts035.chatgpt.site"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs hover:border-ink"
        >
          Open existing Morning Desk <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="mt-5 space-y-2">
        {rows.length === 0 ? (
          <div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
            No accessible sync status. Existing Morning Desk remains external until its source and
            persistence are verified.
          </div>
        ) : (
          rows.map((row, index) => (
            <div
              key={`${row.provider}-${index}`}
              className="flex items-center justify-between border border-border p-3 text-sm"
            >
              <span>
                <span className="capitalize">{row.provider}</span>
                {row.account_email && (
                  <span className="ml-2 text-xs text-muted-foreground">{row.account_email}</span>
                )}
                {row.account_email === "marvinbotai@gmail.com" &&
                  (row.metadata?.blue_sky_drive_needs_reconnect === true ? (
                    <span className="mt-1 block text-xs text-amber-700">
                      Blue Sky Drive needs one read-only reconnect
                    </span>
                  ) : Number(row.metadata?.blue_sky_drive_promoted || 0) > 0 ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Blue Sky Drive · {Number(row.metadata?.blue_sky_drive_promoted || 0)} PDFs
                      ready
                    </span>
                  ) : null)}
              </span>
              <span className={row.last_error ? "text-red-700" : "text-muted-foreground"}>
                {row.last_error
                  ? "Needs attention"
                  : row.last_sync_at
                    ? `Synced ${new Date(row.last_sync_at).toLocaleString()}`
                    : row.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
