export type MarvinSourceType =
  | "email"
  | "email_attachment"
  | "fathom"
  | "note"
  | "transcript"
  | "document"
  | "voice_memo";

export type MarvinReviewStatus = "pending" | "linked" | "dismissed";
export type MarvinSuggestionStatus = "pending" | "approved" | "dismissed";

export interface MarvinProjectOption {
  id: string;
  name: string;
  client_name?: string | null;
  status?: string | null;
}

export interface MarvinEmployeeOption {
  id: string;
  email: string;
  full_name?: string | null;
  role?: string | null;
}

export interface MarvinSourceSegment {
  id: string;
  project_id?: string | null;
  segment_scope: "project" | "general";
  summary: string;
  details: string;
  topics?: string[];
  action_items?: Array<{ text: string; owner?: string | null; due_date?: string | null }>;
  has_content: boolean;
  project?: MarvinProjectOption | null;
}

export interface MarvinSource {
  id: string;
  source_type: MarvinSourceType;
  title: string;
  summary?: string | null;
  content_preview?: string | null;
  author_name?: string | null;
  author_email?: string | null;
  occurred_at?: string | null;
  source_url?: string | null;
  review_status: MarvinReviewStatus;
  knowledge_scope?: "project" | "general";
  suggested_project_id?: string | null;
  match_confidence?: number | null;
  match_reason?: string | null;
  processing_status: "pending" | "processing" | "ready" | "failed";
  processing_error?: string | null;
  projects?: MarvinProjectOption[];
  segments?: MarvinSourceSegment[];
  metadata?: Record<string, unknown> | null;
}

export interface MarvinIntegration {
  id: string;
  provider: "gmail" | "fathom";
  account_email?: string | null;
  status: "connected" | "disconnected" | "error";
  last_sync_at?: string | null;
  last_error?: string | null;
}

export interface MarvinCitation {
  sourceId?: string;
  title: string;
  url?: string | null;
  sourceType?: MarvinSourceType | "studio";
}

export interface MarvinMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: MarvinCitation[];
  created_at: string;
}

export interface MarvinSuggestion {
  id: string;
  project_id: string;
  project_name?: string;
  title: string;
  notes?: string | null;
  priority: "Low" | "Medium" | "High" | "Urgent";
  due_date?: string | null;
  estimated_hours?: number | null;
  required_capability?: string | null;
  assignee_reason?: string | null;
  recommended_assignee_id?: string | null;
  recommended_assignee?: MarvinEmployeeOption | null;
  status: MarvinSuggestionStatus;
  reason?: string | null;
  source_id?: string | null;
  source?: {
    id: string;
    title: string;
    source_url?: string | null;
    source_type?: MarvinSourceType;
    occurred_at?: string | null;
  } | null;
}

export interface MarvinBriefing {
  id: string;
  briefing_date: string;
  status: "generating" | "ready" | "partial" | "failed";
  content: {
    summary?: string;
    items?: Array<{
      projectId: string;
      projectName: string;
      priority: string;
      reason: string;
      nextAction: string;
      sourceId?: string;
    }>;
  };
  generated_at?: string | null;
  error?: string | null;
}

export interface MarvinBootstrap {
  projects: MarvinProjectOption[];
  employees: MarvinEmployeeOption[];
  integrations: MarvinIntegration[];
  sources: MarvinSource[];
  review: MarvinSource[];
  briefing: MarvinBriefing | null;
  suggestions: MarvinSuggestion[];
  conversations: Array<{
    id: string;
    project_id?: string | null;
    title: string;
    updated_at: string;
  }>;
  setupNeeded?: boolean;
}
