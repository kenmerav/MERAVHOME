ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS approval_visible boolean NOT NULL DEFAULT true;

ALTER TABLE public.room_products
  ADD COLUMN IF NOT EXISTS approval_visible boolean NOT NULL DEFAULT true;
