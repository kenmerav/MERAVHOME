CREATE TABLE IF NOT EXISTS public.project_timelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  title text,
  project_name text,
  client_name text,
  timeline_date date,
  html_data_url text,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_timelines_project_id_idx ON public.project_timelines(project_id);
CREATE INDEX IF NOT EXISTS project_timelines_timeline_date_idx ON public.project_timelines(timeline_date);

DROP TRIGGER IF EXISTS project_timelines_touch ON public.project_timelines;
CREATE TRIGGER project_timelines_touch
BEFORE UPDATE ON public.project_timelines
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_timelines TO anon, authenticated;
GRANT ALL ON public.project_timelines TO service_role;

ALTER TABLE public.project_timelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open all" ON public.project_timelines;
CREATE POLICY "open all" ON public.project_timelines FOR ALL USING (true) WITH CHECK (true);
