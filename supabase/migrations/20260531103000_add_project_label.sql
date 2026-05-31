ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS project_label text;

ALTER TABLE public.projects
DROP CONSTRAINT IF EXISTS projects_project_label_check;

ALTER TABLE public.projects
ADD CONSTRAINT projects_project_label_check
CHECK (
  project_label IS NULL OR project_label IN (
    'Personal Home',
    'Investor Renovation',
    'Spec Build',
    'D4D'
  )
);
