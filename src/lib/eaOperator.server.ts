/* eslint-disable @typescript-eslint/no-explicit-any -- this server-only operator spans legacy Studio tables. */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadAppleCalendar, type EaCalendarEvent } from "@/lib/appleCalendar.server";
import { normalizedEaTaskSignature, type EaResponsibilityKey } from "@/lib/eaOperatingSystem";

const admin = supabaseAdmin as any;
const DAY_MS = 86_400_000;
const ACTIVE_TASK_STATUSES = ["open", "ready", "in_progress", "waiting", "blocked"];
const INVOICE_EVIDENCE_WINDOW_DAYS = 45;

type InvoicePhase =
  | "project_start"
  | "design_presentation"
  | "design_document_delivery"
  | "project_completion";

type InvoiceTrigger = {
  phase: InvoicePhase;
  occurredAt: string;
  evidence: string;
};

type OperatorSignal = {
  key: string;
  category: EaResponsibilityKey;
  projectId: string | null;
  title: string;
  notes: string;
  nextAction: string;
  dueDate: string | null;
  priority: "low" | "normal" | "high";
  ownerId?: string | null;
  waitingOn?: "employee" | "client" | "gc" | "vendor" | null;
  artifact: string;
};

function phoenixDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function asDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

function daysAgo(value: unknown, now = Date.now()) {
  const date = asDate(value);
  return date ? Math.floor((now - date.getTime()) / DAY_MS) : null;
}

function addCalendarDays(value: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

function phaseFromPaymentLabel(value: unknown): InvoicePhase | null {
  const label = cleanMatchText(value).replace(/^phase \d+ /, "");
  if (label.includes("project start")) return "project_start";
  if (label.includes("design presentation")) return "design_presentation";
  if (label.includes("design document")) return "design_document_delivery";
  if (label.includes("project completion")) return "project_completion";
  return null;
}

function phaseLabel(phase: InvoicePhase) {
  if (phase === "project_start") return "Project Start";
  if (phase === "design_presentation") return "Design Presentation";
  if (phase === "design_document_delivery") return "Design Document Delivery";
  return "Project Completion";
}

function sourceText(source: any, length = 12_000) {
  return cleanMatchText(
    [source.title, source.summary, String(source.body_text || "").slice(0, length)].join(" "),
  );
}

function isRecentEvidence(value: unknown, notBefore: string | null, now: number) {
  const date = asDate(value);
  if (!date) return false;
  if (date.getTime() > now) return false;
  if ((daysAgo(date, now) ?? INVOICE_EVIDENCE_WINDOW_DAYS + 1) > INVOICE_EVIDENCE_WINDOW_DAYS)
    return false;
  return !notBefore || date.getTime() >= (asDate(notBefore)?.getTime() ?? 0);
}

function outboundInvoiceAlreadySent(phase: InvoicePhase, trigger: InvoiceTrigger, sources: any[]) {
  const phasePattern =
    phase === "project_start"
      ? /project start|initial|deposit/
      : phase === "design_presentation"
        ? /design presentation/
        : phase === "design_document_delivery"
          ? /design document|construction document|construction drawing|drawing set|final plan/
          : /project completion|final invoice/;
  const triggerTime = asDate(trigger.occurredAt)?.getTime() ?? 0;
  return sources.some((source) => {
    if (source.source_type !== "email") return false;
    if ((asDate(source.occurred_at)?.getTime() ?? 0) < triggerTime) return false;
    const text = sourceText(source, 3_000);
    return (
      /invoice/.test(text) &&
      phasePattern.test(text) &&
      /attached|sent|sending|here is|here s|updated invoice|payment link/.test(text)
    );
  });
}

function invoiceTriggerForPhase(input: {
  phase: InvoicePhase;
  project: any;
  sources: any[];
  calendarEvents: EaCalendarEvent[];
  notBefore: string | null;
  now: number;
}) {
  const { phase, project, sources, calendarEvents, notBefore, now } = input;
  if (phase === "project_start") {
    const accepted = String(project.accepted_date || "");
    if (!accepted || !isRecentEvidence(`${accepted}T12:00:00-07:00`, notBefore, now)) return null;
    return {
      phase,
      occurredAt: `${accepted}T12:00:00-07:00`,
      evidence: `Studio records the project start date as ${accepted}.`,
    } satisfies InvoiceTrigger;
  }

  const candidates: InvoiceTrigger[] = [];
  if (phase === "design_presentation") {
    for (const event of calendarEvents) {
      if (!isRecentEvidence(event.end_at, notBefore, now)) continue;
      if (
        !/(design presentation|presentation meeting|design review|design meeting)/i.test(
          event.title,
        )
      )
        continue;
      candidates.push({
        phase,
        occurredAt: event.end_at,
        evidence: `${event.calendar} calendar shows “${event.title}” ended ${phoenixDate(asDate(event.end_at) || new Date())}.`,
      });
    }
  }

  for (const source of sources) {
    if (source.source_type !== "email") continue;
    if (!isRecentEvidence(source.occurred_at, notBefore, now)) continue;
    const text = sourceText(source);
    const recentMessage = sourceText(source, 3_000);
    let matches = false;
    if (phase === "design_presentation") {
      matches =
        /design presentation|presentation meeting|design review/.test(text) &&
        /presented|presentation complete|design approval|approved the design|thank you for (the|our) meeting|following (the|our) (meeting|presentation)|recap/.test(
          recentMessage,
        );
    } else if (phase === "design_document_delivery") {
      matches =
        /design document|construction document|construction drawing|final drawing|final plan|drawing set|cd set/.test(
          recentMessage,
        ) &&
        /attached|delivered|sending|sent|here are|please find/.test(recentMessage) &&
        /@meravinteriors\.com$/i.test(String(source.author_email || ""));
    } else if (phase === "project_completion") {
      matches =
        /project (is |has been )?(complete|completed)|completed the project|final installation (is )?complete/.test(
          recentMessage,
        ) && !/will be|expected|scheduled|target/.test(recentMessage);
    }
    if (!matches) continue;
    candidates.push({
      phase,
      occurredAt: source.occurred_at,
      evidence: `Email evidence: “${source.title || phaseLabel(phase)}” on ${phoenixDate(asDate(source.occurred_at) || new Date())}.`,
    });
  }

  return (
    candidates.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))[0] ?? null
  );
}

function cleanMatchText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function projectForCalendarEvent(event: EaCalendarEvent, projects: any[], operations: any[]) {
  const title = cleanMatchText(event.title);
  if (!title) return null;
  return (
    projects
      .map((project) => {
        const aliases = operations.find((item) => item.project_id === project.id)?.aliases ?? [];
        const names = [project.name, project.client_name, ...aliases]
          .map(cleanMatchText)
          .filter((name) => name.length >= 4);
        const score = names.reduce((best, name) => {
          if (title.includes(name)) return Math.max(best, 100 + name.length);
          const tokens = name.split(" ").filter((token) => token.length >= 4);
          return Math.max(best, tokens.filter((token) => title.includes(token)).length * 10);
        }, 0);
        return { project, score };
      })
      .filter((candidate) => candidate.score >= 10)
      .sort((left, right) => right.score - left.score)[0]?.project ?? null
  );
}

function weekKey(date = new Date()) {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${thursday.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

async function saveSignal(signal: OperatorSignal, createdBy: string | null) {
  const existingResult = await admin
    .from("shared_project_todos")
    .select("id,status,completed_at")
    .eq("source_type", "ea_agent")
    .eq("source_key", signal.key)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingResult.error) throw existingResult.error;
  const existing = existingResult.data?.[0];
  if (existing && ["complete", "cancelled"].includes(existing.status)) {
    return { id: existing.id, created: false, updated: false, terminal: true };
  }
  const taskRow = {
    project_id: signal.projectId,
    assigned_user_id: signal.ownerId || null,
    recommended_assignee_id: signal.ownerId || null,
    title: signal.title,
    notes: signal.notes,
    internal_notes: signal.nextAction,
    due_date: signal.dueDate,
    priority: signal.priority,
    status: signal.waitingOn ? "waiting" : signal.ownerId ? "ready" : "open",
    waiting_on: signal.waitingOn || null,
    visibility: "internal",
    source_type: "ea_agent",
    source_key: signal.key,
    created_by: createdBy,
  };
  const saved = existing
    ? await admin
        .from("shared_project_todos")
        .update(taskRow)
        .eq("id", existing.id)
        .select("id")
        .single()
    : await admin.from("shared_project_todos").insert(taskRow).select("id").single();
  if (saved.error) throw saved.error;
  const context = await admin.from("ea_task_contexts").upsert(
    {
      todo_id: saved.data.id,
      ea_next_action: signal.nextAction,
      next_follow_up_date: signal.dueDate,
      work_artifact_kind: "action_plan",
      work_artifact_text: signal.artifact,
      approval_status: "approved",
      approval_reviewed_at: new Date().toISOString(),
      approval_reviewed_by: createdBy,
    },
    { onConflict: "todo_id" },
  );
  if (context.error) throw context.error;
  return { id: saved.data.id, created: !existing, updated: Boolean(existing), terminal: false };
}

function projectBrief(input: {
  project: any;
  event: EaCalendarEvent;
  tasks: any[];
  milestones: any[];
  documents: any[];
  sources: any[];
}) {
  const openTasks = input.tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  const openMilestones = input.milestones.filter(
    (milestone) => !["complete", "skipped"].includes(milestone.status),
  );
  return [
    `MEETING BRIEF — ${input.project.name}`,
    "",
    `Meeting: ${input.event.title}`,
    `When: ${new Date(input.event.start_at).toLocaleString("en-US", { timeZone: "America/Phoenix" })}`,
    `Calendar: ${input.event.calendar}`,
    input.event.location ? `Location: ${input.event.location}` : "",
    "",
    "OPEN COMMITMENTS",
    ...(openTasks.length
      ? openTasks
          .slice(0, 10)
          .map((task) => `• ${task.title}${task.due_date ? ` — due ${task.due_date}` : ""}`)
      : ["• No open Studio tasks were found."]),
    "",
    "CURRENT AND NEXT MILESTONES",
    ...(openMilestones.length
      ? openMilestones
          .slice(0, 5)
          .map((item) => `• ${item.title}${item.target_date ? ` — ${item.target_date}` : ""}`)
      : ["• No open milestone is recorded."]),
    "",
    "RECENT PROJECT EVIDENCE",
    ...input.sources
      .slice(0, 5)
      .map((source) => `• ${source.title} — ${String(source.occurred_at || "").slice(0, 10)}`),
    ...input.documents
      .slice(0, 4)
      .map((document) => `• ${document.title} — ${document.document_type}`),
    "",
    "BEFORE THE MEETING",
    "• Review unresolved decisions and anything overdue.",
    "• Confirm which questions need an answer in this meeting.",
    "• Open the newest relevant drawings or supporting documents.",
    "• Check Katie, Ken, and Family calendars for conflicts.",
    "",
    "INTERNAL ONLY — this brief does not message or invite anyone.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runEaOperatingReview(createdBy: string | null = null) {
  const today = phoenixDate();
  const now = Date.now();
  const projectsResult = await admin
    .from("projects")
    .select(
      "id,name,client_name,status,accepted_date,created_at,updated_at,promised_completion_date,forecast_completion_date,health_override,health_override_reason",
    )
    .neq("status", "Complete")
    .order("name");
  if (projectsResult.error) throw projectsResult.error;
  const projects = (projectsResult.data ?? []).filter(
    (project: any) => !/(^|\s)(test|demo)(\s|$)/i.test(String(project.name || "")),
  );
  const projectIds = projects.map((project: any) => project.id);
  if (!projectIds.length) return { created: 0, updated: 0, completed: 0, reopened: 0, signals: 0 };

  const [
    operations,
    tasks,
    contexts,
    milestones,
    invoices,
    documents,
    rooms,
    vendors,
    profiles,
    sources,
    calendarNotifications,
  ] = await Promise.all([
    admin.from("ea_project_operations").select("*").in("project_id", projectIds),
    admin
      .from("shared_project_todos")
      .select("*")
      .or(`project_id.in.(${projectIds.join(",")}),project_id.is.null`)
      .neq("status", "cancelled")
      .limit(2000),
    admin
      .from("ea_task_contexts")
      .select("todo_id,next_follow_up_date")
      .lte("next_follow_up_date", today)
      .limit(1000),
    admin.from("project_milestones").select("*").in("project_id", projectIds),
    admin.from("financial_invoices").select("*").in("project_id", projectIds),
    admin.from("project_documents").select("*").in("project_id", projectIds),
    admin.from("rooms").select("id,name,project_id").in("project_id", projectIds),
    admin.from("ea_vendor_profiles").select("*").neq("purchasing_route_status", "archived"),
    admin.from("user_profiles").select("id,email,full_name").eq("is_active", true),
    admin
      .from("marvin_sources")
      .select(
        "id,title,body_text,summary,author_email,occurred_at,source_type,marvin_source_projects(project_id)",
      )
      .in("source_type", ["email", "fathom", "voice_memo", "note", "document"])
      .eq("review_status", "linked")
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(2000),
    admin
      .from("studio_calendar_notifications")
      .select("id,calendar_event_id,task_id,calendar_name,title,start_at,end_at,location")
      .gte("end_at", new Date(now - INVOICE_EVIDENCE_WINDOW_DAYS * DAY_MS).toISOString())
      .lte("end_at", new Date(now).toISOString())
      .limit(1000),
  ]);
  for (const result of [
    operations,
    tasks,
    contexts,
    milestones,
    invoices,
    documents,
    rooms,
    vendors,
    profiles,
    sources,
    calendarNotifications,
  ]) {
    if (result.error) throw result.error;
  }

  const roomIds = (rooms.data ?? []).map((room: any) => room.id);
  const roomProducts = roomIds.length
    ? await admin
        .from("room_products")
        .select("id,room_id,product_id,approved,product:products(id,name,vendor,shipping)")
        .in("room_id", roomIds)
        .eq("approved", true)
        .limit(3000)
    : { data: [], error: null };
  if (roomProducts.error) throw roomProducts.error;
  const invoiceIds = (invoices.data ?? []).map((invoice: any) => invoice.id);
  const invoicePayments = invoiceIds.length
    ? await admin
        .from("financial_invoice_payments")
        .select("*")
        .in("invoice_id", invoiceIds)
        .limit(2000)
    : { data: [], error: null };
  if (invoicePayments.error) throw invoicePayments.error;
  const roomProductIds = (roomProducts.data ?? []).map((item: any) => item.id);
  const procurement = roomProductIds.length
    ? await admin
        .from("procurement_items")
        .select("id,room_product_id,ordered,received,installed,notes,updated_at")
        .in("room_product_id", roomProductIds)
        .limit(3000)
    : { data: [], error: null };
  if (procurement.error) throw procurement.error;

  const profileByName = new Map<string, string>();
  for (const profile of profiles.data ?? []) {
    const first =
      cleanMatchText(profile.full_name).split(" ")[0] ||
      cleanMatchText(profile.email).split(" ")[0];
    if (["katie", "brynn", "ken"].includes(first)) profileByName.set(first, profile.id);
  }
  const operationByProject = new Map(
    (operations.data ?? []).map((item: any) => [item.project_id, item]),
  );
  const tasksByProject = new Map<string, any[]>();
  for (const task of tasks.data ?? []) {
    if (task.project_id)
      tasksByProject.set(task.project_id, [...(tasksByProject.get(task.project_id) ?? []), task]);
  }
  const milestonesByProject = new Map<string, any[]>();
  for (const milestone of milestones.data ?? []) {
    milestonesByProject.set(milestone.project_id, [
      ...(milestonesByProject.get(milestone.project_id) ?? []),
      milestone,
    ]);
  }
  const documentsByProject = new Map<string, any[]>();
  for (const document of documents.data ?? []) {
    documentsByProject.set(document.project_id, [
      ...(documentsByProject.get(document.project_id) ?? []),
      document,
    ]);
  }
  const sourcesByProject = new Map<string, any[]>();
  for (const source of sources.data ?? []) {
    for (const link of source.marvin_source_projects ?? []) {
      sourcesByProject.set(link.project_id, [
        ...(sourcesByProject.get(link.project_id) ?? []),
        source,
      ]);
    }
  }
  const taskById = new Map((tasks.data ?? []).map((task: any) => [task.id, task]));
  const calendar = await loadAppleCalendar(false, INVOICE_EVIDENCE_WINDOW_DAYS);
  const calendarByProject = new Map<string, EaCalendarEvent[]>();
  for (const notification of calendarNotifications.data ?? []) {
    const task: any = taskById.get(notification.task_id);
    if (!task?.project_id) continue;
    const event: EaCalendarEvent = {
      id: notification.calendar_event_id || notification.id,
      calendar: notification.calendar_name,
      title: notification.title,
      start_at: notification.start_at,
      end_at: notification.end_at,
      all_day: false,
      location: notification.location,
      url: null,
    };
    calendarByProject.set(task.project_id, [
      ...(calendarByProject.get(task.project_id) ?? []),
      event,
    ]);
  }
  if (calendar.available) {
    for (const event of calendar.events) {
      const end = asDate(event.end_at)?.getTime() ?? 0;
      if (end > now || end < now - INVOICE_EVIDENCE_WINDOW_DAYS * DAY_MS) continue;
      const project = projectForCalendarEvent(event, projects, operations.data ?? []);
      if (!project) continue;
      const existing = calendarByProject.get(project.id) ?? [];
      if (existing.some((item) => item.id === event.id)) continue;
      calendarByProject.set(project.id, [...existing, event]);
    }
  }
  const roomById = new Map((rooms.data ?? []).map((room: any) => [room.id, room]));
  const procurementByRoomProduct = new Map(
    (procurement.data ?? []).map((item: any) => [item.room_product_id, item]),
  );
  const signals: OperatorSignal[] = [];

  let reopened = 0;
  const dueContextByTask = new Map(
    (contexts.data ?? []).map((context: any) => [context.todo_id, context]),
  );
  for (const task of tasks.data ?? []) {
    if (task.status !== "waiting" || !dueContextByTask.has(task.id)) continue;
    const update = await admin
      .from("shared_project_todos")
      .update({
        status: task.assigned_user_id ? "ready" : "open",
        priority: task.priority === "low" ? "normal" : task.priority,
      })
      .eq("id", task.id)
      .eq("status", "waiting");
    if (update.error) throw update.error;
    reopened += 1;
  }

  for (const project of projects) {
    const operation: any = operationByProject.get(project.id);
    if (operation?.lifecycle_status === "on_hold" || operation?.lifecycle_status === "completed")
      continue;
    const projectTasks = tasksByProject.get(project.id) ?? [];
    const openTasks = projectTasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
    const projectMilestones = milestonesByProject.get(project.id) ?? [];
    const reasons: string[] = [];
    let hasProjectLevelException = false;
    if (project.promised_completion_date && project.promised_completion_date < today) {
      reasons.push(`promised completion passed on ${project.promised_completion_date}`);
      hasProjectLevelException = true;
    }
    if (
      project.promised_completion_date &&
      project.forecast_completion_date &&
      project.forecast_completion_date > project.promised_completion_date
    ) {
      reasons.push(`forecast ${project.forecast_completion_date} exceeds the promise`);
      hasProjectLevelException = true;
    }
    const overdueTasks = openTasks.filter((task) => task.due_date && task.due_date < today);
    if (overdueTasks.length)
      reasons.push(
        `${overdueTasks.length} open item${overdueTasks.length === 1 ? " is" : "s are"} overdue`,
      );
    const lateCritical = projectMilestones.filter(
      (milestone) =>
        milestone.is_critical &&
        !["complete", "skipped"].includes(milestone.status) &&
        milestone.target_date &&
        (daysAgo(milestone.target_date, now) ?? 0) >= 7,
    );
    if (lateCritical.length) {
      reasons.push(
        `${lateCritical.length} critical milestone${lateCritical.length === 1 ? " is" : "s are"} at least seven days late`,
      );
      hasProjectLevelException = true;
    }
    if (operation?.follow_up_date && operation.follow_up_date <= today) {
      reasons.push(`the project follow-up date arrived on ${operation.follow_up_date}`);
      hasProjectLevelException = true;
    }
    if (!openTasks.length && !operation?.waiting_party) {
      reasons.push("the active project has no actionable next work recorded");
      hasProjectLevelException = true;
    }
    // A concrete overdue task is already visible in the EA Desk. Do not add a vague
    // "Own the next move" wrapper unless the project itself has a separate exception.
    if (reasons.length && hasProjectLevelException) {
      signals.push({
        key: `ea-agent:commitments:${project.id}`,
        category: "commitments",
        projectId: project.id,
        title: `Own the next move for ${project.name}`,
        notes: reasons.join("; "),
        nextAction:
          operation?.next_action ||
          "Review the evidence, identify the owner, and record the next dated action.",
        dueDate: today,
        priority:
          lateCritical.length || project.promised_completion_date < today ? "high" : "normal",
        ownerId: operation?.responsible_user_id || null,
        waitingOn: null,
        artifact: [
          `PROJECT FOLLOW-THROUGH — ${project.name}`,
          "",
          ...reasons.map((reason) => `• ${reason}`),
          "",
          `Next recorded action: ${operation?.next_action || "Not recorded"}`,
          `Waiting party: ${operation?.waiting_party || "Not recorded"}`,
          `Follow-up date: ${operation?.follow_up_date || "Not recorded"}`,
          "",
          "INTERNAL ONLY — investigate, prepare the next step, and route any communication to Katie approvals.",
        ].join("\n"),
      });
    }
  }

  const procurementGroups = new Map<string, { unordered: any[]; outstanding: any[] }>();
  for (const roomProduct of roomProducts.data ?? []) {
    const room: any = roomById.get(roomProduct.room_id);
    if (!room?.project_id) continue;
    const state: any = procurementByRoomProduct.get(roomProduct.id);
    const group = procurementGroups.get(room.project_id) ?? { unordered: [], outstanding: [] };
    const enriched = { ...roomProduct, room, state };
    if (!state?.ordered) group.unordered.push(enriched);
    else if (!state.received && (daysAgo(state.updated_at, now) ?? 0) >= 14)
      group.outstanding.push(enriched);
    procurementGroups.set(room.project_id, group);
  }
  for (const [projectId, group] of procurementGroups) {
    if (!group.unordered.length && !group.outstanding.length) continue;
    const project = projects.find((item: any) => item.id === projectId);
    const lines = [
      ...group.unordered
        .slice(0, 12)
        .map(
          (item) =>
            `• APPROVED / NOT ORDERED — ${item.product?.name || "Unnamed selection"} · ${item.room.name}`,
        ),
      ...group.outstanding
        .slice(0, 12)
        .map(
          (item) =>
            `• ORDERED / NOT RECEIVED — ${item.product?.name || "Unnamed selection"} · ${item.room.name}`,
        ),
    ];
    signals.push({
      key: `ea-agent:procurement:${projectId}`,
      category: "procurement",
      projectId,
      title: `Review procurement exceptions for ${project?.name || "project"}`,
      notes: `${group.unordered.length} approved selection${group.unordered.length === 1 ? " is" : "s are"} not marked ordered; ${group.outstanding.length} older order${group.outstanding.length === 1 ? " is" : "s are"} not marked received.`,
      nextAction:
        "Confirm who is purchasing each item, verify the current status, and prepare any vendor questions for approval.",
      dueDate: today,
      priority: group.outstanding.length ? "high" : "normal",
      ownerId: (operationByProject.get(projectId) as any)?.responsible_user_id || null,
      artifact: [
        `PROCUREMENT REVIEW — ${project?.name || "Project"}`,
        "",
        ...lines,
        "",
        "Do not place an order. Confirm purchasing responsibility, quantities, pricing, approvals, and lead times first.",
      ].join("\n"),
    });
  }

  const invoiceById = new Map((invoices.data ?? []).map((invoice: any) => [invoice.id, invoice]));
  for (const payment of invoicePayments.data ?? []) {
    const phase = phaseFromPaymentLabel(payment.label);
    if (!phase || payment.status === "paid" || Number(payment.amount || 0) <= 0) continue;
    const invoice: any = invoiceById.get(payment.invoice_id);
    const project = projects.find((item: any) => item.id === invoice?.project_id);
    if (!project) continue;
    const projectSources = sourcesByProject.get(project.id) ?? [];
    const trigger = invoiceTriggerForPhase({
      phase,
      project,
      sources: projectSources,
      calendarEvents: calendarByProject.get(project.id) ?? [],
      notBefore: invoice.invoice_date || project.accepted_date || project.created_at || null,
      now,
    });
    if (!trigger) continue;
    const triggerDate = phoenixDate(asDate(trigger.occurredAt) || new Date());
    const dueDate = addCalendarDays(triggerDate, 1);
    if (!dueDate || dueDate > today) continue;
    if (outboundInvoiceAlreadySent(phase, trigger, projectSources)) continue;
    const ownerName = phase === "project_start" ? "katie" : "ken";
    const amount = Number(payment.amount || 0);
    const displayAmount = amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
    signals.push({
      key: `ea-agent:invoice_due:${payment.id}`,
      category: "billing_admin",
      projectId: project.id,
      title: `Send ${phaseLabel(phase)} invoice for ${project.name}`,
      notes: `${phaseLabel(phase)} payment scheduled for ${displayAmount}. ${trigger.evidence}`,
      nextAction: `Prepare and send the ${phaseLabel(phase)} invoice. Do not verify whether the client paid; this task is only about issuing the invoice after the milestone.`,
      dueDate,
      priority: (daysAgo(`${dueDate}T12:00:00-07:00`, now) ?? 0) >= 3 ? "high" : "normal",
      ownerId: profileByName.get(ownerName) || null,
      artifact: [
        `INVOICE DUE — ${project.name}`,
        "",
        `• Phase: ${phaseLabel(phase)}`,
        `• Scheduled amount: ${displayAmount}`,
        `• Milestone occurred: ${triggerDate}`,
        `• Invoice reminder due: ${dueDate}`,
        `• Evidence: ${trigger.evidence}`,
        `• Assigned to: ${phase === "project_start" ? "Katie" : "Ken"}`,
        "",
        "Prepare the invoice for human review and sending. The EA must never send it or contact the client automatically.",
      ].join("\n"),
    });
  }

  for (const project of projects) {
    const duplicates = new Map<string, any[]>();
    for (const document of documentsByProject.get(project.id) ?? []) {
      const key = cleanMatchText(
        String(document.title || "").replace(/\b(rev|revision|v)\s*\d+\b/g, ""),
      );
      if (key) duplicates.set(key, [...(duplicates.get(key) ?? []), document]);
    }
    const repeated = [...duplicates.values()].filter((items) => items.length > 1);
    if (!repeated.length) continue;
    signals.push({
      key: `ea-agent:project_files:${project.id}`,
      category: "project_files",
      projectId: project.id,
      title: `Confirm current document revisions for ${project.name}`,
      notes: `${repeated.length} document title group${repeated.length === 1 ? " has" : "s have"} multiple versions in Studio.`,
      nextAction:
        "Confirm the newest revision and label older files as superseded without deleting the originals.",
      dueDate: today,
      priority: "normal",
      artifact: [
        `PROJECT FILE REVIEW — ${project.name}`,
        "",
        ...repeated.flatMap((items) =>
          items.map((item) => `• ${item.title} · ${String(item.created_at).slice(0, 10)}`),
        ),
        "",
        "Preserve every source file. Confirm which revision is current before relying on it.",
      ].join("\n"),
    });
  }

  const unverifiedVendors = (vendors.data ?? []).filter(
    (vendor: any) =>
      vendor.purchasing_route_status !== "confirmed" ||
      vendor.contact_verification_status !== "verified",
  );
  if (unverifiedVendors.length) {
    signals.push({
      key: "ea-agent:process_memory:vendor-directory",
      category: "process_memory",
      projectId: null,
      title: "Verify MERAV vendor routes and contacts",
      notes: `${unverifiedVendors.length} vendor record${unverifiedVendors.length === 1 ? " needs" : "s need"} a confirmed purchasing route or contact.`,
      nextAction:
        "Verify the most-used vendors first and record exactly who handles sales, service, samples, damages, and returns.",
      dueDate: null,
      priority: "normal",
      ownerId: profileByName.get("brynn") || null,
      artifact: [
        "MERAV VENDOR MEMORY REVIEW",
        "",
        ...unverifiedVendors
          .slice(0, 30)
          .map(
            (vendor: any) =>
              `• ${vendor.supplier_company} — route ${vendor.purchasing_route_status}; contact ${vendor.contact_verification_status}`,
          ),
        "",
        "Verified entries become reusable operating knowledge for future drafts and procurement reviews.",
      ].join("\n"),
    });
  }

  if (calendar.available) {
    const cutoff = now + 48 * 60 * 60 * 1000;
    const travelCutoff = now + 7 * DAY_MS;
    for (const event of calendar.events) {
      const start = asDate(event.start_at)?.getTime() ?? 0;
      if (start < now || start > travelCutoff) continue;
      if (/(flight|airline|hotel|rental car|check.?in|travel|airport)/i.test(event.title)) {
        signals.push({
          key: `ea-agent:travel_admin:${event.id}`,
          category: "travel_admin",
          projectId: null,
          title: `Prepare travel logistics for ${event.title}`,
          notes: `${event.calendar} calendar · ${new Date(event.start_at).toLocaleString("en-US", { timeZone: "America/Phoenix" })}`,
          nextAction:
            "Collect the itinerary, confirmation numbers, check-in time, transportation, address, and any schedule conflicts.",
          dueDate: phoenixDate(new Date(Math.max(now, start - DAY_MS))),
          priority: start - now <= 48 * 60 * 60 * 1000 ? "high" : "normal",
          ownerId: profileByName.get(cleanMatchText(event.calendar)) || null,
          artifact: [
            `TRAVEL PREPARATION — ${event.title}`,
            "",
            "• Confirm flight or reservation details and confirmation numbers.",
            "• Record check-in time, addresses, transportation, and calendar conflicts.",
            "• Put any booking or purchase decision in front of Ken or Katie.",
            "",
            "INTERNAL ONLY — never book, purchase, check in, or contact anyone.",
          ].join("\n"),
        });
        continue;
      }
      if (start > cutoff) continue;
      const project = projectForCalendarEvent(event, projects, operations.data ?? []);
      if (!project) continue;
      signals.push({
        key: `ea-agent:meeting_preparation:${event.id}`,
        category: "meeting_preparation",
        projectId: project.id,
        title: `Prepare for ${event.title}`,
        notes: `${event.calendar} calendar · ${new Date(event.start_at).toLocaleString("en-US", { timeZone: "America/Phoenix" })}`,
        nextAction:
          "Review the internal meeting brief and add any decisions or questions Ken or Katie needs to cover.",
        dueDate: phoenixDate(new Date(Math.max(now, start - DAY_MS))),
        priority: start - now <= 24 * 60 * 60 * 1000 ? "high" : "normal",
        ownerId: profileByName.get(cleanMatchText(event.calendar)) || null,
        artifact: projectBrief({
          project,
          event,
          tasks: tasksByProject.get(project.id) ?? [],
          milestones: milestonesByProject.get(project.id) ?? [],
          documents: documentsByProject.get(project.id) ?? [],
          sources: sourcesByProject.get(project.id) ?? [],
        }),
      });
    }
  }

  const duplicateGroups = new Map<string, any[]>();
  for (const task of (tasks.data ?? []).filter((item: any) =>
    ACTIVE_TASK_STATUSES.includes(item.status),
  )) {
    const key = normalizedEaTaskSignature(task.project_id, task.title);
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), task]);
  }
  const duplicateTasks = [...duplicateGroups.values()].filter((items) => items.length > 1);
  if (duplicateTasks.length) {
    signals.push({
      key: "ea-agent:quality_control:duplicate-tasks",
      category: "quality_control",
      projectId: null,
      title: "Review possible duplicate open work",
      notes: `${duplicateTasks.length} group${duplicateTasks.length === 1 ? " may" : "s may"} describe the same obligation.`,
      nextAction:
        "Compare the sources and keep one current task for each real obligation; do not remove distinct responsibilities.",
      dueDate: today,
      priority: "normal",
      ownerId: null,
      artifact: [
        "EA QUALITY CONTROL — POSSIBLE DUPLICATES",
        "",
        ...duplicateTasks
          .slice(0, 20)
          .map((items) => `• ${items.map((item) => item.title).join(" / ")}`),
        "",
        "Review before closing anything. Similar wording is not proof that two commitments are identical.",
      ].join("\n"),
    });
  }

  const attentionProjects = signals.filter((signal) => signal.category === "commitments");
  signals.push({
    key: `ea-agent:quality_control:weekly-review:${weekKey()}`,
    category: "quality_control",
    projectId: null,
    title: "Review the weekly MERAV operations brief",
    notes: `${attentionProjects.length} active project${attentionProjects.length === 1 ? " needs" : "s need"} an ownership review this week.`,
    nextAction:
      "Review project exceptions, unanswered commitments, procurement, invoices, meetings, and directory gaps.",
    dueDate: today,
    priority: attentionProjects.some((item) => item.priority === "high") ? "high" : "normal",
    ownerId: profileByName.get("katie") || profileByName.get("ken") || null,
    artifact: [
      `WEEKLY MERAV OPERATIONS REVIEW — ${weekKey()}`,
      "",
      `• Project follow-through exceptions: ${attentionProjects.length}`,
      `• Procurement reviews: ${signals.filter((item) => item.category === "procurement").length}`,
      `• Invoice reviews: ${signals.filter((item) => item.category === "billing_admin").length}`,
      `• Upcoming meeting briefs: ${signals.filter((item) => item.category === "meeting_preparation").length}`,
      `• Travel and admin preparations: ${signals.filter((item) => item.category === "travel_admin").length}`,
      `• File and quality reviews: ${signals.filter((item) => ["project_files", "quality_control"].includes(item.category)).length}`,
      "",
      ...attentionProjects.slice(0, 20).map((item) => `• ${item.title} — ${item.notes}`),
      "",
      "INTERNAL ONLY — this is an operational review, not communication or approval.",
    ].join("\n"),
  });

  let created = 0;
  let updated = 0;
  const activeKeys = new Set(signals.map((signal) => signal.key));
  for (const signal of signals) {
    const result = await saveSignal(signal, createdBy);
    if (result.created) created += 1;
    if (result.updated) updated += 1;
  }
  const existingAgentTasks = (tasks.data ?? []).filter(
    (task: any) => task.source_type === "ea_agent" && ACTIVE_TASK_STATUSES.includes(task.status),
  );
  const resolvedIds = existingAgentTasks
    .filter((task: any) => !activeKeys.has(task.source_key))
    .map((task: any) => task.id);
  if (resolvedIds.length) {
    const closed = await admin
      .from("shared_project_todos")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .in("id", resolvedIds);
    if (closed.error) throw closed.error;
  }
  return {
    created,
    updated,
    completed: resolvedIds.length,
    reopened,
    signals: signals.length,
    calendarAvailable: calendar.available,
    calendarMessage: calendar.message || null,
    neverSentAnything: true,
  };
}
