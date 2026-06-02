ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS presentation_overlay_label text,
  ADD COLUMN IF NOT EXISTS presentation_overlay_body text;
