-- Internal login notices for calendar events created from the EA Desk.
-- Browser roles have no direct access; authenticated server routes enforce recipients.

CREATE TABLE IF NOT EXISTS public.studio_calendar_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id text NOT NULL UNIQUE,
  task_id uuid REFERENCES public.shared_project_todos(id) ON DELETE SET NULL,
  calendar_name text NOT NULL,
  title text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  location text,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.studio_calendar_notification_recipients (
  notification_id uuid NOT NULL REFERENCES public.studio_calendar_notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS studio_calendar_notification_recipients_unseen_idx
  ON public.studio_calendar_notification_recipients(user_id, created_at DESC)
  WHERE seen_at IS NULL;

ALTER TABLE public.studio_calendar_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_calendar_notification_recipients ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
  public.studio_calendar_notifications,
  public.studio_calendar_notification_recipients
FROM anon, authenticated;

GRANT ALL ON
  public.studio_calendar_notifications,
  public.studio_calendar_notification_recipients
TO service_role;
