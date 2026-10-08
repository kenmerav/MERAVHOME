-- Applied through Supabase migration add_product_price_unit, version 20261008200243.
-- Additive only: existing prices, quantities and permissions remain unchanged.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.products ADD COLUMN price_unit text;
ALTER TABLE public.products ADD CONSTRAINT products_price_unit_check
  CHECK (price_unit IS NULL OR price_unit IN ('unit', 'sq_ft'));
COMMENT ON COLUMN public.products.price_unit IS
  'Price denominator for price, retail_price and unit_cost: unit or sq_ft. NULL means not reviewed. Independent of material_items.quantity_unit. Does not apply to shipping.';
NOTIFY pgrst, 'reload schema';
