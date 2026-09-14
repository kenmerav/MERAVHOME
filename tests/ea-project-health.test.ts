import { describe, expect, it } from "vitest";
import {
  calculateEaProjectHealth,
  type EaHealthMilestone,
  type EaHealthProject,
  type EaHealthTask,
} from "../src/lib/eaProjectHealth";

const today = "2026-09-09";

function project(overrides: Partial<EaHealthProject> = {}): EaHealthProject {
  return {
    id: "project-1",
    status: "Active",
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z",
    accepted_date: "2026-08-01",
    promised_completion_date: "2026-10-01",
    forecast_completion_date: "2026-10-01",
    health_override: null,
    health_override_reason: null,
    ...overrides,
  };
}

function task(overrides: Partial<EaHealthTask> = {}): EaHealthTask {
  return {
    id: "task-1",
    title: "Review selections",
    status: "ready",
    priority: "normal",
    due_date: "2026-09-12",
    waiting_on: null,
    assigned_user_id: "owner-1",
    source_type: "ea_email",
    created_at: "2026-09-08T12:00:00Z",
    updated_at: "2026-09-08T12:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

function milestone(overrides: Partial<EaHealthMilestone> = {}): EaHealthMilestone {
  return {
    id: "milestone-1",
    title: "Client approval",
    stage: "Approval",
    status: "in_progress",
    target_date: "2026-09-20",
    is_critical: true,
    sort_order: 10,
    ...overrides,
  };
}

function calculate(overrides: Partial<Parameters<typeof calculateEaProjectHealth>[0]> = {}) {
  return calculateEaProjectHealth({
    project: project(),
    operation: { lifecycle_status: "active", follow_up_date: null },
    tasks: [task()],
    milestones: [milestone()],
    activities: [
      {
        id: "source-1",
        kind: "email",
        title: "Project update",
        occurred_at: "2026-09-08T12:00:00Z",
        source_url: null,
      },
    ],
    ownerCount: 1,
    reviewedAt: null,
    today,
    ...overrides,
  });
}

describe("EA project health", () => {
  it("marks a project behind when its promised date has passed", () => {
    const result = calculate({
      project: project({ promised_completion_date: "2026-09-01" }),
    });
    expect(result.health).toBe("behind");
    expect(result.reasons[0]).toContain("past due");
  });

  it("marks a critical milestone behind at seven days late", () => {
    const result = calculate({ milestones: [milestone({ target_date: "2026-09-02" })] });
    expect(result.health).toBe("behind");
    expect(result.milestone_variance_days).toBe(7);
  });

  it("counts overdue and next-seven-day work across task sources", () => {
    const result = calculate({
      tasks: [
        task({ id: "overdue", due_date: "2026-09-08", source_type: "design_board" }),
        task({ id: "soon", due_date: "2026-09-16", source_type: "procurement" }),
        task({ id: "suggested", due_date: "2026-09-10", status: "suggested" }),
        task({ id: "complete", due_date: "2026-09-08", status: "complete" }),
      ],
    });
    expect(result.health).toBe("at_risk");
    expect(result.overdue_count).toBe(1);
    expect(result.due_next_7_days_count).toBe(1);
    expect(result.open_count).toBe(2);
  });

  it("needs a touch at the seven-day inactivity boundary", () => {
    const result = calculate({
      activities: [
        {
          id: "source-1",
          kind: "fathom",
          title: "Design call",
          occurred_at: "2026-09-02T12:00:00Z",
          source_url: null,
        },
      ],
    });
    expect(result.health).toBe("needs_touch");
    expect(result.reasons[0]).toContain("7 days");
  });

  it("reports missing setup as information without making the project at risk", () => {
    const result = calculate({
      project: project({ accepted_date: null, promised_completion_date: null }),
      milestones: [],
      ownerCount: 0,
    });
    expect(result.health).toBe("on_track");
    expect(result.reasons).toEqual(["No current warning signs"]);
    expect(result.missing_info).toEqual([
      "accepted date",
      "promised completion",
      "project owner",
      "milestones",
    ]);
  });

  it("does not flag a waiting project before its planned follow-up", () => {
    const result = calculate({
      operation: { lifecycle_status: "active", follow_up_date: "2026-09-12" },
      tasks: [task({ status: "waiting", waiting_on: "client", due_date: null })],
      activities: [],
    });
    expect(result.health).toBe("on_track");
    expect(result.reasons[0]).toContain("planned follow-up");
  });

  it("needs a touch when the planned follow-up date arrives", () => {
    const result = calculate({
      operation: { lifecycle_status: "active", follow_up_date: today },
      tasks: [task({ status: "waiting", waiting_on: "client", due_date: null })],
    });
    expect(result.health).toBe("needs_touch");
    expect(result.reasons).toEqual(["The planned follow-up date has arrived"]);
  });

  it("honors manual overrides and excludes on-hold work from attention counts", () => {
    const overridden = calculate({
      project: project({ health_override: "critical", health_override_reason: "Schedule reset" }),
    });
    expect(overridden.health).toBe("behind");
    expect(overridden.reasons).toEqual(["Schedule reset"]);

    const onHold = calculate({
      operation: { lifecycle_status: "on_hold", follow_up_date: "2026-09-01" },
      tasks: [task({ due_date: "2026-09-01" })],
    });
    expect(onHold.health).toBe("on_track");
    expect(onHold.overdue_count).toBe(0);
    expect(onHold.reasons).toEqual(["Project is on hold"]);
  });
});
