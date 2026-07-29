ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_can_download_design_board_pdf boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contractor_can_download_design_board_pdf boolean NOT NULL DEFAULT false;
