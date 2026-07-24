-- Merav Cart Builder runs are private to trusted server routes and MCP tools.
-- Product requirements are frozen here so later Spec Book edits cannot alter an active run.
CREATE TABLE IF NOT EXISTS public.procurement_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  source_run_id uuid REFERENCES public.procurement_runs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'in_progress', 'completed', 'cancelled', 'expired')),
  selection_fingerprint text NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  token_revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  access_window_started_at timestamptz,
  access_request_count integer NOT NULL DEFAULT 0 CHECK (access_request_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS procurement_runs_active_selection_key
  ON public.procurement_runs(project_id, created_by, selection_fingerprint)
  WHERE status IN ('prepared', 'in_progress') AND token_revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS procurement_runs_project_created_idx
  ON public.procurement_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS procurement_runs_expires_idx
  ON public.procurement_runs(expires_at)
  WHERE token_revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.procurement_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.procurement_runs(id) ON DELETE CASCADE,
  spec_book_item_id uuid NOT NULL REFERENCES public.material_items(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  room_name text NOT NULL,
  product_name text NOT NULL,
  vendor text,
  retailer_domain text NOT NULL,
  product_url text NOT NULL,
  sku text,
  requested_quantity numeric NOT NULL CHECK (requested_quantity > 0),
  requested_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_price numeric,
  product_image_url text,
  source_notes text,
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN (
      'prepared', 'queued', 'opening_product', 'selecting_options', 'added',
      'needs_review', 'option_mismatch', 'out_of_stock', 'backordered',
      'price_changed', 'login_required', 'captcha_required',
      'unsupported_retailer', 'failed', 'skipped', 'completed'
    )),
  observed_product_title text,
  observed_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_price numeric,
  observed_availability text,
  result_notes text,
  retailer_cart_url text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, spec_book_item_id)
);

CREATE INDEX IF NOT EXISTS procurement_run_items_run_status_idx
  ON public.procurement_run_items(run_id, status, updated_at);

DROP TRIGGER IF EXISTS procurement_runs_touch ON public.procurement_runs;
CREATE TRIGGER procurement_runs_touch
BEFORE UPDATE ON public.procurement_runs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS procurement_run_items_touch ON public.procurement_run_items;
CREATE TRIGGER procurement_run_items_touch
BEFORE UPDATE ON public.procurement_run_items
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.procurement_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_run_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.procurement_runs, public.procurement_run_items FROM anon, authenticated;
GRANT ALL ON public.procurement_runs, public.procurement_run_items TO service_role;

-- Atomically verifies a one-run token and enforces a per-run request window.
-- Invalid, expired, revoked, cancelled, and completed runs return no rows.
CREATE OR REPLACE FUNCTION public.authorize_procurement_run(
  p_token_hash text,
  p_max_requests integer DEFAULT 120,
  p_window_seconds integer DEFAULT 60
)
RETURNS TABLE(run_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.procurement_runs%ROWTYPE;
  window_cutoff timestamptz := now() - make_interval(secs => greatest(p_window_seconds, 1));
BEGIN
  SELECT *
  INTO target
  FROM public.procurement_runs
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND
    OR target.token_revoked_at IS NOT NULL
    OR target.expires_at <= now()
    OR target.status IN ('completed', 'cancelled', 'expired')
  THEN
    RETURN;
  END IF;

  IF target.access_window_started_at IS NULL
    OR target.access_window_started_at < window_cutoff
  THEN
    UPDATE public.procurement_runs
    SET access_window_started_at = now(), access_request_count = 1
    WHERE id = target.id;
  ELSIF target.access_request_count >= greatest(p_max_requests, 1) THEN
    RAISE EXCEPTION 'procurement_rate_limit_exceeded' USING ERRCODE = 'P0001';
  ELSE
    UPDATE public.procurement_runs
    SET access_request_count = access_request_count + 1
    WHERE id = target.id;
  END IF;

  RETURN QUERY SELECT target.id;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_procurement_run(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_procurement_run(text, integer, integer)
  TO service_role;
