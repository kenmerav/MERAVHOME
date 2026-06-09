ALTER TABLE public.material_items
  ADD COLUMN IF NOT EXISTS source_board_id uuid REFERENCES public.design_boards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_board_page_id text,
  ADD COLUMN IF NOT EXISTS source_board_element_id text;

CREATE INDEX IF NOT EXISTS idx_material_items_source_board_page
  ON public.material_items(project_id, source_board_page_id);
