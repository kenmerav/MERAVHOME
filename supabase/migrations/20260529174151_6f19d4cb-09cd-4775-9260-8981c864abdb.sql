
-- Enums
CREATE TYPE public.project_type AS ENUM ('Kitchen','Bathroom','Whole Home','New Build','Furnishings','Commercial');
CREATE TYPE public.project_status AS ENUM ('Design','Presentation','Approved','Procurement','Complete');
CREATE TYPE public.product_category AS ENUM ('Lighting','Plumbing','Hardware','Appliances','Flooring','Tile','Paint','Furniture','Decor');
CREATE TYPE public.material_category AS ENUM ('Cabinet Finish','Countertop','Flooring','Tile','Fabric','Paint');
CREATE TYPE public.image_kind AS ENUM ('sketchup','rendering');
CREATE TYPE public.procurement_status AS ENUM ('pending','ordered','received','installed');

-- Projects
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_name text NOT NULL,
  project_type public.project_type NOT NULL,
  status public.project_status NOT NULL DEFAULT 'Design',
  design_notes text,
  cover_image_url text,
  project_summary text,
  design_concept text,
  key_design_elements text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Project images
CREATE TABLE public.project_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind public.image_kind NOT NULL,
  url text NOT NULL,
  caption text,
  linked_sketchup_id uuid REFERENCES public.project_images(id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category public.product_category NOT NULL,
  name text NOT NULL,
  vendor text,
  product_url text,
  image_url text,
  finish text,
  notes text,
  room text,
  is_key_selection boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Materials
CREATE TABLE public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category public.material_category NOT NULL,
  name text NOT NULL,
  image_url text,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Procurement (one row per product)
CREATE TABLE public.procurement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ordered boolean NOT NULL DEFAULT false,
  received boolean NOT NULL DEFAULT false,
  installed boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX ON public.project_images(project_id);
CREATE INDEX ON public.products(project_id);
CREATE INDEX ON public.materials(project_id);
CREATE INDEX ON public.procurement_items(project_id);

-- Auto-create procurement_items when a product is inserted
CREATE OR REPLACE FUNCTION public.create_procurement_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.procurement_items (product_id, project_id) VALUES (NEW.id, NEW.project_id)
  ON CONFLICT (product_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER products_create_procurement
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.create_procurement_item();

-- updated_at touch
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER projects_touch BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER procurement_touch BEFORE UPDATE ON public.procurement_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- GRANTS (open for internal-tool v1 — auth can be layered on later)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_images TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materials TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_items TO anon, authenticated;
GRANT ALL ON public.projects, public.project_images, public.products, public.materials, public.procurement_items TO service_role;

-- RLS (permissive for internal tool v1)
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open all" ON public.projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open all" ON public.project_images FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open all" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open all" ON public.materials FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open all" ON public.procurement_items FOR ALL USING (true) WITH CHECK (true);
