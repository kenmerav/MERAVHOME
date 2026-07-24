-- Procurement email is isolated from Marvin and exposes draft creation only.
-- Tile units live in each run's frozen requested_options JSON.

ALTER TABLE public.procurement_run_items
  DROP CONSTRAINT IF EXISTS procurement_run_items_status_check;

UPDATE public.procurement_run_items
SET status = 'drafted'
WHERE status = 'skipped'
  AND requested_options->>'procurement_method' = 'email_rep';

ALTER TABLE public.procurement_run_items
  ADD CONSTRAINT procurement_run_items_status_check
  CHECK (status IN (
    'prepared', 'queued', 'opening_product', 'selecting_options', 'added',
    'needs_review', 'option_mismatch', 'out_of_stock', 'backordered',
    'price_changed', 'login_required', 'captcha_required',
    'unsupported_retailer', 'failed', 'drafted', 'skipped', 'completed'
  ));

CREATE TABLE IF NOT EXISTS public.procurement_email_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  account_email text NOT NULL UNIQUE
    CHECK (lower(account_email) = 'ken@meravinteriors.com'),
  encrypted_credentials text NOT NULL,
  credential_iv text NOT NULL,
  credential_tag text NOT NULL,
  oauth_scope text,
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'error', 'disconnected')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS procurement_email_integrations_owner_key
  ON public.procurement_email_integrations(owner_user_id);

CREATE TABLE IF NOT EXISTS public.procurement_email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.procurement_runs(id) ON DELETE CASCADE,
  draft_key text NOT NULL,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  account_email text NOT NULL
    CHECK (lower(account_email) = 'ken@meravinteriors.com'),
  recipient_email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'created', 'failed')),
  gmail_draft_id text,
  gmail_thread_id text,
  created_in_gmail_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, draft_key)
);

CREATE INDEX IF NOT EXISTS procurement_email_drafts_run_status_idx
  ON public.procurement_email_drafts(run_id, status, updated_at);

DROP TRIGGER IF EXISTS procurement_email_integrations_touch
  ON public.procurement_email_integrations;
CREATE TRIGGER procurement_email_integrations_touch
BEFORE UPDATE ON public.procurement_email_integrations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS procurement_email_drafts_touch
  ON public.procurement_email_drafts;
CREATE TRIGGER procurement_email_drafts_touch
BEFORE UPDATE ON public.procurement_email_drafts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.procurement_email_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_email_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.procurement_email_integrations, public.procurement_email_drafts
  FROM anon, authenticated;
GRANT ALL ON public.procurement_email_integrations, public.procurement_email_drafts
  TO service_role;
