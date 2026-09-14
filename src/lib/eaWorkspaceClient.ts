import { supabase } from "@/integrations/supabase/client";
import type { EaContact, EaVendorProfile } from "@/lib/eaWorkspace";
import type {
  CreateEaCalendarEventInput,
  CreateEaCalendarEventResult,
  EaCalendarData,
} from "@/lib/appleCalendar.server";
import type { EaProjectHealth } from "@/lib/eaProjectHealth";
import type { MarvinMessage } from "@/lib/marvin";

export type EaProject = {
  id: string;
  name: string;
  client_name: string;
  status: string;
  project_type: string;
  cover_image_url: string | null;
  created_at: string | null;
  updated_at: string;
  accepted_date: string | null;
  promised_completion_date: string | null;
  forecast_completion_date: string | null;
  health_override: "on_track" | "at_risk" | "critical" | "late" | null;
  health_override_reason: string | null;
};

export type EaProjectOperations = {
  project_id: string;
  lifecycle_status: "active" | "on_hold" | "completed";
  phase: string | null;
  aliases: string[];
  next_milestone: string | null;
  current_blocker: string | null;
  waiting_party: string | null;
  next_action: string | null;
  responsible_user_id: string | null;
  responsible_contact_id: string | null;
  follow_up_date: string | null;
  last_reviewed_at: string | null;
  reviewed_by: string | null;
};

export type EaProjectAssignment = {
  id: string;
  project_id: string;
  contact_id: string;
  role_on_project: string;
  responsibilities: string | null;
  ask_them_about: string | null;
  preferred_communication: string | null;
  verification_status: string;
  source_type: string | null;
  source_reference: string | null;
  contact: EaContact;
  copy_contact?: EaContact | null;
  backup_contact?: EaContact | null;
};

export type EaTask = {
  id: string;
  project_id: string | null;
  assigned_user_id: string | null;
  recommended_assignee_id: string | null;
  title: string;
  notes: string | null;
  internal_notes: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  reminder_date: string | null;
  next_follow_up_date: string | null;
  ea_next_action: string | null;
  waiting_on: string | null;
  acknowledged_at: string | null;
  completion_evidence: string | null;
  work_artifact_kind: "work_note" | "email_draft" | "action_plan" | null;
  work_artifact_text: string | null;
  approval_status: "draft" | "pending" | "approved" | "changes_requested";
  approval_requested_at: string | null;
  approval_reviewed_at: string | null;
  completed_at: string | null;
  link_url: string | null;
  source_type?: string | null;
  source_key?: string | null;
  relevant_contact_id: string | null;
  waiting_contact_id: string | null;
  project?: { id: string; name: string; client_name: string } | null;
  assigned_user?: { id: string; email: string; full_name: string } | null;
  recommended_assignee?: { id: string; email: string; full_name: string } | null;
  relevant_contact?: Pick<EaContact, "id" | "name" | "company" | "email" | "phone"> | null;
  waiting_contact?: Pick<EaContact, "id" | "name" | "company" | "email" | "phone"> | null;
};

export type EaImportRow = {
  id: string;
  source_row_number: number;
  safe_payload: {
    vendor: string;
    category?: string | null;
    rep_name?: string | null;
    rep_email?: string | null;
  };
  review_status: "needs_review" | "approved" | "skipped" | "conflict";
  review_notes: string | null;
  matched_vendor_id: string | null;
  matched_contact_id: string | null;
};

export type EaProjectEmail = {
  id: string;
  title: string;
  summary: string | null;
  author_name: string | null;
  author_email: string | null;
  occurred_at: string | null;
  source_url: string | null;
  processing_status: "pending" | "processing" | "ready" | "failed";
  projects: Array<{ id: string; name: string; client_name: string | null }>;
};

export type EaWorkspaceData = {
  projects: EaProject[];
  operations: EaProjectOperations[];
  assignments: EaProjectAssignment[];
  contacts: EaContact[];
  vendors: EaVendorProfile[];
  tasks: EaTask[];
  milestones: Array<{
    id: string;
    project_id: string;
    title: string;
    stage: string;
    status: string;
    target_date: string | null;
    is_critical: boolean;
  }>;
  profiles: Array<{ id: string; email: string; full_name: string; role: string }>;
  importRows: EaImportRow[];
  syncStatus: Array<{
    provider: string;
    account_email: string | null;
    status: string;
    last_sync_at: string | null;
    last_error: string | null;
    updated_at: string;
  }>;
  fathomReview: Array<{
    id: string;
    title: string;
    occurred_at: string | null;
    source_url: string | null;
    suggested_project_id: string | null;
    match_confidence: number | null;
    match_reason: string | null;
  }>;
  emails: EaProjectEmail[];
  projectHealth: EaProjectHealth[];
  memoryRules: Array<{
    id: string;
    title: string;
    body_text: string;
    occurred_at: string | null;
  }>;
  setupNeeded?: boolean;
  canManageAccess?: boolean;
  canReviewApprovals?: boolean;
  viewer?: { id: string; email: string; full_name: string | null } | null;
};

export async function loadEaWorkspace(): Promise<EaWorkspaceData> {
  const token = await authToken();
  const response = await fetch("/api/ea-workspace", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Unable to load EA Desk.");
  return body as EaWorkspaceData;
}

export async function saveEaWorkspace(payload: Record<string, unknown>) {
  const token = await authToken();
  const response = await fetch("/api/ea-workspace", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Unable to save EA Desk changes.");
  return body;
}

export async function askEaAgent(payload: {
  project_id: string;
  conversation_id?: string | null;
  message: string;
}): Promise<{ conversationId: string; message: MarvinMessage }> {
  const token = await authToken();
  const response = await fetch("/api/marvin", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "chat", ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "The EA Agent could not answer right now.");
  return body;
}

export async function loadEaCalendar(refresh = false): Promise<EaCalendarData> {
  const token = await authToken();
  const response = await fetch(`/api/ea-calendar${refresh ? "?refresh=1" : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Unable to load Apple Calendar.");
  return body as EaCalendarData;
}

export async function createEaCalendarEvent(
  payload: CreateEaCalendarEventInput,
): Promise<CreateEaCalendarEventResult> {
  const token = await authToken();
  const response = await fetch("/api/ea-calendar", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Unable to add the appointment.");
  return body as CreateEaCalendarEventResult;
}

export async function loadEaDocumentEvidence(documentId: string, pageNumber: number) {
  const token = await authToken();
  const params = new URLSearchParams({
    document_id: documentId,
    page: String(pageNumber),
  });
  const response = await fetch(`/api/ea-document-evidence?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || "Unable to render the construction-document evidence.");
  }
  return URL.createObjectURL(await response.blob());
}

async function authToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to continue.");
  return token;
}
