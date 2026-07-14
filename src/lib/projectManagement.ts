import type { Project, UserProfile } from "@/lib/db";

export type TurnaroundSpeed = "Standard" | "Priority" | "Rush" | "Custom";
export type ProjectHealth = "needs_setup" | "on_track" | "at_risk" | "critical" | "late";
export type MilestoneStatus = "not_started" | "in_progress" | "blocked" | "complete" | "skipped";
export type ProjectTaskStatus =
  | "suggested"
  | "open"
  | "ready"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "complete"
  | "cancelled";
export type WaitingOn = "employee" | "client" | "gc" | "vendor";

export const PROJECT_CAPABILITIES = [
  "project setup",
  "sketchup",
  "design boards",
  "renderings",
  "presentations",
  "client coordination",
  "materials and specs",
  "procurement",
] as const;

export interface ProjectOwner {
  project_id: string;
  user_id: string;
  user?: Pick<UserProfile, "id" | "email" | "full_name" | "role"> | null;
}

export interface ProjectMilestone {
  id: string;
  project_id: string;
  title: string;
  stage: string;
  status: MilestoneStatus;
  target_date: string | null;
  completed_at: string | null;
  weight: number;
  owner_id: string | null;
  required_capability: string | null;
  is_critical: boolean;
  is_custom: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  assigned_user_id: string | null;
  recommended_assignee_id: string | null;
  milestone_id: string | null;
  depends_on_todo_id: string | null;
  title: string;
  notes: string | null;
  internal_notes: string | null;
  link_url: string | null;
  due_date: string | null;
  reminder_date: string | null;
  status: ProjectTaskStatus;
  priority: "low" | "normal" | "high";
  estimated_hours: number | null;
  required_capability: string | null;
  source_type: string | null;
  source_key: string | null;
  visibility: "internal" | "assigned_external";
  waiting_on: WaitingOn | null;
  is_pinned: boolean;
  rank_override: number | null;
  ready_for_review_at: string | null;
  actual_hours?: number;
  created_at: string;
  updated_at: string;
  assigned_user?: Pick<UserProfile, "id" | "email" | "full_name" | "role"> | null;
  recommended_assignee?: Pick<UserProfile, "id" | "email" | "full_name" | "role"> | null;
}

export interface EmployeeWorkProfile {
  user_id: string;
  weekly_capacity_hours: number;
  capability_tags: string[];
  unavailable_until: string | null;
}

export interface ProjectManagementEmployee extends Pick<
  UserProfile,
  "id" | "email" | "full_name" | "role" | "is_active"
> {
  work_profile?: EmployeeWorkProfile | null;
  scheduled_hours: number;
}

export interface ProjectManagementData {
  projects: Project[];
  owners: ProjectOwner[];
  milestones: ProjectMilestone[];
  dependencies: Array<{ milestone_id: string; depends_on_milestone_id: string }>;
  tasks: ProjectTask[];
  employees: ProjectManagementEmployee[];
  time_entries: Array<{
    todo_id: string | null;
    user_id: string;
    hours: number;
    work_date: string;
  }>;
  setupNeeded?: boolean;
}

export interface ProjectMetrics {
  automaticProgress: number;
  displayProgress: number;
  calculatedHealth: ProjectHealth;
  displayHealth: ProjectHealth;
  setupMissing: string[];
  nextMilestone: ProjectMilestone | null;
  nextTask: ProjectTask | null;
  waitingOn: WaitingOn | null;
  daysRemaining: number | null;
}

const CLOSED_TASK_STATUSES = new Set<ProjectTaskStatus>(["complete", "cancelled"]);
const ACTIONABLE_TASK_STATUSES = new Set<ProjectTaskStatus>(["open", "ready", "in_progress"]);

export function calculateProjectProgress(milestones: ProjectMilestone[]) {
  const included = milestones.filter((milestone) => milestone.status !== "skipped");
  const total = included.reduce((sum, milestone) => sum + Number(milestone.weight || 0), 0);
  if (total <= 0) return 0;
  const complete = included
    .filter((milestone) => milestone.status === "complete")
    .reduce((sum, milestone) => sum + Number(milestone.weight || 0), 0);
  return Math.round((complete / total) * 100);
}

export function taskIsDependencyLocked(task: ProjectTask, taskById: Map<string, ProjectTask>) {
  if (!task.depends_on_todo_id) return false;
  return taskById.get(task.depends_on_todo_id)?.status !== "complete";
}

export function rankProjectTasks(tasks: ProjectTask[], today = localDateKey()) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const dependencyCounts = new Map<string, number>();
  for (const task of tasks) {
    if (task.depends_on_todo_id) {
      dependencyCounts.set(
        task.depends_on_todo_id,
        (dependencyCounts.get(task.depends_on_todo_id) ?? 0) + 1,
      );
    }
  }

  return tasks
    .filter(
      (task) =>
        ACTIONABLE_TASK_STATUSES.has(task.status) &&
        !task.waiting_on &&
        !taskIsDependencyLocked(task, taskById),
    )
    .map((task) => ({ task, reason: taskRankReason(task, dependencyCounts, today) }))
    .sort((a, b) => {
      const aRank = taskRankTuple(a.task, dependencyCounts, today);
      const bRank = taskRankTuple(b.task, dependencyCounts, today);
      for (let i = 0; i < aRank.length; i += 1) {
        if (aRank[i] !== bRank[i]) return aRank[i] - bRank[i];
      }
      return a.task.created_at.localeCompare(b.task.created_at);
    });
}

function taskRankTuple(task: ProjectTask, dependencyCounts: Map<string, number>, today: string) {
  const dueInDays = task.due_date ? differenceInCalendarDays(task.due_date, today) : 9999;
  const pinnedRank = task.is_pinned ? 0 : 1;
  const overrideRank = task.rank_override ?? 9999;
  const overdueRank = dueInDays < 0 ? 0 : 1;
  const soonRank = dueInDays >= 0 && dueInDays <= 3 ? 0 : 1;
  const blockerRank = (dependencyCounts.get(task.id) ?? 0) > 0 ? 0 : 1;
  const priorityRank = task.priority === "high" ? 0 : task.priority === "normal" ? 1 : 2;
  return [pinnedRank, overrideRank, overdueRank, soonRank, blockerRank, dueInDays, priorityRank];
}

function taskRankReason(task: ProjectTask, dependencyCounts: Map<string, number>, today: string) {
  if (task.is_pinned) return "Pinned by a manager";
  if (task.due_date && task.due_date < today) return "Overdue";
  if (task.due_date && differenceInCalendarDays(task.due_date, today) <= 3)
    return "Due within three days";
  if ((dependencyCounts.get(task.id) ?? 0) > 0) return "Blocks downstream work";
  return task.due_date ? `Due ${formatShortDate(task.due_date)}` : "Ready to begin";
}

export function calculateProjectMetrics(
  project: Project,
  milestones: ProjectMilestone[],
  tasks: ProjectTask[],
  today = localDateKey(),
  ownerCount = 1,
): ProjectMetrics {
  const setupMissing = [
    !project.accepted_date ? "accepted date" : null,
    !project.promised_completion_date ? "promised completion" : null,
    ownerCount === 0 ? "project owner" : null,
    milestones.length === 0 ? "milestones" : null,
  ].filter((value): value is string => Boolean(value));
  const automaticProgress = calculateProjectProgress(milestones);
  const displayProgress =
    project.progress_override == null
      ? automaticProgress
      : Math.round(Number(project.progress_override));
  const openTasks = tasks.filter(
    (task) => !CLOSED_TASK_STATUSES.has(task.status) && task.status !== "suggested",
  );
  const ranked = rankProjectTasks(openTasks, today);
  const nextMilestone =
    [...milestones]
      .filter((milestone) => !["complete", "skipped"].includes(milestone.status))
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"),
      )[0] ?? null;
  const waitingTask = openTasks
    .filter((task) => task.waiting_on)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))[0];
  const calculatedHealth = calculateHealth(
    project,
    milestones,
    openTasks,
    setupMissing,
    ranked.length,
    today,
  );
  const override = project.health_override as ProjectHealth | null;

  return {
    automaticProgress,
    displayProgress,
    calculatedHealth,
    displayHealth: override ?? calculatedHealth,
    setupMissing,
    nextMilestone,
    nextTask: ranked[0]?.task ?? null,
    waitingOn: waitingTask?.waiting_on ?? null,
    daysRemaining: project.promised_completion_date
      ? differenceInCalendarDays(project.promised_completion_date, today)
      : null,
  };
}

function calculateHealth(
  project: Project,
  milestones: ProjectMilestone[],
  tasks: ProjectTask[],
  setupMissing: string[],
  readyTaskCount: number,
  today: string,
): ProjectHealth {
  if (setupMissing.length) return "needs_setup";
  if (
    project.status !== "Complete" &&
    project.promised_completion_date &&
    project.promised_completion_date < today
  )
    return "late";
  if (
    project.forecast_completion_date &&
    project.promised_completion_date &&
    project.forecast_completion_date > project.promised_completion_date
  )
    return "critical";
  if (tasks.some((task) => task.status === "blocked" && task.priority === "high"))
    return "critical";
  if (
    milestones.some((milestone) => {
      if (!milestone.target_date || ["complete", "skipped"].includes(milestone.status))
        return false;
      return differenceInCalendarDays(today, milestone.target_date) >= 7;
    })
  )
    return "critical";
  if (tasks.some((task) => task.due_date && task.due_date < today)) return "at_risk";
  if (
    milestones.some(
      (milestone) =>
        milestone.target_date &&
        milestone.target_date < today &&
        !["complete", "skipped"].includes(milestone.status),
    )
  )
    return "at_risk";
  if (
    tasks.some(
      (task) => task.status === "waiting" && task.updated_at.slice(0, 10) < addDays(today, -5),
    )
  )
    return "at_risk";
  if (project.status !== "Complete" && readyTaskCount === 0) return "at_risk";
  return "on_track";
}

export function recommendAssignee(
  capability: string | null,
  employees: ProjectManagementEmployee[],
  ownerIds: Set<string>,
) {
  const today = localDateKey();
  const available = employees.filter((employee) => {
    const unavailableUntil = employee.work_profile?.unavailable_until;
    return employee.is_active && (!unavailableUntil || unavailableUntil < today);
  });
  const matching = capability
    ? available.filter((employee) => employee.work_profile?.capability_tags.includes(capability))
    : available;
  const pool = matching.length ? matching : available;
  return (
    [...pool].sort((a, b) => {
      const ownerDifference = Number(!ownerIds.has(a.id)) - Number(!ownerIds.has(b.id));
      if (ownerDifference) return ownerDifference;
      const aCapacity = Number(a.work_profile?.weekly_capacity_hours || 30);
      const bCapacity = Number(b.work_profile?.weekly_capacity_hours || 30);
      const aLoad = aCapacity > 0 ? a.scheduled_hours / aCapacity : Number.POSITIVE_INFINITY;
      const bLoad = bCapacity > 0 ? b.scheduled_hours / bCapacity : Number.POSITIVE_INFINITY;
      return aLoad - bLoad || a.full_name.localeCompare(b.full_name);
    })[0] ?? null
  );
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function differenceInCalendarDays(later: string, earlier: string) {
  const laterDate = new Date(`${later}T12:00:00`);
  const earlierDate = new Date(`${earlier}T12:00:00`);
  return Math.round((laterDate.getTime() - earlierDate.getTime()) / 86_400_000);
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDateKey(value);
}

export function formatShortDate(value: string | null) {
  if (!value) return "Not set";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function healthLabel(health: ProjectHealth) {
  if (health === "needs_setup") return "Needs Setup";
  if (health === "on_track") return "On Track";
  if (health === "at_risk") return "At Risk";
  if (health === "critical") return "Critical";
  return "Late";
}
