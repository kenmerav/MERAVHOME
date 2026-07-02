ALTER TABLE public.material_items
  ADD COLUMN IF NOT EXISTS ordered_by text,
  ADD COLUMN IF NOT EXISTS ordered boolean NOT NULL DEFAULT false;

ALTER TABLE public.material_items
  DROP CONSTRAINT IF EXISTS material_items_ordered_by_check;

ALTER TABLE public.material_items
  ADD CONSTRAINT material_items_ordered_by_check
  CHECK (ordered_by IS NULL OR ordered_by IN ('Contractor', 'Merav', 'Client'));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_spec_show_ordering boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contractor_spec_show_ordering boolean NOT NULL DEFAULT true;
