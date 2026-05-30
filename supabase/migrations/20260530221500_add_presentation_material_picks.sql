ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS presentation_palette_item_ids uuid[],
  ADD COLUMN IF NOT EXISTS presentation_cabinet_item_id uuid REFERENCES public.material_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS presentation_counter_item_id uuid REFERENCES public.material_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS presentation_faucet_item_id uuid REFERENCES public.material_items(id) ON DELETE SET NULL;
