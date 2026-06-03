ALTER TABLE public.financial_invoice_payments
  ADD COLUMN IF NOT EXISTS stripe_payment_link_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS financial_invoice_payments_stripe_payment_link_id_idx
  ON public.financial_invoice_payments(stripe_payment_link_id)
  WHERE stripe_payment_link_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS financial_invoice_payments_stripe_checkout_session_id_idx
  ON public.financial_invoice_payments(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS financial_invoice_payments_stripe_payment_intent_id_idx
  ON public.financial_invoice_payments(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
