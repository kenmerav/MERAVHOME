ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS has_sample boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_category_has_sample
  ON public.products(category, has_sample);
