CREATE TABLE IF NOT EXISTS public.quickbooks_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id text NOT NULL UNIQUE,
  environment text NOT NULL DEFAULT 'sandbox',
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quickbooks_project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  realm_id text NOT NULL,
  quickbooks_customer_id text,
  quickbooks_customer_name text,
  quickbooks_project_id text,
  quickbooks_project_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, realm_id)
);

ALTER TABLE public.financial_invoices
  ADD COLUMN IF NOT EXISTS quickbooks_invoice_id text,
  ADD COLUMN IF NOT EXISTS quickbooks_sync_status text NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS quickbooks_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS quickbooks_sync_error text;

ALTER TABLE public.financial_invoice_payments
  ADD COLUMN IF NOT EXISTS quickbooks_payment_id text,
  ADD COLUMN IF NOT EXISTS quickbooks_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS quickbooks_sync_error text;

CREATE INDEX IF NOT EXISTS quickbooks_connections_active_idx
  ON public.quickbooks_connections(is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS quickbooks_project_links_project_id_idx
  ON public.quickbooks_project_links(project_id);

CREATE INDEX IF NOT EXISTS financial_invoices_quickbooks_status_idx
  ON public.financial_invoices(quickbooks_sync_status, updated_at DESC);

DROP TRIGGER IF EXISTS quickbooks_connections_touch ON public.quickbooks_connections;
CREATE TRIGGER quickbooks_connections_touch
BEFORE UPDATE ON public.quickbooks_connections
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS quickbooks_project_links_touch ON public.quickbooks_project_links;
CREATE TRIGGER quickbooks_project_links_touch
BEFORE UPDATE ON public.quickbooks_project_links
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT ALL ON public.quickbooks_connections, public.quickbooks_project_links TO service_role;

ALTER TABLE public.quickbooks_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quickbooks_project_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role only" ON public.quickbooks_connections;
CREATE POLICY "service role only" ON public.quickbooks_connections
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service role only" ON public.quickbooks_project_links;
CREATE POLICY "service role only" ON public.quickbooks_project_links
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
