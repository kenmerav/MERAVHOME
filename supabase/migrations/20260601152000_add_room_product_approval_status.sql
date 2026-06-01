ALTER TABLE public.room_products
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'undecided',
  ADD COLUMN IF NOT EXISTS approval_comment text,
  ADD COLUMN IF NOT EXISTS approval_updated_at timestamptz;

ALTER TABLE public.room_products
  DROP CONSTRAINT IF EXISTS room_products_approval_status_check;

ALTER TABLE public.room_products
  ADD CONSTRAINT room_products_approval_status_check
  CHECK (approval_status IN ('undecided', 'approved', 'declined'));

UPDATE public.room_products
SET approval_status = 'approved',
    approval_updated_at = COALESCE(approval_updated_at, created_at, now())
WHERE approved = true;
