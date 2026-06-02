ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS presentation_rendering_image_id uuid REFERENCES public.room_images(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS presentation_sketchup_image_id uuid REFERENCES public.room_images(id) ON DELETE SET NULL;

