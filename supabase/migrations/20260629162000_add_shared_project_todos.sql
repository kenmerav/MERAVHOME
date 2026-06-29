CREATE TABLE IF NOT EXISTS public.shared_project_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  notes text,
  due_date date,
  reminder_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_project_todos_assigned_status_due
  ON public.shared_project_todos(assigned_user_id, status, due_date, reminder_date);

CREATE INDEX IF NOT EXISTS idx_shared_project_todos_project
  ON public.shared_project_todos(project_id, created_at DESC);

DROP TRIGGER IF EXISTS shared_project_todos_touch ON public.shared_project_todos;
CREATE TRIGGER shared_project_todos_touch
BEFORE UPDATE ON public.shared_project_todos
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_project_todos TO authenticated;
GRANT ALL ON public.shared_project_todos TO service_role;

ALTER TABLE public.shared_project_todos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read shared project todos" ON public.shared_project_todos;
CREATE POLICY "Authenticated users can read shared project todos"
ON public.shared_project_todos
FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert shared project todos" ON public.shared_project_todos;
CREATE POLICY "Authenticated users can insert shared project todos"
ON public.shared_project_todos
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update shared project todos" ON public.shared_project_todos;
CREATE POLICY "Authenticated users can update shared project todos"
ON public.shared_project_todos
FOR UPDATE
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete shared project todos" ON public.shared_project_todos;
CREATE POLICY "Authenticated users can delete shared project todos"
ON public.shared_project_todos
FOR DELETE
USING (auth.role() = 'authenticated');
