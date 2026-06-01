ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS approval_show_vendor boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_show_pricing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_show_quantity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_show_dimensions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_show_finish boolean NOT NULL DEFAULT true;
