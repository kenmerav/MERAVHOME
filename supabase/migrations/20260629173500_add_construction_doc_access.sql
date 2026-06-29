ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_can_view_construction_docs boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contractor_can_view_construction_docs boolean NOT NULL DEFAULT false;
