export type EaResponsibilityKey =
  | "commitments"
  | "meeting_preparation"
  | "meeting_followup"
  | "client_followup"
  | "vendor_coordination"
  | "procurement"
  | "project_files"
  | "billing_admin"
  | "travel_admin"
  | "research"
  | "process_memory"
  | "quality_control";

export type EaResponsibilityDefinition = {
  key: EaResponsibilityKey;
  label: string;
  description: string;
  automaticWork: string;
};

export type EaResponsibilityTask = {
  title: string;
  notes?: string | null;
  internal_notes?: string | null;
  source_type?: string | null;
  source_key?: string | null;
  status: string;
  priority?: string | null;
  due_date?: string | null;
  next_follow_up_date?: string | null;
  waiting_on?: string | null;
};

export type EaResponsibilitySummary = EaResponsibilityDefinition & {
  openCount: number;
  dueCount: number;
  waitingCount: number;
  urgentCount: number;
};

export const EA_RESPONSIBILITIES: EaResponsibilityDefinition[] = [
  {
    key: "commitments",
    label: "Commitments",
    description: "Own promises, decisions, deadlines, waiting items, and the next follow-up.",
    automaticWork: "Reopens follow-ups when due and keeps unresolved project work visible.",
  },
  {
    key: "meeting_preparation",
    label: "Meeting preparation",
    description:
      "Prepare project context, open decisions, recent changes, and questions in advance.",
    automaticWork: "Creates an internal brief for matched calendar meetings in the next two days.",
  },
  {
    key: "meeting_followup",
    label: "Meeting follow-through",
    description: "Turn meetings, voice memos, and notes into decisions, tasks, and drafts.",
    automaticWork: "Processes Fathom and project captures without sending the follow-up.",
  },
  {
    key: "client_followup",
    label: "Client deliverables",
    description: "Track approvals, selections, signatures, payments, measurements, and samples.",
    automaticWork: "Surfaces client follow-ups only when their recorded follow-up date arrives.",
  },
  {
    key: "vendor_coordination",
    label: "Vendors and trades",
    description:
      "Track quotes, samples, lead times, availability, damages, returns, and questions.",
    automaticWork: "Routes questions to verified contacts and flags incomplete vendor routes.",
  },
  {
    key: "procurement",
    label: "Procurement",
    description: "Monitor approved, ordered, received, backordered, damaged, and installed items.",
    automaticWork: "Flags approved items not ordered and orders that have not been received.",
  },
  {
    key: "project_files",
    label: "Project files",
    description: "Keep drawings, notes, attachments, and current revisions filed and searchable.",
    automaticWork:
      "Finds duplicate document titles and preserves the newest source as current evidence.",
  },
  {
    key: "billing_admin",
    label: "Invoices and billing",
    description:
      "Watch the project payment schedule and identify when the next invoice phase is earned.",
    automaticWork:
      "Reminds Katie at project start and Ken after a design presentation, design-document delivery, or project completion. It never sends an invoice or checks whether a client paid.",
  },
  {
    key: "travel_admin",
    label: "Travel and admin",
    description: "Prepare itineraries, confirmations, check-in reminders, renewals, and logistics.",
    automaticWork: "Creates internal preparation checklists from upcoming travel calendar items.",
  },
  {
    key: "research",
    label: "Research",
    description:
      "Find and compare products, vendors, contractors, services, and options with evidence.",
    automaticWork: "Researches on request and records the result as an internal decision aid.",
  },
  {
    key: "process_memory",
    label: "MERAV memory",
    description:
      "Retain approved preferences, responsibilities, vendor routes, and operating rules.",
    automaticWork: "Uses verified directory and playbook entries in future answers and drafts.",
  },
  {
    key: "quality_control",
    label: "Quality control",
    description:
      "Catch duplicates, contradictions, missing owners, stale dates, and weak evidence.",
    automaticWork:
      "Creates one internal exception review instead of silently guessing or duplicating work.",
  },
];

const ACTIVE_STATUSES = new Set(["open", "ready", "in_progress", "waiting", "blocked"]);

export function responsibilityForTask(task: EaResponsibilityTask): EaResponsibilityKey {
  const operatorMatch = String(task.source_key || "").match(/^ea-agent:([^:]+)/);
  if (operatorMatch && EA_RESPONSIBILITIES.some((item) => item.key === operatorMatch[1])) {
    return operatorMatch[1] as EaResponsibilityKey;
  }
  if (task.source_type === "ea_fathom") return "meeting_followup";
  const value = [task.title, task.notes, task.internal_notes, task.source_key]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(flight|airline|hotel|rental car|check.?in|itinerary|reservation|travel)/.test(value))
    return "travel_admin";
  if (/(invoice|balance|deposit|billable|billing|reimburse|payment)/.test(value))
    return "billing_admin";
  if (/(order|procure|shipment|shipping|delivery|backorder|received|installed)/.test(value))
    return "procurement";
  if (/(vendor|trade|quote|sample|lead time|availability|damage|return)/.test(value))
    return "vendor_coordination";
  if (/(meeting|agenda|presentation|site visit|regroup|call)/.test(value))
    return "meeting_followup";
  if (task.waiting_on === "client" || /(client approval|client selection|signature)/.test(value))
    return "client_followup";
  if (/(drawing|construction doc|document|attachment|revision|file)/.test(value))
    return "project_files";
  if (/(research|compare|recommend|find options)/.test(value)) return "research";
  return "commitments";
}

export function summarizeEaResponsibilities(
  tasks: EaResponsibilityTask[],
  today = new Date().toISOString().slice(0, 10),
): EaResponsibilitySummary[] {
  return EA_RESPONSIBILITIES.map((definition) => {
    const matching = tasks.filter(
      (task) => ACTIVE_STATUSES.has(task.status) && responsibilityForTask(task) === definition.key,
    );
    return {
      ...definition,
      openCount: matching.length,
      dueCount: matching.filter((task) => {
        const due = task.next_follow_up_date || task.due_date;
        return Boolean(due && due <= today);
      }).length,
      waitingCount: matching.filter((task) => task.status === "waiting" || Boolean(task.waiting_on))
        .length,
      urgentCount: matching.filter((task) => task.priority === "high" || task.status === "blocked")
        .length,
    };
  });
}

export function normalizedEaTaskSignature(projectId: string | null, title: string) {
  return `${projectId || "general"}:${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()}`;
}

export const EA_INTERNAL_ONLY_POLICY = {
  automatic: [
    "read and organize evidence",
    "update internal Studio records",
    "create internal tasks and briefs",
    "prepare drafts for approval",
  ],
  confirmationRequired: ["add an internal Apple Calendar event"],
  never: [
    "send email or messages",
    "invite attendees",
    "place orders",
    "make payments",
    "book travel",
    "sign or approve externally",
  ],
} as const;
