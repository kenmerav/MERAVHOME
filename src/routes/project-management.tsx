import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  ListChecks,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Project } from "@/lib/db";
import {
  PROJECT_CAPABILITIES,
  calculateProjectMetrics,
  differenceInCalendarDays,
  formatShortDate,
  healthLabel,
  localDateKey,
  rankProjectTasks,
  taskIsDependencyLocked,
  type ProjectHealth,
  type ProjectManagementData,
  type ProjectManagementEmployee,
  type ProjectMilestone,
  type ProjectTask,
  type ProjectTaskStatus,
} from "@/lib/projectManagement";
import { toast } from "sonner";

export const Route = createFileRoute("/project-management")({
  head: () => ({ meta: [{ title: "Project Command Center - MERAV Studio" }] }),
  component: ProjectManagementPage,
});

type CommandTab = "portfolio" | "my-work" | "tasks" | "workload" | "setup";

function ProjectManagementPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<CommandTab>("portfolio");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [setupProject, setSetupProject] = useState<Project | null>(null);
  const [planProject, setPlanProject] = useState<Project | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskProjectId, setTaskProjectId] = useState<string>("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["projectManagement"],
    queryFn: loadProjectManagement,
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data: userData }) => setProfileId(userData.user?.id ?? null));
  }, []);

  const commandData = data ?? emptyData();
  const ownerIdsByProject = useMemo(
    () => groupIds(commandData.owners, "project_id", "user_id"),
    [commandData.owners],
  );
  const milestonesByProject = useMemo(
    () => groupBy(commandData.milestones, "project_id"),
    [commandData.milestones],
  );
  const tasksByProject = useMemo(
    () => groupBy(commandData.tasks, "project_id"),
    [commandData.tasks],
  );
  const metricsByProject = useMemo(
    () =>
      new Map(
        commandData.projects.map((project) => [
          project.id,
          calculateProjectMetrics(
            project,
            milestonesByProject.get(project.id) ?? [],
            tasksByProject.get(project.id) ?? [],
            undefined,
            ownerIdsByProject.get(project.id)?.length ?? 0,
          ),
        ]),
      ),
    [commandData.projects, milestonesByProject, ownerIdsByProject, tasksByProject],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["projectManagement"] });
  const openTask = (projectId = "") => {
    setTaskProjectId(projectId);
    setTaskDialogOpen(true);
  };

  return (
    <AppShell>
      <div className="page-pad max-w-[1600px]">
        <header className="mb-8 flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="eyebrow mb-2">Internal Operations</div>
            <h1 className="font-display text-5xl lg:text-6xl">Project Command Center</h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Deadlines, progress, blockers, ownership, and the next work that should move each
              project forward.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openTask()}
              className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2.5 text-sm text-white"
            >
              <Plus className="h-4 w-4" /> Add Task
            </button>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-10 w-10 items-center justify-center border border-border"
              title="Refresh command center"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </header>

        <CommandSummary data={commandData} metrics={metricsByProject} />

        <div className="mt-8 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
          {(
            [
              ["portfolio", "Portfolio"],
              ["my-work", "My Work"],
              ["tasks", "All Tasks"],
              ["workload", "Workload"],
              ["setup", "Needs Setup"],
            ] as Array<[CommandTab, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-xs uppercase tracking-[0.16em] ${tab === value ? "border-ink text-ink" : "border-transparent text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {data?.setupNeeded && (
          <div className="mt-6 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            Apply <code>20260714100000_add_project_command_center.sql</code> in Supabase before the
            Command Center can save data.
          </div>
        )}
        {error && (
          <div className="mt-6 border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error instanceof Error ? error.message : "Unable to load project management."}
          </div>
        )}

        <div className="mt-6">
          {isLoading ? (
            <div className="py-20 text-sm text-muted-foreground">Loading project plans...</div>
          ) : tab === "portfolio" ? (
            <PortfolioTable
              data={commandData}
              metrics={metricsByProject}
              ownerIdsByProject={ownerIdsByProject}
              onSetup={setSetupProject}
              onOpen={setPlanProject}
            />
          ) : tab === "my-work" ? (
            <MyWorkView data={commandData} profileId={profileId} onOpenProject={setPlanProject} />
          ) : tab === "tasks" ? (
            <AllTasksView data={commandData} onChanged={refresh} onAddTask={openTask} />
          ) : tab === "workload" ? (
            <WorkloadView data={commandData} onChanged={refresh} />
          ) : (
            <NeedsSetupView
              data={commandData}
              metrics={metricsByProject}
              onSetup={setSetupProject}
            />
          )}
        </div>
      </div>

      <ProjectSetupDialog
        project={setupProject}
        data={commandData}
        onClose={() => setSetupProject(null)}
        onSaved={refresh}
      />
      <ProjectPlanDialog
        project={planProject}
        data={commandData}
        onClose={() => setPlanProject(null)}
        onChanged={refresh}
        onAddTask={openTask}
        onConfigure={(project) => {
          setPlanProject(null);
          setSetupProject(project);
        }}
      />
      <TaskDialog
        open={taskDialogOpen}
        initialProjectId={taskProjectId}
        data={commandData}
        onOpenChange={setTaskDialogOpen}
        onSaved={refresh}
      />
    </AppShell>
  );
}

function CommandSummary({
  data,
  metrics,
}: {
  data: ProjectManagementData;
  metrics: Map<string, ReturnType<typeof calculateProjectMetrics>>;
}) {
  const atRisk = data.projects.filter((project) =>
    ["at_risk", "critical", "late"].includes(metrics.get(project.id)?.displayHealth ?? ""),
  ).length;
  const overdue = data.tasks.filter(
    (task) =>
      task.due_date &&
      task.due_date < todayKey() &&
      !["complete", "cancelled", "suggested"].includes(task.status),
  ).length;
  const blocked = data.tasks.filter((task) => task.status === "blocked").length;
  const unassigned = data.tasks.filter(
    (task) => !task.assigned_user_id && !["complete", "cancelled"].includes(task.status),
  ).length;
  return (
    <div className="grid grid-cols-2 border border-border md:grid-cols-4">
      <SummaryStat label="Projects at risk" value={atRisk} icon={AlertTriangle} />
      <SummaryStat label="Overdue tasks" value={overdue} icon={Clock3} />
      <SummaryStat label="Blocked" value={blocked} icon={CircleDot} />
      <SummaryStat label="Need assignment" value={unassigned} icon={Users} />
    </div>
  );
}

function SummaryStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof AlertTriangle;
}) {
  return (
    <div className="border-b border-r border-border p-4 last:border-r-0 md:border-b-0">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-2 font-display text-3xl">{value}</div>
    </div>
  );
}

function PortfolioTable({
  data,
  metrics,
  ownerIdsByProject,
  onSetup,
  onOpen,
}: {
  data: ProjectManagementData;
  metrics: Map<string, ReturnType<typeof calculateProjectMetrics>>;
  ownerIdsByProject: Map<string, string[]>;
  onSetup: (project: Project) => void;
  onOpen: (project: Project) => void;
}) {
  const employeeById = new Map(data.employees.map((employee) => [employee.id, employee]));
  const sorted = [...data.projects].sort(
    (a, b) =>
      healthRank(metrics.get(a.id)?.displayHealth) - healthRank(metrics.get(b.id)?.displayHealth) ||
      (a.promised_completion_date ?? "9999").localeCompare(b.promised_completion_date ?? "9999"),
  );
  if (!sorted.length)
    return (
      <EmptyMessage title="No active projects" body="Active Studio projects will appear here." />
    );
  const rows = sorted.map((project) => ({
    project,
    value: metrics.get(project.id)!,
    owners: (ownerIdsByProject.get(project.id) ?? [])
      .map((id) => employeeById.get(id)?.full_name)
      .filter(Boolean),
  }));
  return (
    <>
      <div className="hidden border border-border lg:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[17%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
            <col className="w-[16%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[22%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead className="bg-bone/50 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Project</th>
              <th className="px-3 py-3">Health</th>
              <th className="px-3 py-3">Turnaround</th>
              <th className="px-3 py-3">Timeline</th>
              <th className="px-3 py-3">Progress</th>
              <th className="px-3 py-3">Owners</th>
              <th className="px-3 py-3">Current work</th>
              <th className="px-3 py-3">Waiting</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ project, value, owners }) => (
              <tr key={project.id} className="align-top hover:bg-bone/20">
                <td className="min-w-0 px-4 py-4">
                  <button type="button" onClick={() => onOpen(project)} className="max-w-full text-left">
                    <div className="break-words font-medium">{project.name}</div>
                    <div className="break-words text-xs text-muted-foreground">
                      {project.client_name} · {project.status}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => (value.setupMissing.length ? onSetup(project) : onOpen(project))}
                    className="mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-4"
                  >
                    {value.setupMissing.length ? "Set up" : "Open"}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </td>
                <td className="px-3 py-4">
                  <HealthBadge health={value.displayHealth} />
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {formatDaysRemaining(value.daysRemaining)}
                  </div>
                </td>
                <td className="break-words px-3 py-4 text-xs">
                  {project.turnaround_speed || "Not set"}
                </td>
                <td className="px-3 py-4 text-xs">
                  <PortfolioTimeline project={project} />
                </td>
                <td className="px-3 py-4">
                  <PortfolioProgress project={project} value={value} />
                </td>
                <td className="break-words px-3 py-4 text-xs">
                  {owners.join(", ") || "Not assigned"}
                </td>
                <td className="min-w-0 px-3 py-4 text-xs">
                  <PortfolioCurrentWork value={value} />
                </td>
                <td className="break-words px-3 py-4 text-xs capitalize">
                  {value.waitingOn || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border border border-border lg:hidden">
        {rows.map(({ project, value, owners }) => (
          <section key={project.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <button type="button" onClick={() => onOpen(project)} className="min-w-0 text-left">
                <div className="break-words font-medium">{project.name}</div>
                <div className="break-words text-xs text-muted-foreground">
                  {project.client_name} · {project.status}
                </div>
              </button>
              <div className="shrink-0 text-right">
                <HealthBadge health={value.displayHealth} />
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {formatDaysRemaining(value.daysRemaining)}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 text-xs">
              <div>
                <div className="eyebrow mb-1">Timeline</div>
                <PortfolioTimeline project={project} />
              </div>
              <div>
                <div className="eyebrow mb-1">Turnaround</div>
                <div>{project.turnaround_speed || "Not set"}</div>
                <div className="eyebrow mb-1 mt-3">Owners</div>
                <div className="break-words">{owners.join(", ") || "Not assigned"}</div>
              </div>
              <div className="col-span-2">
                <div className="eyebrow mb-1">Progress</div>
                <PortfolioProgress project={project} value={value} />
              </div>
              <div className="col-span-2 border-t border-border pt-3">
                <div className="eyebrow mb-1">Current work</div>
                <PortfolioCurrentWork value={value} />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-3 text-xs">
              <span className="capitalize text-muted-foreground">
                Waiting on: {value.waitingOn || "-"}
              </span>
              <button
                type="button"
                onClick={() => (value.setupMissing.length ? onSetup(project) : onOpen(project))}
                className="inline-flex items-center gap-1 underline underline-offset-4"
              >
                {value.setupMissing.length ? "Set up" : "Open"}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function PortfolioTimeline({ project }: { project: Project }) {
  return (
    <div className="space-y-1">
      <div><span className="text-muted-foreground">Accepted:</span> {formatShortDate(project.accepted_date)}</div>
      <div><span className="text-muted-foreground">Promised:</span> {formatShortDate(project.promised_completion_date)}</div>
      <div>
        <span className="text-muted-foreground">Forecast:</span>{" "}
        {formatShortDate(project.forecast_completion_date)}
      </div>
      {project.forecast_completion_date && project.promised_completion_date && (
        <div
          className={project.forecast_completion_date > project.promised_completion_date ? "text-red-700" : "text-muted-foreground"}
        >
          {formatForecastVariance(
            project.forecast_completion_date,
            project.promised_completion_date,
          )}
        </div>
      )}
    </div>
  );
}

function PortfolioProgress({
  project,
  value,
}: {
  project: Project;
  value: ReturnType<typeof calculateProjectMetrics>;
}) {
  return (
    <div className="w-full max-w-36">
      <div className="mb-1 flex justify-between gap-2 text-xs">
        <span>{value.displayProgress}%</span>
        {project.progress_override != null && (
          <span className="text-muted-foreground">Auto {value.automaticProgress}%</span>
        )}
      </div>
      <div className="h-1.5 bg-bone">
        <div className="h-full bg-ink" style={{ width: `${value.displayProgress}%` }} />
      </div>
    </div>
  );
}

function PortfolioCurrentWork({
  value,
}: {
  value: ReturnType<typeof calculateProjectMetrics>;
}) {
  const assignee =
    value.nextTask?.assigned_user?.full_name || value.nextTask?.assigned_user?.email;
  return (
    <div className="space-y-2">
      <div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Milestone</div>
        <div className="break-words">{value.nextMilestone?.title || "None"}</div>
        {value.nextMilestone && (
          <div className="text-muted-foreground">
            {formatShortDate(value.nextMilestone.target_date)}
          </div>
        )}
      </div>
      <div className="border-t border-border pt-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Current task</div>
        <div className="break-words">{value.nextTask?.title || "No ready task"}</div>
        {value.nextTask && (
          <div className="mt-1 break-words text-muted-foreground">
            Assigned to: {assignee || "Unassigned"}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDaysRemaining(daysRemaining: number | null) {
  if (daysRemaining == null) return "No deadline";
  if (daysRemaining < 0) return `${Math.abs(daysRemaining)}d late`;
  return `${daysRemaining}d left`;
}

function MyWorkView({
  data,
  profileId,
  onOpenProject,
}: {
  data: ProjectManagementData;
  profileId: string | null;
  onOpenProject: (project: Project) => void;
}) {
  const [employeeId, setEmployeeId] = useState(profileId ?? "");
  useEffect(() => {
    if (profileId && !employeeId) setEmployeeId(profileId);
  }, [employeeId, profileId]);
  const tasks = data.tasks.filter((task) => task.assigned_user_id === employeeId);
  const ranked = rankProjectTasks(tasks);
  const blocked = tasks.filter(
    (task) =>
      task.status === "blocked" ||
      task.status === "waiting" ||
      Boolean(task.waiting_on) ||
      taskIsDependencyLocked(task, new Map(data.tasks.map((item) => [item.id, item]))),
  );
  const projectById = new Map(data.projects.map((project) => [project.id, project]));
  const employee = data.employees.find((item) => item.id === employeeId);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <div className="eyebrow">Prioritized Queue</div>
            <h2 className="font-display text-3xl">Next Up</h2>
            {employee && (
              <div className="mt-1 text-xs text-muted-foreground">
                {employee.scheduled_hours}h scheduled /{" "}
                {employee.work_profile?.weekly_capacity_hours ?? 30}h weekly capacity
              </div>
            )}
          </div>
          <select
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            className="h-10 border border-input bg-background px-3 text-sm"
          >
            <option value="">Choose employee</option>
            {data.employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.full_name || employee.email}
              </option>
            ))}
          </select>
        </div>
        <div className="divide-y divide-border border border-border">
          {ranked.length ? (
            ranked.map(({ task, reason }, index) => (
              <TaskQueueRow
                key={task.id}
                index={index + 1}
                task={task}
                reason={reason}
                project={projectById.get(task.project_id)}
                onOpenProject={onOpenProject}
              />
            ))
          ) : (
            <div className="p-8 text-sm text-muted-foreground">
              No ready tasks for this employee.
            </div>
          )}
        </div>
      </section>
      <section className="border border-border bg-bone/20 p-5">
        <div className="eyebrow mb-2">Waiting / Blocked</div>
        <h2 className="font-display text-2xl">Cannot move yet</h2>
        <div className="mt-4 space-y-3">
          {blocked.length ? (
            blocked.map((task) => (
              <div key={task.id} className="border border-border bg-background p-3">
                <div className="text-sm font-medium">{task.title}</div>
                <div className="mt-1 text-xs capitalize text-muted-foreground">
                  {task.waiting_on
                    ? `Waiting on ${task.waiting_on}`
                    : task.status === "blocked"
                      ? "Blocked"
                      : "Dependency not complete"}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nothing is blocked.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function TaskQueueRow({
  index,
  task,
  reason,
  project,
  onOpenProject,
}: {
  index: number;
  task: ProjectTask;
  reason: string;
  project?: Project;
  onOpenProject: (project: Project) => void;
}) {
  return (
    <div className="grid grid-cols-[36px_1fr_auto] gap-3 p-4">
      <div className="font-display text-2xl text-muted-foreground">{index}</div>
      <div>
        <div className="font-medium">{task.title}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {project?.name || "Project"} · {reason} ·{" "}
          {task.estimated_hours ? `${task.estimated_hours}h estimated` : "No estimate"}
          {task.actual_hours ? ` · ${task.actual_hours}h logged` : ""}
        </div>
      </div>
      {project && (
        <button
          type="button"
          onClick={() => onOpenProject(project)}
          className="text-xs underline underline-offset-4"
        >
          Open project
        </button>
      )}
    </div>
  );
}

function AllTasksView({
  data,
  onChanged,
  onAddTask,
}: {
  data: ProjectManagementData;
  onChanged: () => void;
  onAddTask: (projectId?: string) => void;
}) {
  const [projectFilter, setProjectFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [blockerFilter, setBlockerFilter] = useState("all");
  const projectById = new Map(data.projects.map((project) => [project.id, project]));
  const taskById = new Map(data.tasks.map((task) => [task.id, task]));
  const today = todayKey();
  const tasks = data.tasks.filter((task) => {
    const dueInDays = task.due_date ? differenceInCalendarDays(task.due_date, today) : null;
    const matchesDue =
      dueFilter === "all" ||
      (dueFilter === "overdue" && dueInDays != null && dueInDays < 0) ||
      (dueFilter === "soon" && dueInDays != null && dueInDays >= 0 && dueInDays <= 3) ||
      (dueFilter === "none" && !task.due_date);
    const dependencyLocked = taskIsDependencyLocked(task, taskById);
    const matchesBlocker =
      blockerFilter === "all" ||
      (blockerFilter === "blocked" && (task.status === "blocked" || dependencyLocked)) ||
      (blockerFilter === "waiting" && Boolean(task.waiting_on)) ||
      (blockerFilter === "outside" && task.visibility === "assigned_external");
    return (
      (projectFilter === "all" || task.project_id === projectFilter) &&
      (employeeFilter === "all" ||
        task.assigned_user_id === employeeFilter ||
        (employeeFilter === "unassigned" && !task.assigned_user_id)) &&
      (statusFilter === "all" ||
        (statusFilter === "active"
          ? !["complete", "cancelled"].includes(task.status)
          : task.status === statusFilter)) &&
      (priorityFilter === "all" || task.priority === priorityFilter) &&
      matchesDue &&
      matchesBlocker
    );
  });
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            label="Project"
            value={projectFilter}
            onChange={setProjectFilter}
            options={[
              { value: "all", label: "All projects" },
              ...data.projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
          <FilterSelect
            label="Employee"
            value={employeeFilter}
            onChange={setEmployeeFilter}
            options={[
              { value: "all", label: "All employees" },
              { value: "unassigned", label: "Unassigned" },
              ...data.employees.map((employee) => ({
                value: employee.id,
                label: employee.full_name || employee.email,
              })),
            ]}
          />
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "active", label: "Active" },
              { value: "suggested", label: "Suggestions" },
              { value: "blocked", label: "Blocked" },
              { value: "waiting", label: "Waiting" },
              { value: "complete", label: "Complete" },
              { value: "all", label: "All" },
            ]}
          />
          <FilterSelect
            label="Priority"
            value={priorityFilter}
            onChange={setPriorityFilter}
            options={[
              { value: "all", label: "All priorities" },
              { value: "high", label: "High" },
              { value: "normal", label: "Normal" },
              { value: "low", label: "Low" },
            ]}
          />
          <FilterSelect
            label="Due"
            value={dueFilter}
            onChange={setDueFilter}
            options={[
              { value: "all", label: "Any date" },
              { value: "overdue", label: "Overdue" },
              { value: "soon", label: "Due in 3 days" },
              { value: "none", label: "No due date" },
            ]}
          />
          <FilterSelect
            label="Blocker"
            value={blockerFilter}
            onChange={setBlockerFilter}
            options={[
              { value: "all", label: "All work" },
              { value: "blocked", label: "Blocked / locked" },
              { value: "waiting", label: "Waiting on someone" },
              { value: "outside", label: "Outside requests" },
            ]}
          />
        </div>
        <button
          type="button"
          onClick={() => onAddTask(projectFilter === "all" ? "" : projectFilter)}
          className="inline-flex items-center gap-2 border border-ink px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" /> Add Task
        </button>
      </div>
      <div className="divide-y divide-border border border-border">
        {tasks.length ? (
          tasks.map((task) => (
            <TaskManagementRow
              key={task.id}
              task={task}
              projectName={projectById.get(task.project_id)?.name || "Project"}
              employees={data.employees}
              onChanged={onChanged}
            />
          ))
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No tasks match these filters.
          </div>
        )}
      </div>
    </section>
  );
}

function TaskManagementRow({
  task,
  projectName,
  employees,
  onChanged,
}: {
  task: ProjectTask;
  projectName: string;
  employees: ProjectManagementEmployee[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await commandRequest("PATCH", { action: "task", id: task.id, patch });
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div
        className={`grid gap-3 p-4 lg:grid-cols-[1fr_170px_140px_145px_90px_auto] lg:items-center ${task.status === "suggested" ? "bg-[#f8f4ea]" : ""}`}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{task.title}</span>
            {task.is_pinned && (
              <span className="text-[10px] uppercase tracking-[0.14em]">Pinned</span>
            )}
            {task.status === "suggested" && (
              <span className="bg-ink px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white">
                Suggestion
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {projectName}
            {task.notes ? ` · ${task.notes}` : ""}
          </div>
          {task.recommended_assignee && !task.assigned_user_id && (
            <div className="mt-1 text-xs">
              Recommended: {task.recommended_assignee.full_name || task.recommended_assignee.email}
            </div>
          )}
        </div>
        <select
          disabled={busy}
          value={task.assigned_user_id ?? ""}
          onChange={(event) =>
            save({
              assigned_user_id: event.target.value || null,
              status: event.target.value && task.status === "suggested" ? "ready" : task.status,
            })
          }
          className="h-9 border border-input bg-background px-2 text-xs"
        >
          <option value="">Unassigned</option>
          {task.assigned_user_id &&
            !employees.some((employee) => employee.id === task.assigned_user_id) && (
              <option value={task.assigned_user_id}>
                {task.assigned_user?.full_name || task.assigned_user?.email || "Outside assignee"}{" "}
                (Outside)
              </option>
            )}
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.full_name || employee.email}
            </option>
          ))}
        </select>
        <select
          disabled={busy}
          value={task.status}
          onChange={(event) =>
            save({
              status: event.target.value,
              ...(event.target.value === "waiting" ? {} : { waiting_on: null }),
            })
          }
          className="h-9 border border-input bg-background px-2 text-xs"
        >
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {taskStatusLabel(status)}
            </option>
          ))}
        </select>
        <select
          disabled={busy}
          value={task.waiting_on ?? ""}
          onChange={(event) =>
            save({
              waiting_on: event.target.value || null,
              status: event.target.value
                ? "waiting"
                : task.status === "waiting"
                  ? "ready"
                  : task.status,
            })
          }
          className="h-9 border border-input bg-background px-2 text-xs"
        >
          <option value="">Not waiting</option>
          <option value="employee">Waiting on employee</option>
          <option value="client">Waiting on client</option>
          <option value="gc">Waiting on GC</option>
          <option value="vendor">Waiting on vendor</option>
        </select>
        <div className="text-xs text-muted-foreground">
          {task.due_date ? formatShortDate(task.due_date) : "No due date"}
          <br />
          {task.estimated_hours ? `${task.estimated_hours}h est.` : "No estimate"}
          {task.actual_hours ? ` · ${task.actual_hours}h actual` : ""}
        </div>
        <div className="flex justify-end gap-2">
          {task.status === "suggested" && (
            <button
              type="button"
              disabled={busy || !task.recommended_assignee_id}
              onClick={() =>
                save({ status: "ready", assigned_user_id: task.recommended_assignee_id })
              }
              className="inline-flex items-center gap-1 border border-ink bg-ink px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Accept
            </button>
          )}
          {task.status !== "suggested" && (
            <button
              type="button"
              onClick={() => setThreadOpen(true)}
              className="border border-border px-3 py-2 text-xs"
            >
              Discuss
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => save({ is_pinned: !task.is_pinned })}
            className="border border-border px-3 py-2 text-xs"
          >
            {task.is_pinned ? "Unpin" : "Pin"}
          </button>
        </div>
      </div>
      <TaskThreadDialog task={task} open={threadOpen} onOpenChange={setThreadOpen} />
    </>
  );
}

function TaskThreadDialog({
  task,
  open,
  onOpenChange,
}: {
  task: ProjectTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["projectTaskMessages", task.id],
    queryFn: async () => {
      const token = await authToken();
      const response = await fetch(`/api/project-todos?taskId=${encodeURIComponent(task.id)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Unable to load discussion.");
      return body as {
        messages: Array<{
          id: string;
          body: string;
          visibility: "shared" | "internal";
          created_at: string;
          author?: { full_name?: string; email?: string };
        }>;
        attachments: Array<{
          id: string;
          file_name: string;
          signed_url: string | null;
          visibility: "shared" | "internal";
        }>;
      };
    },
    enabled: open,
  });
  const send = async () => {
    if (!message.trim()) return;
    setBusy(true);
    try {
      const token = await authToken();
      const response = await fetch("/api/project-todos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: "message",
          todo_id: task.id,
          message,
          visibility: internal ? "internal" : "shared",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Unable to send message.");
      setMessage("");
      qc.invalidateQueries({ queryKey: ["projectTaskMessages", task.id] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const uploadAttachment = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const token = await authToken();
      const form = new FormData();
      form.set("todo_id", task.id);
      form.set("visibility", internal ? "internal" : "shared");
      form.set("file", file);
      const response = await fetch("/api/project-task-attachment", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Unable to upload attachment.");
      qc.invalidateQueries({ queryKey: ["projectTaskMessages", task.id] });
      toast.success("Attachment added");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="eyebrow">Task Discussion</div>
          <DialogTitle className="font-display text-3xl">{task.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 border-y border-border py-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading discussion...</p>
          ) : data?.messages.length ? (
            data.messages.map((item) => (
              <div
                key={item.id}
                className={`p-3 text-sm ${item.visibility === "internal" ? "border border-amber-200 bg-amber-50" : "border border-border bg-bone/20"}`}
              >
                <div className="mb-1 flex justify-between gap-4 text-xs text-muted-foreground">
                  <span>{item.author?.full_name || item.author?.email || "Studio user"}</span>
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                </div>
                <p>{item.body}</p>
                {item.visibility === "internal" && (
                  <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-amber-800">
                    Internal only
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          )}
          {data?.attachments?.length ? (
            <div className="space-y-2 pt-2">
              <div className="eyebrow">Attachments</div>
              {data.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.signed_url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between border border-border p-3 text-sm hover:border-ink"
                >
                  <span>{attachment.file_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {attachment.visibility === "internal" ? "Internal" : "Open"}
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <Textarea
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Add context, a decision, or a reply..."
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={internal}
            onChange={(event) => setInternal(event.target.checked)}
          />{" "}
          Internal note or attachment, hidden from outside assignees
        </label>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center border border-border px-4 py-2.5 text-sm">
            <input
              type="file"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                void uploadAttachment(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            Attach File
          </label>
          <button
            type="button"
            disabled={busy || !message.trim()}
            onClick={send}
            className="bg-ink px-4 py-2.5 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Saving..." : "Add Message"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkloadView({ data, onChanged }: { data: ProjectManagementData; onChanged: () => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.employees.map((employee) => (
        <EmployeeWorkloadCard key={employee.id} employee={employee} onChanged={onChanged} />
      ))}
    </div>
  );
}

function EmployeeWorkloadCard({
  employee,
  onChanged,
}: {
  employee: ProjectManagementEmployee;
  onChanged: () => void;
}) {
  const [capacity, setCapacity] = useState(
    String(employee.work_profile?.weekly_capacity_hours ?? 30),
  );
  const [tags, setTags] = useState<string[]>(employee.work_profile?.capability_tags ?? []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const weeklyCapacity = Number(employee.work_profile?.weekly_capacity_hours ?? 30);
  const percent =
    weeklyCapacity > 0
      ? Math.min(100, Math.round((employee.scheduled_hours / weeklyCapacity) * 100))
      : 100;
  const save = async () => {
    setBusy(true);
    try {
      await commandRequest("PATCH", {
        action: "work_profile",
        user_id: employee.id,
        weekly_capacity_hours: capacity,
        capability_tags: tags,
      });
      toast.success("Work profile saved");
      setOpen(false);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border border-border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-display text-2xl">{employee.full_name || employee.email}</div>
          <div className="text-xs text-muted-foreground">
            {employee.scheduled_hours}h assigned / {weeklyCapacity}h capacity
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center border border-border"
          title="Edit work profile"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 h-2 bg-bone">
        <div
          className={`h-full ${percent >= 100 ? "bg-red-600" : percent >= 80 ? "bg-amber-500" : "bg-ink"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {employee.work_profile?.capability_tags.length ? (
          employee.work_profile.capability_tags.map((tag) => (
            <span
              key={tag}
              className="border border-border px-2 py-1 text-[10px] uppercase tracking-[0.12em]"
            >
              {tag}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No capabilities configured</span>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">Employee Work Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Weekly capacity hours</Label>
              <Input
                type="number"
                min="0"
                max="168"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
              />
            </div>
            <div>
              <Label>Capabilities</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PROJECT_CAPABILITIES.map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-2 border border-border p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={tags.includes(tag)}
                      onChange={() =>
                        setTags((current) =>
                          current.includes(tag)
                            ? current.filter((value) => value !== tag)
                            : [...current, tag],
                        )
                      }
                    />
                    {tag}
                  </label>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="w-full bg-ink px-4 py-2.5 text-sm text-white"
            >
              {busy ? "Saving..." : "Save Work Profile"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NeedsSetupView({
  data,
  metrics,
  onSetup,
}: {
  data: ProjectManagementData;
  metrics: Map<string, ReturnType<typeof calculateProjectMetrics>>;
  onSetup: (project: Project) => void;
}) {
  const projects = data.projects.filter(
    (project) => (metrics.get(project.id)?.setupMissing.length ?? 0) > 0,
  );
  return (
    <div className="divide-y divide-border border border-border">
      {projects.length ? (
        projects.map((project) => (
          <div
            key={project.id}
            className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"
          >
            <div>
              <div className="font-display text-2xl">{project.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Missing: {metrics.get(project.id)?.setupMissing.join(", ")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSetup(project)}
              className="border border-ink px-4 py-2 text-sm"
            >
              Set Up Project
            </button>
          </div>
        ))
      ) : (
        <EmptyMessage
          title="Every project is configured"
          body="Accepted dates, commitments, owners, and milestone plans are all in place."
        />
      )}
    </div>
  );
}

function ProjectSetupDialog({
  project,
  data,
  onClose,
  onSaved,
}: {
  project: Project | null;
  data: ProjectManagementData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [acceptedDate, setAcceptedDate] = useState("");
  const [promisedDate, setPromisedDate] = useState("");
  const [forecastDate, setForecastDate] = useState("");
  const [speed, setSpeed] = useState("Standard");
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!project) return;
    setAcceptedDate(project.accepted_date ?? "");
    setPromisedDate(project.promised_completion_date ?? "");
    setForecastDate(project.forecast_completion_date ?? "");
    setSpeed(project.turnaround_speed ?? "Standard");
    setOwnerIds(
      data.owners.filter((owner) => owner.project_id === project.id).map((owner) => owner.user_id),
    );
  }, [data.owners, project]);
  const save = async () => {
    if (!project) return;
    if (!acceptedDate || !promisedDate || !ownerIds.length)
      return toast.error("Add the accepted date, promised completion, and at least one owner.");
    setBusy(true);
    try {
      await commandRequest("POST", {
        action: "setup_project",
        project_id: project.id,
        accepted_date: acceptedDate,
        promised_completion_date: promisedDate,
        forecast_completion_date: forecastDate || null,
        turnaround_speed: speed,
        owner_ids: ownerIds,
      });
      toast.success("Project plan configured");
      onClose();
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={Boolean(project)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="eyebrow">Commitment and Ownership</div>
          <DialogTitle className="font-display text-3xl">Set Up {project?.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Accepted Date">
            <Input
              type="date"
              value={acceptedDate}
              onChange={(event) => setAcceptedDate(event.target.value)}
            />
          </Field>
          <Field label="Turnaround">
            <select
              value={speed}
              onChange={(event) => setSpeed(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              {["Standard", "Priority", "Rush", "Custom"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Promised Completion">
            <Input
              type="date"
              value={promisedDate}
              onChange={(event) => setPromisedDate(event.target.value)}
            />
          </Field>
          <Field label="Internal Forecast">
            <Input
              type="date"
              value={forecastDate}
              onChange={(event) => setForecastDate(event.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Label className="eyebrow">Project Owners</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {data.employees.map((employee) => (
                <label
                  key={employee.id}
                  className="flex items-center gap-2 border border-border p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={ownerIds.includes(employee.id)}
                    onChange={() =>
                      setOwnerIds((current) =>
                        current.includes(employee.id)
                          ? current.filter((id) => id !== employee.id)
                          : [...current, employee.id],
                      )
                    }
                  />
                  {employee.full_name || employee.email}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="border border-border bg-bone/20 p-4 text-xs text-muted-foreground">
          If this project has no milestones yet, Studio will create the standard workflow and spread
          target dates across the accepted-to-promised window. Suggested tasks still require review
          before assignment.
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="w-full bg-ink px-4 py-3 text-sm text-white"
        >
          {busy ? "Saving..." : "Save Project Plan"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function ProjectPlanDialog({
  project,
  data,
  onClose,
  onChanged,
  onAddTask,
  onConfigure,
}: {
  project: Project | null;
  data: ProjectManagementData;
  onClose: () => void;
  onChanged: () => void;
  onAddTask: (projectId?: string) => void;
  onConfigure: (project: Project) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  if (!project) return null;
  const milestones = data.milestones
    .filter((milestone) => milestone.project_id === project.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const tasks = data.tasks.filter(
    (task) => task.project_id === project.id && !["complete", "cancelled"].includes(task.status),
  );
  const owners = data.owners.filter((owner) => owner.project_id === project.id);
  const metrics = calculateProjectMetrics(project, milestones, tasks, undefined, owners.length);
  const suggest = async () => {
    setBusy(true);
    try {
      const result = (await commandRequest("POST", {
        action: "suggest_tasks",
        project_id: project.id,
      })) as { created?: number };
      toast.success(result.created ? `${result.created} suggestions added` : "No new suggestions");
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const updateMilestone = async (id: string, patch: Record<string, unknown>) => {
    try {
      await commandRequest("PATCH", { action: "milestone", id, patch });
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const moveMilestone = async (index: number, direction: -1 | 1) => {
    const adjacent = milestones[index + direction];
    const milestone = milestones[index];
    if (!adjacent || !milestone) return;
    setBusy(true);
    try {
      await Promise.all([
        commandRequest("PATCH", {
          action: "milestone",
          id: milestone.id,
          patch: { sort_order: adjacent.sort_order },
        }),
        commandRequest("PATCH", {
          action: "milestone",
          id: adjacent.id,
          patch: { sort_order: milestone.sort_order },
        }),
      ]);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <div className="eyebrow">Project Plan</div>
          <DialogTitle className="font-display text-4xl">{project.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-4">
          <PlanStat label="Health" value={healthLabel(metrics.displayHealth)} />
          <PlanStat
            label="Progress"
            value={`${metrics.displayProgress}%`}
            detail={
              project.progress_override != null
                ? `Automatic ${metrics.automaticProgress}%`
                : undefined
            }
          />
          <PlanStat label="Promised" value={formatShortDate(project.promised_completion_date)} />
          <PlanStat label="Turnaround" value={project.turnaround_speed || "Not set"} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={suggest}
            className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-white"
          >
            <Sparkles className="h-4 w-4" /> {busy ? "Checking..." : "Find Needed Tasks"}
          </button>
          <button
            type="button"
            onClick={() => onAddTask(project.id)}
            className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm"
          >
            <Plus className="h-4 w-4" /> Add Task
          </button>
          <button
            type="button"
            onClick={() => setMilestoneOpen(true)}
            className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm"
          >
            <Plus className="h-4 w-4" /> Add Milestone
          </button>
          <button
            type="button"
            onClick={() => onConfigure(project)}
            className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm"
          >
            <SlidersHorizontal className="h-4 w-4" /> Edit Commitment
          </button>
        </div>
        <ProjectOverrideControls project={project} onChanged={onChanged} />
        <section>
          <div className="eyebrow mb-3">Milestones</div>
          <div className="divide-y divide-border border border-border">
            {milestones.map((milestone, index) => (
              <div
                key={milestone.id}
                className="grid gap-3 p-3 sm:grid-cols-[56px_1fr_150px_145px] sm:items-center"
              >
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => moveMilestone(index, -1)}
                    title="Move milestone earlier"
                    className="inline-flex h-7 w-7 items-center justify-center border border-border disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === milestones.length - 1}
                    onClick={() => moveMilestone(index, 1)}
                    title="Move milestone later"
                    className="inline-flex h-7 w-7 items-center justify-center border border-border disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div>
                  <div className="font-medium">{milestone.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {milestone.stage} · {milestone.weight}% weight{" "}
                    {milestone.is_critical ? "· Critical" : ""}
                  </div>
                </div>
                <select
                  value={milestone.status}
                  onChange={(event) =>
                    updateMilestone(milestone.id, { status: event.target.value })
                  }
                  className="h-9 border border-input bg-background px-2 text-xs"
                >
                  {MILESTONE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <Input
                  type="date"
                  value={milestone.target_date ?? ""}
                  onChange={(event) =>
                    updateMilestone(milestone.id, { target_date: event.target.value || null })
                  }
                  className="h-9"
                />
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="eyebrow mb-3">Active Tasks</div>
          <div className="divide-y divide-border border border-border">
            {tasks.slice(0, 12).map((task) => (
              <TaskManagementRow
                key={task.id}
                task={task}
                projectName={project.name}
                employees={data.employees}
                onChanged={onChanged}
              />
            ))}
            {!tasks.length && (
              <div className="p-6 text-sm text-muted-foreground">No active tasks.</div>
            )}
          </div>
        </section>
        <MilestoneDialog
          open={milestoneOpen}
          projectId={project.id}
          milestones={milestones}
          employees={data.employees}
          onOpenChange={setMilestoneOpen}
          onSaved={onChanged}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProjectOverrideControls({
  project,
  onChanged,
}: {
  project: Project;
  onChanged: () => void;
}) {
  const [progress, setProgress] = useState(
    project.progress_override == null ? "" : String(project.progress_override),
  );
  const [health, setHealth] = useState(project.health_override ?? "");
  const [reason, setReason] = useState(project.health_override_reason ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (health && !reason.trim()) return toast.error("Add a reason for the health override.");
    setBusy(true);
    try {
      await commandRequest("PATCH", {
        action: "project",
        project_id: project.id,
        patch: {
          progress_override: progress === "" ? null : progress,
          health_override: health || null,
          health_override_reason: health ? reason : null,
        },
      });
      toast.success("Management overrides saved");
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="border border-border bg-bone/20 p-4">
      <summary className="cursor-pointer text-xs uppercase tracking-[0.14em]">
        Management Overrides
      </summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-[150px_180px_1fr_auto]">
        <Field label="Progress %">
          <Input
            type="number"
            min="0"
            max="100"
            value={progress}
            onChange={(event) => setProgress(event.target.value)}
            placeholder="Automatic"
          />
        </Field>
        <Field label="Health">
          <select
            value={health}
            onChange={(event) => setHealth(event.target.value as ProjectHealth | "")}
            className="h-10 w-full border border-input bg-background px-3 text-sm"
          >
            <option value="">Calculated</option>
            <option value="on_track">On Track</option>
            <option value="at_risk">At Risk</option>
            <option value="critical">Critical</option>
            <option value="late">Late</option>
          </select>
        </Field>
        <Field label="Override Reason">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={!health}
          />
        </Field>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="self-end bg-ink px-4 py-2.5 text-sm text-white"
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </details>
  );
}

function MilestoneDialog({
  open,
  projectId,
  milestones,
  employees,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  milestones: ProjectMilestone[];
  employees: ProjectManagementEmployee[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("Design");
  const [date, setDate] = useState("");
  const [weight, setWeight] = useState("0");
  const [owner, setOwner] = useState("");
  const [capability, setCapability] = useState("");
  const [dependency, setDependency] = useState("");
  const [critical, setCritical] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim()) return toast.error("Add a milestone title.");
    setBusy(true);
    try {
      await commandRequest("POST", {
        action: "create_milestone",
        project_id: projectId,
        title,
        stage,
        target_date: date || null,
        weight,
        owner_id: owner || null,
        required_capability: capability || null,
        depends_on_milestone_id: dependency || null,
        is_critical: critical,
      });
      toast.success("Milestone added");
      onOpenChange(false);
      setTitle("");
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Add Milestone</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Stage">
            <select
              value={stage}
              onChange={(event) => setStage(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              {["Design", "Presentation", "Approved", "Procurement"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Target Date">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Weight %">
            <Input
              type="number"
              min="0"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            />
          </Field>
          <Field label="Owner">
            <select
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">Unassigned</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name || employee.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Capability">
            <select
              value={capability}
              onChange={(event) => setCapability(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">None</option>
              {PROJECT_CAPABILITIES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Depends On">
            <select
              value={dependency}
              onChange={(event) => setDependency(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">No dependency</option>
              {milestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.title}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 pt-7 text-sm">
            <input
              type="checkbox"
              checked={critical}
              onChange={(event) => setCritical(event.target.checked)}
            />{" "}
            Critical milestone
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="w-full bg-ink px-4 py-2.5 text-sm text-white"
        >
          {busy ? "Adding..." : "Add Milestone"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function TaskDialog({
  open,
  initialProjectId,
  data,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  initialProjectId: string;
  data: ProjectManagementData;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [hours, setHours] = useState("");
  const [priority, setPriority] = useState("normal");
  const [capability, setCapability] = useState("");
  const [waitingOn, setWaitingOn] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [dependencyId, setDependencyId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setProjectId(initialProjectId);
  }, [initialProjectId, open]);
  const projectMilestones = data.milestones.filter(
    (milestone) => milestone.project_id === projectId && milestone.status !== "skipped",
  );
  const projectTasks = data.tasks.filter(
    (task) => task.project_id === projectId && !["complete", "cancelled"].includes(task.status),
  );
  const save = async () => {
    if (!projectId || !title.trim()) return toast.error("Choose a project and add a task title.");
    setBusy(true);
    try {
      await commandRequest("POST", {
        action: "create_task",
        project_id: projectId,
        title,
        notes,
        assigned_user_id: assignee || null,
        due_date: dueDate || null,
        estimated_hours: hours || null,
        priority,
        required_capability: capability || null,
        waiting_on: waitingOn || null,
        milestone_id: milestoneId || null,
        depends_on_todo_id: dependencyId || null,
      });
      toast.success(assignee ? "Task assigned" : "Task saved with an assignment recommendation");
      onOpenChange(false);
      setTitle("");
      setNotes("");
      setAssignee("");
      setDueDate("");
      setHours("");
      setMilestoneId("");
      setDependencyId("");
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="eyebrow">Internal Work</div>
          <DialogTitle className="font-display text-3xl">Add Project Task</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project">
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setMilestoneId("");
                setDependencyId("");
              }}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">Choose project</option>
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned To">
            <select
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">Let Studio recommend</option>
              {data.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name || employee.email}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Task">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Finalize kitchen design-board labels"
              />
            </Field>
          </div>
          <Field label="Milestone">
            <select
              value={milestoneId}
              onChange={(event) => setMilestoneId(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">No milestone</option>
              {projectMilestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Depends On">
            <select
              value={dependencyId}
              onChange={(event) => setDependencyId(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">Ready immediately</option>
              {projectTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due Date">
            <Input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          <Field label="Estimated Hours">
            <Input
              type="number"
              min="0"
              step="0.5"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </Field>
          <Field label="Priority">
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Capability">
            <select
              value={capability}
              onChange={(event) => setCapability(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">None</option>
              {PROJECT_CAPABILITIES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Waiting On">
            <select
              value={waitingOn}
              onChange={(event) => setWaitingOn(event.target.value)}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="">No one</option>
              <option value="employee">Employee</option>
              <option value="client">Client</option>
              <option value="gc">GC / Builder</option>
              <option value="vendor">Vendor</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="w-full bg-ink px-4 py-2.5 text-sm text-white"
        >
          {busy ? "Saving..." : "Save Task"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function HealthBadge({ health }: { health: ProjectHealth }) {
  return (
    <span
      className={`inline-flex px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${healthTone(health)}`}
    >
      {healthLabel(health)}
    </span>
  );
}
function PlanStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="border border-border p-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-display text-2xl">{value}</div>
      {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="eyebrow">{label}</Label>
      {children}
    </div>
  );
}
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 border border-input bg-background px-3 text-xs"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function EmptyMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-dashed border-border p-12 text-center">
      <ListChecks className="mx-auto h-6 w-6 text-muted-foreground" />
      <div className="mt-3 font-display text-2xl">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

const TASK_STATUSES: ProjectTaskStatus[] = [
  "suggested",
  "open",
  "ready",
  "in_progress",
  "waiting",
  "blocked",
  "complete",
  "cancelled",
];
const MILESTONE_STATUSES = ["not_started", "in_progress", "blocked", "complete", "skipped"];

function taskStatusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}
function healthTone(health: ProjectHealth) {
  if (health === "late") return "bg-red-100 text-red-800";
  if (health === "critical") return "bg-[#f3d9d5] text-red-900";
  if (health === "at_risk") return "bg-amber-100 text-amber-900";
  if (health === "needs_setup") return "bg-bone text-muted-foreground";
  return "bg-green-100 text-green-800";
}
function healthRank(health?: ProjectHealth) {
  return health === "late"
    ? 0
    : health === "critical"
      ? 1
      : health === "at_risk"
        ? 2
        : health === "needs_setup"
          ? 3
          : 4;
}
function todayKey() {
  return localDateKey();
}
function formatForecastVariance(forecast: string, promised: string) {
  const days = differenceInCalendarDays(forecast, promised);
  return days === 0
    ? "On promise"
    : days > 0
      ? `${days}d over promise`
      : `${Math.abs(days)}d early`;
}
function groupBy<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = String(row[key]);
    result.set(id, [...(result.get(id) ?? []), row]);
  }
  return result;
}
function groupIds<T extends Record<string, unknown>>(
  rows: T[],
  groupKey: keyof T,
  valueKey: keyof T,
) {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const id = String(row[groupKey]);
    result.set(id, [...(result.get(id) ?? []), String(row[valueKey])]);
  }
  return result;
}
function emptyData(): ProjectManagementData {
  return {
    projects: [],
    owners: [],
    milestones: [],
    dependencies: [],
    tasks: [],
    employees: [],
    time_entries: [],
  };
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to save the change.";
}

async function authToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}
async function loadProjectManagement() {
  const token = await authToken();
  const response = await fetch("/api/project-management", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Unable to load project management.");
  return body as ProjectManagementData;
}
async function commandRequest(method: "POST" | "PATCH", body: unknown) {
  const token = await authToken();
  const response = await fetch("/api/project-management", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || "Unable to save the change.");
  return result;
}
