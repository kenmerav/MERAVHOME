ALTER TABLE public.room_images
  ADD COLUMN IF NOT EXISTS presentation_visible boolean NOT NULL DEFAULT true;
