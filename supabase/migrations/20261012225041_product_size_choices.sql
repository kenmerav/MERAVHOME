-- Preserve retailer size choices so a blank measurement alone is not an issue.
-- Nullable additions only; existing selections and dimensions are unchanged.
-- Filename matches the approved migration version recorded in production.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS size_options text[],
  ADD COLUMN IF NOT EXISTS selected_size text;
