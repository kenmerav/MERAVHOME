ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS contractor_spec_can_update_ordering boolean NOT NULL DEFAULT false;
