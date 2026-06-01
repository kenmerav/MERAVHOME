ALTER TABLE public.financial_invoice_payments
  DROP CONSTRAINT IF EXISTS financial_invoice_payments_project_id_fkey;

ALTER TABLE public.financial_invoices
  DROP CONSTRAINT IF EXISTS financial_invoices_project_id_fkey;

ALTER TABLE public.financial_invoice_payments
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.financial_invoices
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.financial_invoices
  ADD CONSTRAINT financial_invoices_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE public.financial_invoice_payments
  ADD CONSTRAINT financial_invoice_payments_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
