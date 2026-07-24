-- Marvin is private to server APIs. Browser roles receive no table or bucket privileges.
CREATE TABLE IF NOT EXISTS public.marvin_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('gmail', 'fathom', 'openai')),
  owner_user_id uuid REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  account_email text,
  encrypted_credentials text,
  credential_iv text,
  credential_tag text,
  gmail_history_id text,
  external_webhook_id text,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marvin_integrations_provider_account_key
  ON public.marvin_integrations(provider, lower(account_email))
  WHERE account_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marvin_integrations_provider_owner_key
  ON public.marvin_integrations(provider, owner_user_id);

CREATE TABLE IF NOT EXISTS public.marvin_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('email', 'email_attachment', 'fathom', 'note', 'transcript', 'document', 'voice_memo')),
  external_provider text,
  external_id text,
  external_thread_id text,
  title text NOT NULL,
  body_text text,
  summary text,
  author_name text,
  author_email text,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurred_at timestamptz,
  source_url text,
  storage_path text,
  mime_type text,
  file_size bigint,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'linked', 'dismissed')),
  knowledge_scope text NOT NULL DEFAULT 'project' CHECK (knowledge_scope IN ('project', 'general')),
  suggested_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  match_confidence numeric(5,4),
  match_reason text,
  processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  processing_error text,
  content_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marvin_sources_external_key
  ON public.marvin_sources(external_provider, external_id);
CREATE INDEX IF NOT EXISTS marvin_sources_review_idx
  ON public.marvin_sources(review_status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS marvin_sources_thread_idx
  ON public.marvin_sources(external_provider, external_thread_id);

CREATE TABLE IF NOT EXISTS public.marvin_source_projects (
  source_id uuid NOT NULL REFERENCES public.marvin_sources(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  confirmed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, project_id)
);

CREATE TABLE IF NOT EXISTS public.marvin_source_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.marvin_sources(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  segment_scope text NOT NULL CHECK (segment_scope IN ('project', 'general')),
  summary text NOT NULL,
  details text NOT NULL,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  has_content boolean NOT NULL DEFAULT true,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (segment_scope = 'project' AND project_id IS NOT NULL)
    OR (segment_scope = 'general' AND project_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS marvin_source_segments_project_key
  ON public.marvin_source_segments(source_id, project_id)
  WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marvin_source_segments_general_key
  ON public.marvin_source_segments(source_id)
  WHERE project_id IS NULL;

CREATE TABLE IF NOT EXISTS public.marvin_project_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contact_type text NOT NULL DEFAULT 'other' CHECK (contact_type IN ('client', 'gc', 'vendor', 'architect', 'employee', 'other')),
  name text,
  email text,
  alias text,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (nullif(trim(coalesce(email, '')), '') IS NOT NULL OR nullif(trim(coalesce(alias, '')), '') IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS marvin_project_contacts_email_key
  ON public.marvin_project_contacts(project_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS marvin_project_contacts_alias_idx
  ON public.marvin_project_contacts(project_id, lower(alias)) WHERE alias IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.marvin_index_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.marvin_sources(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  openai_file_id text,
  vector_store_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'deleted')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, project_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS marvin_index_files_general_source_key
  ON public.marvin_index_files(source_id)
  WHERE project_id IS NULL;

CREATE TABLE IF NOT EXISTS public.marvin_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marvin_conversations_user_idx
  ON public.marvin_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.marvin_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.marvin_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marvin_messages_conversation_idx
  ON public.marvin_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.marvin_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  briefing_date date NOT NULL,
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'partial', 'failed')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz,
  source_cutoff_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, briefing_date)
);

CREATE TABLE IF NOT EXISTS public.marvin_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id uuid REFERENCES public.marvin_briefings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.marvin_sources(id) ON DELETE SET NULL,
  fingerprint text NOT NULL,
  title text NOT NULL,
  notes text,
  reason text,
  priority text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  due_date date,
  recommended_assignee_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
  approved_todo_id uuid REFERENCES public.shared_project_todos(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS public.marvin_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  owner_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'partial', 'complete', 'failed')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marvin_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, external_id)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'marvin_integrations', 'marvin_sources', 'marvin_source_segments', 'marvin_project_contacts',
    'marvin_index_files', 'marvin_conversations', 'marvin_briefings', 'marvin_suggestions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      table_name, table_name
    );
  END LOOP;
END $$;

ALTER TABLE public.marvin_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_source_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_source_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_project_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_index_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marvin_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.marvin_integrations, public.marvin_sources, public.marvin_source_projects,
  public.marvin_source_segments,
  public.marvin_project_contacts, public.marvin_index_files, public.marvin_conversations,
  public.marvin_messages, public.marvin_briefings, public.marvin_suggestions,
  public.marvin_sync_jobs, public.marvin_webhook_events FROM anon, authenticated;
GRANT ALL ON public.marvin_integrations, public.marvin_sources, public.marvin_source_projects,
  public.marvin_source_segments,
  public.marvin_project_contacts, public.marvin_index_files, public.marvin_conversations,
  public.marvin_messages, public.marvin_briefings, public.marvin_suggestions,
  public.marvin_sync_jobs, public.marvin_webhook_events TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marvin-sources',
  'marvin-sources',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/markdown',
    'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "marvin source files are server only" ON storage.objects;
CREATE POLICY "marvin source files are server only"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'marvin-sources')
WITH CHECK (bucket_id = 'marvin-sources');
