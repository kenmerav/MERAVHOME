CREATE TABLE IF NOT EXISTS public.marvin_source_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.marvin_sources(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  segment_scope text NOT NULL CHECK (segment_scope IN ('project', 'general')),
  summary text NOT NULL,
  details text NOT NULL,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  has_content boolean NOT NULL DEFAULT true,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (segment_scope = 'project' AND project_id IS NOT NULL)
    OR (segment_scope = 'general' AND project_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS marvin_source_segments_project_key
  ON public.marvin_source_segments(source_id, project_id)
  WHERE project_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marvin_source_segments_general_key
  ON public.marvin_source_segments(source_id)
  WHERE project_id IS NULL;

DROP TRIGGER IF EXISTS marvin_source_segments_touch ON public.marvin_source_segments;
CREATE TRIGGER marvin_source_segments_touch
BEFORE UPDATE ON public.marvin_source_segments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.marvin_source_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marvin_source_segments FROM anon, authenticated;
GRANT ALL ON public.marvin_source_segments TO service_role;
