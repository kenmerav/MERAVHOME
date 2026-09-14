export type EaProjectHealthStatus = "on_track" | "needs_touch" | "at_risk" | "behind";

export type EaHealthProject = {
  id: string;
  status: string;
  created_at: string | null;
  updated_at: string;
  accepted_date: string | null;
  promised_completion_date: string | null;
  forecast_completion_date: string | null;
  health_override: "on_track" | "at_risk" | "critical" | "late" | null;
  health_override_reason: string | null;
};

export type EaHealthOperation = {
  lifecycle_status: "active" | "on_hold" | "completed";
  follow_up_date: string | null;
} | null;

export type EaHealthTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  waiting_on: string | null;
  assigned_user_id: string | null;
  source_type: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

export type EaHealthMilestone = {
  id: string;
  title: string;
  stage: string;
  status: string;
  target_date: string | null;
  is_critical: boolean;
  sort_order: number;
};

export type EaProjectActivity = {
  id: string;
  kind: "email" | "fathom" | "task";
  title: string;
  occurred_at: string;
  source_url: string | null;
};

export type EaProjectHealth = {
  project_id: string;
  lifecycle_status: "active" | "on_hold" | "completed";
  health: EaProjectHealthStatus;
  reasons: string[];
  missing_info: string[];
  last_touch_at: string | null;
  next_touch_date: string | null;
  overdue_count: number;
  due_next_7_days_count: number;
  open_count: number;
  blocked_count: number;
  waiting_count: number;
  milestone_variance_days: number | null;
  next_milestone: EaHealthMilestone | null;
  open_items: EaHealthTask[];
  recent_activity: EaProjectActivity[];
  reviewed_at: string | null;
};

const CLOSED_TASKS = new Set(["complete", "cancelled", "suggested"]);
const CLOSED_MILESTONES = new Set(["complete", "skipped"]);
const ACTIONABLE_TASKS = new Set(["open", "ready", "in_progress"]);

export function calculateEaProjectHealth(input: {
  project: EaHealthProject;
  operation: EaHealthOperation;
  tasks: EaHealthTask[];
  milestones: EaHealthMilestone[];
  activities: EaProjectActivity[];
  ownerCount: number;
  reviewedAt?: string | null;
  today?: string;
}): EaProjectHealth {
  const today = input.today ?? localDateKey();
  const projectStatus = input.project.status.toLowerCase();
  const lifecycle =
    input.operation?.lifecycle_status ??
    (projectStatus === "complete"
      ? "completed"
      : projectStatus.includes("hold")
        ? "on_hold"
        : "active");
  const openItems = input.tasks.filter((task) => !CLOSED_TASKS.has(task.status));
  const overdue = openItems.filter((task) => Boolean(task.due_date && task.due_date < today));
  const dueThrough = addDays(today, 7);
  const dueSoon = openItems.filter((task) =>
    Boolean(task.due_date && task.due_date >= today && task.due_date <= dueThrough),
  );
  const blocked = openItems.filter((task) => task.status === "blocked");
  const waiting = openItems.filter((task) => task.status === "waiting" || task.waiting_on);
  const nextMilestone =
    [...input.milestones]
      .filter((milestone) => !CLOSED_MILESTONES.has(milestone.status))
      .sort(
        (left, right) =>
          left.sort_order - right.sort_order ||
          (left.target_date ?? "9999").localeCompare(right.target_date ?? "9999"),
      )[0] ?? null;
  const milestoneVariance = nextMilestone?.target_date
    ? differenceInCalendarDays(today, nextMilestone.target_date)
    : null;
  const activities = [...input.activities]
    .filter((activity) => Boolean(activity.occurred_at))
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
  const lastTouch = activities[0]?.occurred_at ?? null;
  const projectBaseline = lastTouch || input.project.created_at || input.project.updated_at;
  const inactiveDays = differenceInCalendarDays(today, projectBaseline.slice(0, 10));
  const missingInfo = [
    !input.project.accepted_date ? "accepted date" : null,
    !input.project.promised_completion_date ? "promised completion" : null,
    input.ownerCount === 0 ? "project owner" : null,
    input.milestones.length === 0 ? "milestones" : null,
  ].filter((value): value is string => Boolean(value));

  const base: Omit<EaProjectHealth, "health" | "reasons"> = {
    project_id: input.project.id,
    lifecycle_status: lifecycle,
    missing_info: missingInfo,
    last_touch_at: lastTouch,
    next_touch_date: input.operation?.follow_up_date ?? null,
    overdue_count: lifecycle === "active" ? overdue.length : 0,
    due_next_7_days_count: lifecycle === "active" ? dueSoon.length : 0,
    open_count: openItems.length,
    blocked_count: lifecycle === "active" ? blocked.length : 0,
    waiting_count: waiting.length,
    milestone_variance_days: milestoneVariance && milestoneVariance > 0 ? milestoneVariance : null,
    next_milestone: nextMilestone,
    open_items: openItems
      .sort(
        (left, right) =>
          (left.due_date ?? "9999").localeCompare(right.due_date ?? "9999") ||
          left.title.localeCompare(right.title),
      )
      .slice(0, 12),
    recent_activity: activities.slice(0, 6),
    reviewed_at: input.reviewedAt ?? null,
  };

  if (lifecycle !== "active") {
    return {
      ...base,
      health: "on_track",
      reasons: [lifecycle === "on_hold" ? "Project is on hold" : "Project is completed"],
    };
  }

  if (input.project.health_override) {
    const health = mapHealthOverride(input.project.health_override);
    return {
      ...base,
      health,
      reasons: [
        input.project.health_override_reason || `Health manually set to ${healthLabel(health)}`,
      ],
    };
  }

  const behindReasons: string[] = [];
  if (
    input.project.promised_completion_date &&
    input.project.promised_completion_date < today &&
    input.project.status !== "Complete"
  ) {
    behindReasons.push(
      `Promised completion is ${Math.abs(differenceInCalendarDays(input.project.promised_completion_date, today))} days past due`,
    );
  }
  if (
    input.project.forecast_completion_date &&
    input.project.promised_completion_date &&
    input.project.forecast_completion_date > input.project.promised_completion_date
  ) {
    behindReasons.push(
      `Forecast is ${differenceInCalendarDays(input.project.forecast_completion_date, input.project.promised_completion_date)} days beyond the promise`,
    );
  }
  const lateCritical = input.milestones.find(
    (milestone) =>
      milestone.is_critical &&
      milestone.target_date &&
      !CLOSED_MILESTONES.has(milestone.status) &&
      differenceInCalendarDays(today, milestone.target_date) >= 7,
  );
  if (lateCritical) behindReasons.push(`${lateCritical.title} is at least 7 days late`);
  if (behindReasons.length) return { ...base, health: "behind", reasons: behindReasons };

  const riskReasons: string[] = [];
  if (overdue.length)
    riskReasons.push(`${overdue.length} item${overdue.length === 1 ? " is" : "s are"} overdue`);
  const overdueMilestone = input.milestones.find(
    (milestone) =>
      milestone.target_date &&
      milestone.target_date < today &&
      !CLOSED_MILESTONES.has(milestone.status),
  );
  if (overdueMilestone) riskReasons.push(`${overdueMilestone.title} is past its target date`);
  if (blocked.some((task) => task.priority === "high"))
    riskReasons.push("A high-priority item is blocked");
  const hasUnfinishedMilestones = input.milestones.some(
    (milestone) => !CLOSED_MILESTONES.has(milestone.status),
  );
  const hasReadyWork = openItems.some(
    (task) => ACTIONABLE_TASKS.has(task.status) && !task.waiting_on,
  );
  if (hasUnfinishedMilestones && !hasReadyWork && waiting.length === 0) {
    riskReasons.push("No actionable next item is ready");
  }
  if (riskReasons.length) return { ...base, health: "at_risk", reasons: riskReasons };

  const followUpDue = Boolean(
    input.operation?.follow_up_date && input.operation.follow_up_date <= today,
  );
  const waitingUntilFutureFollowUp = Boolean(
    waiting.length && input.operation?.follow_up_date && input.operation.follow_up_date > today,
  );
  if (followUpDue) {
    return { ...base, health: "needs_touch", reasons: ["The planned follow-up date has arrived"] };
  }
  if (!waitingUntilFutureFollowUp && inactiveDays >= 7) {
    return {
      ...base,
      health: "needs_touch",
      reasons: [`No project activity for ${inactiveDays} days`],
    };
  }
  return {
    ...base,
    health: "on_track",
    reasons: [
      waitingUntilFutureFollowUp
        ? "Waiting until the planned follow-up date"
        : "No current warning signs",
    ],
  };
}

export function mapHealthOverride(
  health: NonNullable<EaHealthProject["health_override"]>,
): EaProjectHealthStatus {
  if (health === "critical" || health === "late") return "behind";
  return health;
}

export function healthLabel(health: EaProjectHealthStatus) {
  if (health === "needs_touch") return "Needs touch";
  if (health === "at_risk") return "At risk";
  if (health === "behind") return "Behind";
  return "On track";
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function differenceInCalendarDays(later: string, earlier: string) {
  const laterDate = new Date(`${later.slice(0, 10)}T12:00:00`);
  const earlierDate = new Date(`${earlier.slice(0, 10)}T12:00:00`);
  return Math.round((laterDate.getTime() - earlierDate.getTime()) / 86_400_000);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDateKey(value);
}
