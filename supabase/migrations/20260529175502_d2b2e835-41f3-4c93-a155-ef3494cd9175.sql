
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  design_concept text,
  design_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open all" ON public.rooms FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_rooms_project ON public.rooms(project_id);
CREATE TRIGGER rooms_touch BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Drop legacy procurement trigger and function (CASCADE)
DROP FUNCTION IF EXISTS public.create_procurement_item() CASCADE;

ALTER TABLE public.products
  ADD COLUMN sku text,
  ADD COLUMN subcategory text;

ALTER TABLE public.procurement_items DROP CONSTRAINT IF EXISTS procurement_items_product_id_fkey;
ALTER TABLE public.procurement_items DROP CONSTRAINT IF EXISTS procurement_items_project_id_fkey;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_project_id_fkey,
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.project_images RENAME TO room_images;
ALTER TABLE public.room_images ADD COLUMN room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE;

ALTER TABLE public.materials
  ADD COLUMN room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  ADD COLUMN vendor text,
  ADD COLUMN product_url text,
  ADD COLUMN sku text;

CREATE TABLE public.room_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  is_key_selection boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  room_notes text,
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(room_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_products TO anon, authenticated;
GRANT ALL ON public.room_products TO service_role;
ALTER TABLE public.room_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open all" ON public.room_products FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_room_products_room ON public.room_products(room_id);
CREATE INDEX idx_room_products_product ON public.room_products(product_id);

TRUNCATE public.procurement_items;
ALTER TABLE public.procurement_items
  DROP COLUMN product_id,
  DROP COLUMN project_id,
  ADD COLUMN room_product_id uuid NOT NULL REFERENCES public.room_products(id) ON DELETE CASCADE UNIQUE;

CREATE OR REPLACE FUNCTION public.create_procurement_for_room_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.procurement_items (room_product_id) VALUES (NEW.id)
  ON CONFLICT (room_product_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER create_procurement_for_room_product
  AFTER INSERT ON public.room_products
  FOR EACH ROW EXECUTE FUNCTION public.create_procurement_for_room_product();

-- Data migration: existing projects → one room each
DO $$
DECLARE
  proj_rec RECORD;
  new_room_id uuid;
BEGIN
  FOR proj_rec IN SELECT id, project_type FROM public.projects LOOP
    INSERT INTO public.rooms (project_id, name, sort_order)
    VALUES (proj_rec.id, COALESCE(proj_rec.project_type::text, 'Main Room'), 0)
    RETURNING id INTO new_room_id;

    UPDATE public.room_images SET room_id = new_room_id WHERE project_id = proj_rec.id;
    UPDATE public.materials SET room_id = new_room_id WHERE project_id = proj_rec.id;

    INSERT INTO public.room_products (room_id, product_id, is_key_selection, sort_order)
    SELECT new_room_id, p.id, p.is_key_selection, p.sort_order
    FROM public.products p WHERE p.project_id = proj_rec.id;
  END LOOP;
END $$;

ALTER TABLE public.room_images DROP COLUMN project_id;
ALTER TABLE public.materials DROP COLUMN project_id;
ALTER TABLE public.products DROP COLUMN project_id;
ALTER TABLE public.products DROP COLUMN room;
ALTER TABLE public.products DROP COLUMN is_key_selection;
ALTER TABLE public.products DROP COLUMN sort_order;

ALTER TABLE public.room_images ALTER COLUMN room_id SET NOT NULL;
ALTER TABLE public.materials ALTER COLUMN room_id SET NOT NULL;
