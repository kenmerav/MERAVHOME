-- Manufacturer carton coverage is stored on the shared product so future
-- procurement runs can reuse a verified scrape without paying to scrape again.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS carton_coverage_sq_ft numeric,
  ADD COLUMN IF NOT EXISTS carton_coverage_source_url text,
  ADD COLUMN IF NOT EXISTS carton_coverage_source_text text,
  ADD COLUMN IF NOT EXISTS carton_coverage_confidence text,
  ADD COLUMN IF NOT EXISTS carton_coverage_scraped_at timestamptz;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_carton_coverage_sq_ft_check,
  DROP CONSTRAINT IF EXISTS products_carton_coverage_confidence_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_carton_coverage_sq_ft_check
    CHECK (carton_coverage_sq_ft IS NULL OR carton_coverage_sq_ft > 0),
  ADD CONSTRAINT products_carton_coverage_confidence_check
    CHECK (
      carton_coverage_confidence IS NULL
      OR carton_coverage_confidence IN ('exact', 'review', 'missing', 'manual')
    );
