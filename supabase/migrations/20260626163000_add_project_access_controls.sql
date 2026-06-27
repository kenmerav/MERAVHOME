ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_can_view_spec_book boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_can_view_presentations boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_can_view_design_boards boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_spec_show_pricing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_spec_show_links boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contractor_can_view_spec_book boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contractor_can_view_presentations boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contractor_can_view_design_boards boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contractor_spec_show_pricing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contractor_spec_show_links boolean NOT NULL DEFAULT true;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_view_all_projects boolean NOT NULL DEFAULT true;

UPDATE public.user_profiles
SET can_view_all_projects = false
WHERE role IN ('Client', 'Contractor');
