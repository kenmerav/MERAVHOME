CREATE TABLE public.product_invoice_internal_costs (
  invoice_id uuid PRIMARY KEY REFERENCES public.financial_invoices(id) ON DELETE CASCADE,
  shipping_cost numeric(12, 2) CHECK (shipping_cost >= 0 AND shipping_cost < 'NaN'::numeric),
  fee_costs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(fee_costs) = 'object'
    AND NOT jsonb_path_exists(
      fee_costs,
      'strict $.* ? (@.type() != "number" || @ < 0 || @ > 9999999999.99 || @ * 100 != (@ * 100).floor())'
    )
  ),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);

ALTER TABLE public.product_invoice_internal_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_invoice_internal_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_invoice_internal_costs TO authenticated;

CREATE POLICY "Ken and Katie procurement invoice costs"
ON public.product_invoice_internal_costs
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
);
