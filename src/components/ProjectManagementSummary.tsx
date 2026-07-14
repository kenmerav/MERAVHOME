import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, CircleDot, ListChecks, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  calculateProjectMetrics,
  formatShortDate,
  healthLabel,
  type ProjectManagementData,
  type ProjectHealth,
} from "@/lib/projectManagement";

export function ProjectManagementSummary({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["projectManagement"],
    queryFn: loadProjectManagement,
  });
  if (isLoading || !data || data.setupNeeded) return null;
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) return null;
  const milestones = data.milestones.filter((item) => item.project_id === projectId);
  const tasks = data.tasks.filter((item) => item.project_id === projectId);
  const owners = data.owners.filter((item) => item.project_id === projectId);
  const metrics = calculateProjectMetrics(project, milestones, tasks, undefined, owners.length);
  const ownerNames = owners
    .map((owner) => owner.user?.full_name || owner.user?.email)
    .filter(Boolean)
    .join(", ");

  return (
    <section className="mb-10 border border-border bg-bone/20 p-5 lg:p-6">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="eyebrow mb-1">Project Management</div>
          <h2 className="font-display text-3xl">Current operating plan</h2>
        </div>
        <Link
          to="/project-management"
          className="inline-flex items-center gap-2 text-sm underline underline-offset-4"
        >
          Open Command Center <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCell
          icon={CircleDot}
          label="Health"
          value={healthLabel(metrics.displayHealth)}
          tone={metrics.displayHealth}
        />
        <SummaryCell
          icon={ListChecks}
          label="Progress"
          value={`${metrics.displayProgress}%`}
          detail={
            project.progress_override != null
              ? `Automatic ${metrics.automaticProgress}%`
              : undefined
          }
        />
        <SummaryCell
          icon={CalendarDays}
          label="Promised"
          value={formatShortDate(project.promised_completion_date)}
          detail={project.turnaround_speed ?? undefined}
        />
        <SummaryCell icon={Users} label="Owners" value={ownerNames || "Not assigned"} />
        <SummaryCell
          icon={ArrowRight}
          label="Next Action"
          value={metrics.nextTask?.title || "No ready task"}
          detail={metrics.waitingOn ? `Waiting on ${metrics.waitingOn}` : undefined}
        />
      </div>
      {metrics.setupMissing.length > 0 && (
        <p className="mt-3 text-xs text-amber-800">
          Needs setup: {metrics.setupMissing.join(", ")}.
        </p>
      )}
    </section>
  );
}

function SummaryCell({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof CircleDot;
  label: string;
  value: string;
  detail?: string;
  tone?: ProjectHealth;
}) {
  return (
    <div className="min-w-0 bg-background p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div
        className={`mt-2 truncate text-sm font-medium ${tone === "late" || tone === "critical" ? "text-red-700" : tone === "at_risk" ? "text-amber-700" : ""}`}
      >
        {value}
      </div>
      {detail && (
        <div className="mt-1 truncate text-xs capitalize text-muted-foreground">{detail}</div>
      )}
    </div>
  );
}

async function loadProjectManagement() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch("/api/project-management", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Unable to load project management.");
  return body as ProjectManagementData;
}
