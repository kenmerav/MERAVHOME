
-- Extend products catalog
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS dimensions text,
  ADD COLUMN IF NOT EXISTS price text,
  ADD COLUMN IF NOT EXISTS description text;

-- Material items: guided checklist rows per room
CREATE TABLE public.material_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  item_label text NOT NULL,
  category text,
  is_required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  cad_label text,
  product_url text,
  quantity integer,
  color text,
  notes text,
  not_needed boolean NOT NULL DEFAULT false,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  scrape_status text NOT NULL DEFAULT 'pending',
  scrape_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_items TO anon, authenticated;
GRANT ALL ON public.material_items TO service_role;

ALTER TABLE public.material_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open all" ON public.material_items FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_material_items_project ON public.material_items(project_id);
CREATE INDEX idx_material_items_room ON public.material_items(room_id);

CREATE TRIGGER trg_material_items_touch
  BEFORE UPDATE ON public.material_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
