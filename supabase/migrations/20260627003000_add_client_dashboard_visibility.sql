ALTER TABLE public.financial_invoices
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_timelines
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS financial_invoices_project_client_visible_idx
  ON public.financial_invoices(project_id, client_visible, invoice_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS project_timelines_project_client_visible_idx
  ON public.project_timelines(project_id, client_visible, timeline_date ASC, created_at DESC);
