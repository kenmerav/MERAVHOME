DROP POLICY IF EXISTS "open all" ON public.financial_invoices;
DROP POLICY IF EXISTS "open all" ON public.financial_invoice_payments;

CREATE POLICY "ken and katie financial invoices"
ON public.financial_invoices
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
);

CREATE POLICY "ken and katie financial payments"
ON public.financial_invoice_payments
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
);
