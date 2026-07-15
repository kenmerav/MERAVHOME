ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_can_download_construction_docs boolean NOT NULL DEFAULT false;
