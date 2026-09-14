-- One-time, per-user Studio notices for construction documents filed by the EA intake.
-- Browser roles have no direct access; authenticated server routes enforce recipients.

CREATE TABLE IF NOT EXISTS public.studio_construction_document_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_document_id uuid NOT NULL UNIQUE
    REFERENCES public.project_documents(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.marvin_sources(id) ON DELETE SET NULL,
  project_name text NOT NULL,
  file_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.studio_construction_document_notification_recipients (
  notification_id uuid NOT NULL
    REFERENCES public.studio_construction_document_notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS studio_construction_document_notification_recipients_unseen_idx
  ON public.studio_construction_document_notification_recipients(user_id, created_at DESC)
  WHERE seen_at IS NULL;

ALTER TABLE public.studio_construction_document_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_construction_document_notification_recipients ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
  public.studio_construction_document_notifications,
  public.studio_construction_document_notification_recipients
FROM anon, authenticated;

GRANT ALL ON
  public.studio_construction_document_notifications,
  public.studio_construction_document_notification_recipients
TO service_role;
