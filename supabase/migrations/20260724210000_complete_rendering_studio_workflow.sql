ALTER TABLE public.rendering_studio_packages
  ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'source_files_uploaded'
    CHECK (
      workflow_status IN (
        'source_files_uploaded',
        'ready_for_codex',
        'rendering_in_progress',
        'pending_review',
        'approved',
        'rejected',
        'correction_requested',
        'superseded'
      )
    ),
  ADD COLUMN IF NOT EXISTS source_label TEXT,
  ADD COLUMN IF NOT EXISTS handoff_generated_at TIMESTAMPTZ;

ALTER TABLE public.rendering_studio_elevations
  ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (
      workflow_status IN (
        'source_files_uploaded',
        'ready_for_codex',
        'rendering_in_progress',
        'pending_review',
        'approved',
        'rejected',
        'correction_requested',
        'superseded'
      )
    ),
  ADD COLUMN IF NOT EXISTS expected_cad_filename TEXT,
  ADD COLUMN IF NOT EXISTS expected_render_filename TEXT,
  ADD COLUMN IF NOT EXISTS expected_sheet_filename TEXT,
  ADD COLUMN IF NOT EXISTS correction_note TEXT,
  ADD COLUMN IF NOT EXISTS source_page_number INTEGER,
  ADD COLUMN IF NOT EXISTS current_revision_number INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.rendering_studio_assets
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT 'room-images';

CREATE TABLE IF NOT EXISTS public.rendering_studio_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES public.rendering_studio_packages(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL
    CHECK (
      source_type IN (
        'autocad_pdf',
        'autocad_image',
        'specification_pdf',
        'supporting_material'
      )
    ),
  label TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'rendering-studio-files',
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  page_number INTEGER,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, storage_bucket, storage_path)
);

CREATE TABLE IF NOT EXISTS public.rendering_studio_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  elevation_id UUID NOT NULL REFERENCES public.rendering_studio_elevations(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'superseded')),
  rendering_filename TEXT NOT NULL,
  rendering_bucket TEXT NOT NULL DEFAULT 'rendering-studio-files',
  rendering_path TEXT NOT NULL,
  rendering_mime_type TEXT NOT NULL,
  rendering_file_size BIGINT NOT NULL CHECK (rendering_file_size > 0),
  rendering_hash TEXT NOT NULL,
  final_sheet_filename TEXT,
  final_sheet_bucket TEXT,
  final_sheet_path TEXT,
  final_sheet_mime_type TEXT,
  final_sheet_file_size BIGINT,
  final_sheet_hash TEXT,
  correction_note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (elevation_id, revision_number),
  UNIQUE (elevation_id, rendering_hash)
);

CREATE INDEX IF NOT EXISTS idx_rendering_studio_sources_project
  ON public.rendering_studio_sources(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rendering_studio_sources_package
  ON public.rendering_studio_sources(package_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rendering_studio_revisions_elevation
  ON public.rendering_studio_revisions(elevation_id, revision_number DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rendering_studio_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rendering_studio_revisions TO authenticated;
GRANT ALL ON public.rendering_studio_sources TO service_role;
GRANT ALL ON public.rendering_studio_revisions TO service_role;

ALTER TABLE public.rendering_studio_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendering_studio_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Studio users can manage rendering studio sources"
  ON public.rendering_studio_sources;
CREATE POLICY "Studio users can manage rendering studio sources"
ON public.rendering_studio_sources FOR ALL TO authenticated
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

DROP POLICY IF EXISTS "Studio users can manage rendering studio revisions"
  ON public.rendering_studio_revisions;
CREATE POLICY "Studio users can manage rendering studio revisions"
ON public.rendering_studio_revisions FOR ALL TO authenticated
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
