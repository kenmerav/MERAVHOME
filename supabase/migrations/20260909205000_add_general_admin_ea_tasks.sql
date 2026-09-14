-- Allow the EA Desk to track internal company administration without inventing a client project.
ALTER TABLE public.shared_project_todos
  ALTER COLUMN project_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shared_project_todos_general_source_key_idx
  ON public.shared_project_todos(source_key)
  WHERE project_id IS NULL AND source_key IS NOT NULL;

-- Existing travel tasks that were incorrectly assigned to a test/demo project become General Admin.
UPDATE public.shared_project_todos todo
SET project_id = NULL
WHERE todo.source_type = 'ea_email'
  AND todo.title ~* '(flight|airline|boarding pass|check[ -]?in|hotel|rental car|itinerary)'
  AND EXISTS (
    SELECT 1
    FROM public.projects project
    WHERE project.id = todo.project_id
      AND project.name ~* '(^|[[:space:]])(test|demo)([[:space:]]|$)'
  );

-- General Admin work is private to active Studio staff even though it shares the project-todo table.
DROP POLICY IF EXISTS "Authenticated users can read shared project todos" ON public.shared_project_todos;
CREATE POLICY "Authenticated users can read shared project todos"
ON public.shared_project_todos
FOR SELECT
USING (
  project_id IS NOT NULL
  OR public.is_active_studio_team_member(auth.uid())
);

DROP POLICY IF EXISTS "Authenticated users can insert shared project todos" ON public.shared_project_todos;
CREATE POLICY "Authenticated users can insert shared project todos"
ON public.shared_project_todos
FOR INSERT
WITH CHECK (
  project_id IS NOT NULL
  OR public.is_active_studio_team_member(auth.uid())
);

DROP POLICY IF EXISTS "Authenticated users can update shared project todos" ON public.shared_project_todos;
CREATE POLICY "Authenticated users can update shared project todos"
ON public.shared_project_todos
FOR UPDATE
USING (
  project_id IS NOT NULL
  OR public.is_active_studio_team_member(auth.uid())
)
WITH CHECK (
  project_id IS NOT NULL
  OR public.is_active_studio_team_member(auth.uid())
);

DROP POLICY IF EXISTS "Authenticated users can delete shared project todos" ON public.shared_project_todos;
CREATE POLICY "Authenticated users can delete shared project todos"
ON public.shared_project_todos
FOR DELETE
USING (
  project_id IS NOT NULL
  OR public.is_active_studio_team_member(auth.uid())
);

COMMENT ON COLUMN public.shared_project_todos.project_id IS
  'Client project for project work; NULL means private General Admin work in the EA Desk.';
