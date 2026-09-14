/* eslint-disable @typescript-eslint/no-explicit-any -- Studio snapshots are assembled from evolving Supabase tables. */
export const MERAV_DATA_DICTIONARY = [
  {
    term: "specified",
    definition:
      "A product or material appears in Studio. Specified does not mean approved, purchased, ordered, paid, shipped, or received.",
  },
  {
    term: "approved",
    definition:
      "An explicit Studio approval field or an attributable written approval says approved. Silence, specification, presentation, or contractor access is not approval.",
  },
  {
    term: "ordered",
    definition:
      "The procurement item is explicitly marked ordered, or dated source evidence states the order was placed. An intention to order, measurement visit, quote, deposit request, or introduction to a vendor is not an order.",
  },
  {
    term: "paid",
    definition:
      "A recorded payment is marked paid or source evidence confirms payment. An invoice, balance, deposit request, or draft payment is not proof of payment.",
  },
  {
    term: "agreement or commitment",
    definition:
      "An attributable message, transcript, note, or approved Studio record clearly commits a person or MERAV to an action. Plans, permissions, introductions, and assumptions are not commitments.",
  },
  {
    term: "waiting",
    definition:
      "Work is paused for a named client, vendor, builder, or internal response. It remains healthy until the recorded follow-up date unless another genuine risk exists.",
  },
  {
    term: "overdue",
    definition:
      "An unfinished task or milestone has an explicit due or target date earlier than today. Missing dates are missing information, not overdue work.",
  },
  {
    term: "last meaningful touch",
    definition:
      "The newest project-linked email, meeting, task change/completion, project note, voice memo, or linked calendar activity—not merely a project review timestamp.",
  },
  {
    term: "on hold",
    definition:
      "The project operation or authoritative current communication explicitly says work is paused. On-hold projects do not become overdue or require touches until resumed or their follow-up date arrives.",
  },
  {
    term: "latest document",
    definition:
      "The newest attributable revision by revision identifier and date. A later upload does not automatically supersede a clearly higher revision number without review.",
  },
  {
    term: "not found",
    definition:
      "The fact was not found in the evidence searched. It is not proof the event never happened unless the relevant source coverage is complete for the requested period.",
  },
] as const;

export const STUDIO_DATASETS = [
  "projects",
  "tasks",
  "milestones",
  "procurement",
  "invoices",
  "documents",
  "project_activity",
] as const;

export type StudioDataset = (typeof STUDIO_DATASETS)[number];

export type StudioReadRequest = {
  dataset: StudioDataset;
  project_id: string | null;
  status: string | null;
  date_from: string | null;
  date_to: string | null;
  search: string | null;
  limit: number;
};

export type MarvinVerification = {
  verdict: "verified" | "partially_verified" | "unsupported" | "conflict";
  confidence: "high" | "medium" | "low";
  summary: string;
  unsupported_claims: string[];
  conflicts: string[];
};

export function marvinDataDictionaryPrompt() {
  return MERAV_DATA_DICTIONARY.map(
    (entry) => `${entry.term.toUpperCase()}: ${entry.definition}`,
  ).join("\n");
}

export function normalizeStudioReadRequest(
  raw: Record<string, unknown>,
  selectedProjectId?: string | null,
): StudioReadRequest {
  const requestedDataset = String(raw.dataset || "projects") as StudioDataset;
  const dataset = STUDIO_DATASETS.includes(requestedDataset) ? requestedDataset : "projects";
  const clean = (value: unknown, max = 160) => {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
    return text || null;
  };
  return {
    dataset,
    project_id: selectedProjectId || clean(raw.project_id, 80),
    status: clean(raw.status, 80),
    date_from: dateValue(raw.date_from),
    date_to: dateValue(raw.date_to),
    search: clean(raw.search),
    limit: Math.max(1, Math.min(50, Number(raw.limit) || 25)),
  };
}

export function requiresIndependentVerification(question: string) {
  return /\b(agree|agreement|commit|promise|order|purchase|paid|payment|approve|approved|decline|send|sent|email|invoice|due|overdue|behind|at risk|on hold|waiting|latest|newest|current|how many|how much|square feet|sq\.?\s*ft|date|when|who|not found|no evidence|doesn'?t exist|never)\b/i.test(
    question,
  );
}

export function isCorrectionMessage(message: string) {
  return /\b(that(?:'s| is) not (?:right|correct)|you(?:'re| are) wrong|actually[, ]|i already|we already|there is (?:an?|one)|you missed|should be|doesn(?:'t| not) mean)\b/i.test(
    message,
  );
}

export function buildDeterministicStudioFacts(snapshot: any, today = localDateKey()) {
  if (!snapshot || snapshot.scope !== "project") return portfolioFacts(snapshot, today);
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  const milestones = Array.isArray(snapshot.milestones) ? snapshot.milestones : [];
  const products = Array.isArray(snapshot.products) ? snapshot.products : [];
  const procurement = Array.isArray(snapshot.procurement) ? snapshot.procurement : [];
  const invoices = Array.isArray(snapshot.invoices) ? snapshot.invoices : [];
  const payments = Array.isArray(snapshot.invoicePayments) ? snapshot.invoicePayments : [];
  const openTasks = tasks.filter((item: any) => !["complete", "cancelled"].includes(item.status));
  const approvedProducts = products.filter(
    (item: any) => item.approved === true || item.approval_status === "approved",
  );
  return {
    calculated_at: today,
    project_id: snapshot.project?.id || null,
    project_name: snapshot.project?.name || null,
    lifecycle_status: snapshot.operations?.lifecycle_status || snapshot.project?.status || null,
    task_counts: {
      total: tasks.length,
      open: openTasks.length,
      complete: tasks.filter((item: any) => item.status === "complete").length,
      waiting: openTasks.filter((item: any) => item.status === "waiting" || item.waiting_on).length,
      overdue: openTasks.filter((item: any) => item.due_date && item.due_date < today).length,
    },
    milestone_counts: {
      total: milestones.length,
      incomplete: milestones.filter((item: any) => !["complete", "skipped"].includes(item.status))
        .length,
      overdue: milestones.filter(
        (item: any) =>
          item.target_date &&
          item.target_date < today &&
          !["complete", "skipped"].includes(item.status),
      ).length,
    },
    product_counts: {
      specified: products.length,
      explicitly_approved: approvedProducts.length,
      explicitly_ordered: procurement.filter((item: any) => item.ordered === true).length,
      explicitly_received: procurement.filter((item: any) => item.received === true).length,
      explicitly_installed: procurement.filter((item: any) => item.installed === true).length,
    },
    financial_counts: {
      invoices: invoices.length,
      invoices_with_balance: invoices.filter((item: any) => Number(item.balance_due || 0) > 0)
        .length,
      recorded_paid_payments: payments.filter((item: any) => item.status === "paid").length,
    },
    document_count: Array.isArray(snapshot.documents) ? snapshot.documents.length : 0,
    follow_up_date: snapshot.operations?.follow_up_date || null,
    waiting_party: snapshot.operations?.waiting_party || null,
  };
}

export function formatVerificationBlock(verification: MarvinVerification) {
  const label =
    verification.verdict === "verified"
      ? "Verified"
      : verification.verdict === "partially_verified"
        ? "Partially verified"
        : verification.verdict === "conflict"
          ? "Conflicting evidence"
          : "Not verified";
  const details = [
    verification.summary,
    verification.unsupported_claims.length
      ? `Unsupported: ${verification.unsupported_claims.join("; ")}`
      : "",
    verification.conflicts.length ? `Conflicts: ${verification.conflicts.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `**Verification: ${label}** — ${details}`;
}

function portfolioFacts(snapshot: any, today: string) {
  const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  const milestones = Array.isArray(snapshot?.milestones) ? snapshot.milestones : [];
  return {
    calculated_at: today,
    project_count: projects.length,
    active_project_count: projects.filter(
      (item: any) => !["complete", "on hold"].includes(String(item.status || "").toLowerCase()),
    ).length,
    open_task_count: tasks.filter((item: any) => !["complete", "cancelled"].includes(item.status))
      .length,
    overdue_task_count: tasks.filter(
      (item: any) =>
        !["complete", "cancelled"].includes(item.status) && item.due_date && item.due_date < today,
    ).length,
    overdue_milestone_count: milestones.filter(
      (item: any) =>
        !["complete", "skipped"].includes(item.status) &&
        item.target_date &&
        item.target_date < today,
    ).length,
  };
}

function dateValue(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function localDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
