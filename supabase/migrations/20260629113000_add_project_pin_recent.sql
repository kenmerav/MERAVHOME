ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS projects_pin_recent_idx
  ON public.projects(is_pinned DESC, last_opened_at DESC NULLS LAST, updated_at DESC);
