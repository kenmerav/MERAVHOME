ALTER TABLE public.room_images
  ADD COLUMN IF NOT EXISTS team_notes text;
