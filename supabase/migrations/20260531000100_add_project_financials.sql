CREATE TABLE IF NOT EXISTS public.financial_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name text,
  pdf_data_url text,
  invoice_date date,
  client_name text,
  provider_name text,
  total_amount numeric,
  paid_amount numeric,
  balance_due numeric,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.financial_invoices(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  due_date date,
  status text NOT NULL DEFAULT 'due',
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_invoices_project_id_idx ON public.financial_invoices(project_id);
CREATE INDEX IF NOT EXISTS financial_invoice_payments_project_id_idx ON public.financial_invoice_payments(project_id);
CREATE INDEX IF NOT EXISTS financial_invoice_payments_invoice_id_idx ON public.financial_invoice_payments(invoice_id);

DROP TRIGGER IF EXISTS financial_invoices_touch ON public.financial_invoices;
CREATE TRIGGER financial_invoices_touch
BEFORE UPDATE ON public.financial_invoices
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS financial_invoice_payments_touch ON public.financial_invoice_payments;
CREATE TRIGGER financial_invoice_payments_touch
BEFORE UPDATE ON public.financial_invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_invoices TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_invoice_payments TO anon, authenticated;
GRANT ALL ON public.financial_invoices, public.financial_invoice_payments TO service_role;

ALTER TABLE public.financial_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open all" ON public.financial_invoices;
CREATE POLICY "open all" ON public.financial_invoices FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open all" ON public.financial_invoice_payments;
CREATE POLICY "open all" ON public.financial_invoice_payments FOR ALL USING (true) WITH CHECK (true);
