CREATE TABLE IF NOT EXISTS public.rendering_studio_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_filename TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  source_project_name TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  manifest JSONB NOT NULL,
  elevation_count INTEGER NOT NULL CHECK (elevation_count > 0),
  imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, package_hash)
);

CREATE TABLE IF NOT EXISTS public.rendering_studio_elevations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES public.rendering_studio_packages(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  elevation_id TEXT NOT NULL,
  sheet_number TEXT NOT NULL,
  room_name TEXT NOT NULL,
  title TEXT NOT NULL,
  materials JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_status TEXT NOT NULL,
  review_status TEXT NOT NULL,
  presentation_order INTEGER NOT NULL CHECK (presentation_order > 0),
  presentation_mode TEXT NOT NULL DEFAULT 'cad-then-render'
    CHECK (
      presentation_mode IN (
        'cad-and-render-side-by-side',
        'cad-then-render',
        'rendering-only',
        'cad-only',
        'final-sheet'
      )
    ),
  presentation_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, elevation_id)
);

CREATE TABLE IF NOT EXISTS public.rendering_studio_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  elevation_id UUID NOT NULL REFERENCES public.rendering_studio_elevations(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL
    CHECK (asset_type IN ('autocad', 'final_rendering', 'final_sheet')),
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (elevation_id, asset_type)
);

CREATE INDEX IF NOT EXISTS idx_rendering_studio_packages_project
  ON public.rendering_studio_packages(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rendering_studio_elevations_project_order
  ON public.rendering_studio_elevations(project_id, presentation_order);
CREATE INDEX IF NOT EXISTS idx_rendering_studio_elevations_room
  ON public.rendering_studio_elevations(room_id, presentation_order);
CREATE INDEX IF NOT EXISTS idx_rendering_studio_assets_elevation
  ON public.rendering_studio_assets(elevation_id, asset_type);

DROP TRIGGER IF EXISTS rendering_studio_packages_touch ON public.rendering_studio_packages;
CREATE TRIGGER rendering_studio_packages_touch
BEFORE UPDATE ON public.rendering_studio_packages
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS rendering_studio_elevations_touch ON public.rendering_studio_elevations;
CREATE TRIGGER rendering_studio_elevations_touch
BEFORE UPDATE ON public.rendering_studio_elevations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS rendering_studio_assets_touch ON public.rendering_studio_assets;
CREATE TRIGGER rendering_studio_assets_touch
BEFORE UPDATE ON public.rendering_studio_assets
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rendering_studio_packages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rendering_studio_elevations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rendering_studio_assets TO authenticated;
GRANT ALL ON public.rendering_studio_packages TO service_role;
GRANT ALL ON public.rendering_studio_elevations TO service_role;
GRANT ALL ON public.rendering_studio_assets TO service_role;

ALTER TABLE public.rendering_studio_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendering_studio_elevations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendering_studio_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read rendering studio packages"
  ON public.rendering_studio_packages;
CREATE POLICY "Authenticated users can read rendering studio packages"
ON public.rendering_studio_packages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can read rendering studio elevations"
  ON public.rendering_studio_elevations;
CREATE POLICY "Authenticated users can read rendering studio elevations"
ON public.rendering_studio_elevations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can read rendering studio assets"
  ON public.rendering_studio_assets;
CREATE POLICY "Authenticated users can read rendering studio assets"
ON public.rendering_studio_assets FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Studio users can manage rendering studio packages"
  ON public.rendering_studio_packages;
CREATE POLICY "Studio users can manage rendering studio packages"
ON public.rendering_studio_packages FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND is_active = true AND role IN ('Admin', 'Employee')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND is_active = true AND role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "Studio users can manage rendering studio elevations"
  ON public.rendering_studio_elevations;
CREATE POLICY "Studio users can manage rendering studio elevations"
ON public.rendering_studio_elevations FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND is_active = true AND role IN ('Admin', 'Employee')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND is_active = true AND role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "Studio users can manage rendering studio assets"
  ON public.rendering_studio_assets;
CREATE POLICY "Studio users can manage rendering studio assets"
ON public.rendering_studio_assets FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);
