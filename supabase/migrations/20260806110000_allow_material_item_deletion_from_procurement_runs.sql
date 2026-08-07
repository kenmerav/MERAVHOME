-- Procurement run items are immutable snapshots. Keep the snapshot when its
-- source material is removed, but release the foreign key to that live item.
ALTER TABLE public.procurement_run_items
  DROP CONSTRAINT IF EXISTS procurement_run_items_spec_book_item_id_fkey;

ALTER TABLE public.procurement_run_items
  ALTER COLUMN spec_book_item_id DROP NOT NULL;

ALTER TABLE public.procurement_run_items
  ADD CONSTRAINT procurement_run_items_spec_book_item_id_fkey
  FOREIGN KEY (spec_book_item_id)
  REFERENCES public.material_items(id)
  ON DELETE SET NULL;
