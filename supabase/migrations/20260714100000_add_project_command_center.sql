ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS accepted_date date,
  ADD COLUMN IF NOT EXISTS turnaround_speed text,
  ADD COLUMN IF NOT EXISTS promised_completion_date date,
  ADD COLUMN IF NOT EXISTS forecast_completion_date date,
  ADD COLUMN IF NOT EXISTS progress_override numeric,
  ADD COLUMN IF NOT EXISTS health_override text,
  ADD COLUMN IF NOT EXISTS health_override_reason text;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_turnaround_speed_check,
  DROP CONSTRAINT IF EXISTS projects_progress_override_check,
  DROP CONSTRAINT IF EXISTS projects_health_override_check;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_turnaround_speed_check
    CHECK (turnaround_speed IS NULL OR turnaround_speed IN ('Standard', 'Priority', 'Rush', 'Custom')),
  ADD CONSTRAINT projects_progress_override_check
    CHECK (progress_override IS NULL OR (progress_override >= 0 AND progress_override <= 100)),
  ADD CONSTRAINT projects_health_override_check
    CHECK (health_override IS NULL OR health_override IN ('on_track', 'at_risk', 'critical', 'late'));

CREATE TABLE IF NOT EXISTS public.project_management_owners (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.project_milestone_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  project_type text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_milestone_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.project_milestone_templates(id) ON DELETE CASCADE,
  title text NOT NULL,
  stage text NOT NULL,
  default_weight numeric NOT NULL DEFAULT 0 CHECK (default_weight >= 0),
  required_capability text,
  is_critical boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'blocked', 'complete', 'skipped')),
  target_date date,
  completed_at timestamptz,
  weight numeric NOT NULL DEFAULT 0 CHECK (weight >= 0),
  owner_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  required_capability text,
  is_critical boolean NOT NULL DEFAULT false,
  is_custom boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_milestones_project_sort_idx
  ON public.project_milestones(project_id, sort_order, target_date);

CREATE TABLE IF NOT EXISTS public.project_milestone_dependencies (
  milestone_id uuid NOT NULL REFERENCES public.project_milestones(id) ON DELETE CASCADE,
  depends_on_milestone_id uuid NOT NULL REFERENCES public.project_milestones(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (milestone_id, depends_on_milestone_id),
  CHECK (milestone_id <> depends_on_milestone_id)
);

CREATE TABLE IF NOT EXISTS public.employee_work_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  weekly_capacity_hours numeric NOT NULL DEFAULT 30 CHECK (weekly_capacity_hours >= 0 AND weekly_capacity_hours <= 168),
  capability_tags text[] NOT NULL DEFAULT '{}',
  unavailable_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_project_todos
  ALTER COLUMN assigned_user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS recommended_assignee_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS milestone_id uuid REFERENCES public.project_milestones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS depends_on_todo_id uuid REFERENCES public.shared_project_todos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_hours numeric CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  ADD COLUMN IF NOT EXISTS required_capability text,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_key text,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS waiting_on text,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rank_override integer,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS link_url text,
  ADD COLUMN IF NOT EXISTS ready_for_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS recommended_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- All rows predating the Command Center were intentionally assigned client/GC requests.
UPDATE public.shared_project_todos todo
SET visibility = 'assigned_external'
WHERE todo.source_type IS NULL
  AND todo.milestone_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = todo.assigned_user_id
      AND profile.role IN ('Client', 'Contractor')
  );

ALTER TABLE public.shared_project_todos
  DROP CONSTRAINT IF EXISTS shared_project_todos_status_check,
  DROP CONSTRAINT IF EXISTS shared_project_todos_visibility_check,
  DROP CONSTRAINT IF EXISTS shared_project_todos_waiting_on_check;

ALTER TABLE public.shared_project_todos
  ADD CONSTRAINT shared_project_todos_status_check
    CHECK (status IN ('suggested', 'open', 'ready', 'in_progress', 'waiting', 'blocked', 'complete', 'cancelled')),
  ADD CONSTRAINT shared_project_todos_visibility_check
    CHECK (visibility IN ('internal', 'assigned_external')),
  ADD CONSTRAINT shared_project_todos_waiting_on_check
    CHECK (waiting_on IS NULL OR waiting_on IN ('employee', 'client', 'gc', 'vendor'));

CREATE UNIQUE INDEX IF NOT EXISTS shared_project_todos_source_key_idx
  ON public.shared_project_todos(project_id, source_key);

CREATE INDEX IF NOT EXISTS shared_project_todos_command_center_idx
  ON public.shared_project_todos(status, assigned_user_id, due_date, is_pinned);

CREATE TABLE IF NOT EXISTS public.project_todo_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id uuid NOT NULL REFERENCES public.shared_project_todos(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'internal')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_todo_messages_todo_created_idx
  ON public.project_todo_messages(todo_id, created_at);

CREATE TABLE IF NOT EXISTS public.project_todo_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id uuid NOT NULL REFERENCES public.shared_project_todos(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text,
  external_url text,
  mime_type text,
  file_size bigint,
  visibility text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'internal')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path IS NOT NULL OR external_url IS NOT NULL)
);

ALTER TABLE public.employee_time_entries
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS todo_id uuid REFERENCES public.shared_project_todos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employee_time_entries_todo_idx
  ON public.employee_time_entries(todo_id, work_date);

DROP TRIGGER IF EXISTS project_milestone_templates_touch ON public.project_milestone_templates;
CREATE TRIGGER project_milestone_templates_touch
BEFORE UPDATE ON public.project_milestone_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS project_milestones_touch ON public.project_milestones;
CREATE TRIGGER project_milestones_touch
BEFORE UPDATE ON public.project_milestones
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS employee_work_profiles_touch ON public.employee_work_profiles;
CREATE TRIGGER employee_work_profiles_touch
BEFORE UPDATE ON public.employee_work_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS project_todo_messages_touch ON public.project_todo_messages;
CREATE TRIGGER project_todo_messages_touch
BEFORE UPDATE ON public.project_todo_messages
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.project_milestone_templates (id, name, project_type, is_default)
VALUES
  ('9d2232cb-9b81-4d35-9f78-4f17825f8611', 'Kitchen / Bathroom', 'Kitchen', true),
  ('75598f03-2b8c-4dc7-bf42-a79c2bb0f224', 'Whole Home / New Build', 'Whole Home', true),
  ('c858df8d-a4da-45bd-9f2f-31901e6826bd', 'Furnishings / Commercial', 'Furnishings', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.project_milestone_template_items
  (template_id, title, stage, default_weight, required_capability, is_critical, sort_order)
SELECT template.id, item.title, item.stage, item.weight, item.capability, item.critical, item.sort_order
FROM public.project_milestone_templates template
CROSS JOIN (VALUES
  ('Create Project', 'Design', 5::numeric, 'project setup', true, 10),
  ('Create Rooms', 'Design', 5::numeric, 'project setup', true, 20),
  ('Upload SketchUp', 'Design', 10::numeric, 'sketchup', true, 30),
  ('Design Selections', 'Design', 25::numeric, 'design boards', true, 40),
  ('AI Renderings', 'Presentation', 10::numeric, 'renderings', false, 50),
  ('Presentation Boards', 'Presentation', 10::numeric, 'presentations', true, 60),
  ('Client Approval', 'Approved', 10::numeric, 'client coordination', true, 70),
  ('Spec Book', 'Approved', 10::numeric, 'materials and specs', true, 80),
  ('Procurement', 'Procurement', 15::numeric, 'procurement', true, 90)
) AS item(title, stage, weight, capability, critical, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.project_milestone_template_items existing
  WHERE existing.template_id = template.id AND existing.title = item.title
);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.project_management_owners,
  public.project_milestone_templates,
  public.project_milestone_template_items,
  public.project_milestones,
  public.project_milestone_dependencies,
  public.employee_work_profiles,
  public.project_todo_messages,
  public.project_todo_attachments
TO authenticated;

GRANT ALL ON
  public.project_management_owners,
  public.project_milestone_templates,
  public.project_milestone_template_items,
  public.project_milestones,
  public.project_milestone_dependencies,
  public.employee_work_profiles,
  public.project_todo_messages,
  public.project_todo_attachments
TO service_role;

ALTER TABLE public.project_management_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_milestone_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_milestone_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_milestone_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_work_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_todo_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_todo_attachments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_active_studio_team_member(candidate_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = candidate_user_id
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  );
$$;

DROP POLICY IF EXISTS "studio team manages project owners" ON public.project_management_owners;
CREATE POLICY "studio team manages project owners" ON public.project_management_owners
FOR ALL USING (public.is_active_studio_team_member(auth.uid()))
WITH CHECK (public.is_active_studio_team_member(auth.uid()));

DROP POLICY IF EXISTS "studio team reads milestone templates" ON public.project_milestone_templates;
CREATE POLICY "studio team reads milestone templates" ON public.project_milestone_templates
FOR SELECT USING (public.is_active_studio_team_member(auth.uid()));

DROP POLICY IF EXISTS "studio team reads milestone template items" ON public.project_milestone_template_items;
CREATE POLICY "studio team reads milestone template items" ON public.project_milestone_template_items
FOR SELECT USING (public.is_active_studio_team_member(auth.uid()));

DROP POLICY IF EXISTS "studio team manages milestones" ON public.project_milestones;
CREATE POLICY "studio team manages milestones" ON public.project_milestones
FOR ALL USING (public.is_active_studio_team_member(auth.uid()))
WITH CHECK (public.is_active_studio_team_member(auth.uid()));

DROP POLICY IF EXISTS "studio team manages milestone dependencies" ON public.project_milestone_dependencies;
CREATE POLICY "studio team manages milestone dependencies" ON public.project_milestone_dependencies
FOR ALL USING (public.is_active_studio_team_member(auth.uid()))
WITH CHECK (public.is_active_studio_team_member(auth.uid()));

DROP POLICY IF EXISTS "studio team manages work profiles" ON public.employee_work_profiles;
CREATE POLICY "studio team manages work profiles" ON public.employee_work_profiles
FOR ALL USING (public.is_active_studio_team_member(auth.uid()))
WITH CHECK (public.is_active_studio_team_member(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read shared project todos" ON public.shared_project_todos;
DROP POLICY IF EXISTS "authenticated users can read shared project todos" ON public.shared_project_todos;
DROP POLICY IF EXISTS "scoped users can read project todos" ON public.shared_project_todos;
CREATE POLICY "scoped users can read project todos" ON public.shared_project_todos
FOR SELECT USING (
  public.is_active_studio_team_member(auth.uid())
  OR (assigned_user_id = auth.uid() AND visibility = 'assigned_external')
);

DROP POLICY IF EXISTS "Authenticated users can insert shared project todos" ON public.shared_project_todos;
DROP POLICY IF EXISTS "authenticated users can insert shared project todos" ON public.shared_project_todos;
DROP POLICY IF EXISTS "studio team inserts project todos" ON public.shared_project_todos;
CREATE POLICY "studio team inserts project todos" ON public.shared_project_todos
FOR INSERT WITH CHECK (public.is_active_studio_team_member(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can update shared project todos" ON public.shared_project_todos;
DROP POLICY IF EXISTS "authenticated users can update shared project todos" ON public.shared_project_todos;
DROP POLICY IF EXISTS "scoped users update project todos" ON public.shared_project_todos;
CREATE POLICY "scoped users update project todos" ON public.shared_project_todos
FOR UPDATE USING (
  public.is_active_studio_team_member(auth.uid())
  OR (assigned_user_id = auth.uid() AND visibility = 'assigned_external')
)
WITH CHECK (
  public.is_active_studio_team_member(auth.uid())
  OR (assigned_user_id = auth.uid() AND visibility = 'assigned_external')
);

DROP POLICY IF EXISTS "Authenticated users can delete shared project todos" ON public.shared_project_todos;
DROP POLICY IF EXISTS "authenticated users can delete shared project todos" ON public.shared_project_todos;
DROP POLICY IF EXISTS "studio team deletes project todos" ON public.shared_project_todos;
CREATE POLICY "studio team deletes project todos" ON public.shared_project_todos
FOR DELETE USING (public.is_active_studio_team_member(auth.uid()));

DROP POLICY IF EXISTS "scoped users read task messages" ON public.project_todo_messages;
CREATE POLICY "scoped users read task messages" ON public.project_todo_messages
FOR SELECT USING (
  public.is_active_studio_team_member(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.shared_project_todos todo
    WHERE todo.id = todo_id
      AND todo.assigned_user_id = auth.uid()
      AND todo.visibility = 'assigned_external'
      AND visibility = 'shared'
  )
);

DROP POLICY IF EXISTS "scoped users add task messages" ON public.project_todo_messages;
CREATE POLICY "scoped users add task messages" ON public.project_todo_messages
FOR INSERT WITH CHECK (
  public.is_active_studio_team_member(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.shared_project_todos todo
    WHERE todo.id = todo_id
      AND todo.assigned_user_id = auth.uid()
      AND todo.visibility = 'assigned_external'
      AND visibility = 'shared'
  )
);

DROP POLICY IF EXISTS "scoped users read task attachments" ON public.project_todo_attachments;
CREATE POLICY "scoped users read task attachments" ON public.project_todo_attachments
FOR SELECT USING (
  public.is_active_studio_team_member(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.shared_project_todos todo
    WHERE todo.id = todo_id
      AND todo.assigned_user_id = auth.uid()
      AND todo.visibility = 'assigned_external'
      AND visibility = 'shared'
  )
);

DROP POLICY IF EXISTS "scoped users add task attachments" ON public.project_todo_attachments;
CREATE POLICY "scoped users add task attachments" ON public.project_todo_attachments
FOR INSERT WITH CHECK (
  public.is_active_studio_team_member(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.shared_project_todos todo
    WHERE todo.id = todo_id
      AND todo.assigned_user_id = auth.uid()
      AND todo.visibility = 'assigned_external'
      AND visibility = 'shared'
  )
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-task-attachments', 'project-task-attachments', false)
ON CONFLICT (id) DO NOTHING;
