ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS cover_image_url text;
