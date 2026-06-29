CREATE TABLE IF NOT EXISTS public.studio_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  notes text,
  due_date date,
  reminder_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  assigned_to text NOT NULL DEFAULT 'studio' CHECK (assigned_to IN ('ken', 'katie', 'studio')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_reminders_status_due_idx
  ON public.studio_reminders(status, due_date, reminder_date, created_at);

CREATE INDEX IF NOT EXISTS studio_reminders_project_idx
  ON public.studio_reminders(project_id);

DROP TRIGGER IF EXISTS studio_reminders_touch ON public.studio_reminders;
CREATE TRIGGER studio_reminders_touch
BEFORE UPDATE ON public.studio_reminders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_reminders TO authenticated;
GRANT ALL ON public.studio_reminders TO service_role;

ALTER TABLE public.studio_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "studio reminders no direct client access" ON public.studio_reminders;
CREATE POLICY "studio reminders no direct client access"
ON public.studio_reminders
FOR ALL
USING (false)
WITH CHECK (false);
