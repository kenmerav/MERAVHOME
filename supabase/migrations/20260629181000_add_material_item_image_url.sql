ALTER TABLE public.material_items
  ADD COLUMN IF NOT EXISTS image_url text;
