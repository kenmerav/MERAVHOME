CREATE TABLE IF NOT EXISTS public.user_project_assignments (
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS user_project_assignments_project_id_idx
  ON public.user_project_assignments(project_id);

GRANT SELECT ON public.user_project_assignments TO authenticated;
GRANT ALL ON public.user_project_assignments TO service_role;
