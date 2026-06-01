ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS approval_live boolean NOT NULL DEFAULT false;
