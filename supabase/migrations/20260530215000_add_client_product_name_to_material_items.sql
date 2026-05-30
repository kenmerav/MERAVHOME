ALTER TABLE public.material_items
  ADD COLUMN IF NOT EXISTS client_product_name text;

UPDATE public.material_items mi
SET client_product_name = trim(concat_ws(' ', r.name, mi.item_label))
FROM public.rooms r
WHERE mi.room_id = r.id
  AND (mi.client_product_name IS NULL OR btrim(mi.client_product_name) = '');
