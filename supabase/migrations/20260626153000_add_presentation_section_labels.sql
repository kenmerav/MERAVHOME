ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS presentation_palette_label text,
  ADD COLUMN IF NOT EXISTS presentation_cabinet_label text,
  ADD COLUMN IF NOT EXISTS presentation_counter_label text,
  ADD COLUMN IF NOT EXISTS presentation_faucet_label text;
