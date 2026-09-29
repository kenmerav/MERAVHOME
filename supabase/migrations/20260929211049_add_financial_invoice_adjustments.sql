CREATE TABLE IF NOT EXISTS public.financial_invoice_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.financial_invoices(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('credit', 'charge')),
  label text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'open',
  notes text,
  settled_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_invoice_adjustments_status_check CHECK (
    (adjustment_type = 'credit' AND status IN ('open', 'refunded', 'applied', 'void'))
    OR
    (adjustment_type = 'charge' AND status IN ('open', 'paid', 'waived', 'void'))
  )
);

CREATE INDEX IF NOT EXISTS financial_invoice_adjustments_invoice_id_idx
  ON public.financial_invoice_adjustments(invoice_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS financial_invoice_adjustments_project_id_idx
  ON public.financial_invoice_adjustments(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS financial_invoice_adjustments_created_by_idx
  ON public.financial_invoice_adjustments(created_by);

DROP TRIGGER IF EXISTS financial_invoice_adjustments_touch ON public.financial_invoice_adjustments;
CREATE TRIGGER financial_invoice_adjustments_touch
BEFORE UPDATE ON public.financial_invoice_adjustments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_invoice_adjustments TO authenticated;
GRANT ALL ON public.financial_invoice_adjustments TO service_role;

ALTER TABLE public.financial_invoice_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ken and katie financial adjustments" ON public.financial_invoice_adjustments;
CREATE POLICY "ken and katie financial adjustments"
ON public.financial_invoice_adjustments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
);
