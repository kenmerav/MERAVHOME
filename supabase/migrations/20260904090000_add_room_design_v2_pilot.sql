-- Additive, project-scoped support for the Room Design V2 pilot.
-- The pilot never alters the existing projects table. A project is enrolled only
-- when it has a row in room_design_projects, so every existing project remains legacy.

SET lock_timeout TO '5s';
SET statement_timeout TO '60s';

CREATE TABLE IF NOT EXISTS public.studio_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.studio_feature_flags (key, enabled, description)
VALUES (
  'room_design_v2',
  true,
  'Allows administrators to select the Room Design V2 pilot for newly created projects.'
)
ON CONFLICT (key) DO NOTHING;

DROP TRIGGER IF EXISTS studio_feature_flags_touch ON public.studio_feature_flags;
CREATE TRIGGER studio_feature_flags_touch
BEFORE UPDATE ON public.studio_feature_flags
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.room_design_projects (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.room_design_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, room_id)
);

CREATE INDEX IF NOT EXISTS room_design_workflows_project_idx
  ON public.room_design_workflows(project_id, updated_at DESC);

DROP TRIGGER IF EXISTS room_design_workflows_touch ON public.room_design_workflows;
CREATE TRIGGER room_design_workflows_touch
BEFORE UPDATE ON public.room_design_workflows
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.validate_room_design_workflow_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.rooms room
    JOIN public.room_design_projects pilot ON pilot.project_id = room.project_id
    WHERE room.id = NEW.room_id
      AND room.project_id = NEW.project_id
      AND pilot.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'Room Design V2 workflow is not enabled for this project and room.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS room_design_workflows_validate_scope ON public.room_design_workflows;
CREATE TRIGGER room_design_workflows_validate_scope
BEFORE INSERT OR UPDATE ON public.room_design_workflows
FOR EACH ROW EXECUTE FUNCTION public.validate_room_design_workflow_scope();

CREATE TABLE IF NOT EXISTS public.room_design_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS room_design_events_project_created_idx
  ON public.room_design_events(project_id, created_at DESC);

GRANT SELECT ON public.studio_feature_flags, public.room_design_projects TO authenticated;
GRANT INSERT, DELETE ON public.room_design_projects TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.room_design_workflows TO authenticated;
GRANT SELECT, INSERT ON public.room_design_events TO authenticated;
GRANT ALL ON public.studio_feature_flags, public.room_design_projects, public.room_design_workflows, public.room_design_events
TO service_role;

ALTER TABLE public.studio_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_design_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_design_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_design_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "studio team reads feature flags" ON public.studio_feature_flags;
CREATE POLICY "studio team reads feature flags"
ON public.studio_feature_flags
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "admins update feature flags" ON public.studio_feature_flags;
CREATE POLICY "admins update feature flags"
ON public.studio_feature_flags
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role = 'Admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role = 'Admin'
  )
);

DROP POLICY IF EXISTS "studio team reads room design projects" ON public.room_design_projects;
CREATE POLICY "studio team reads room design projects"
ON public.room_design_projects
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "admins enroll room design projects" ON public.room_design_projects;
CREATE POLICY "admins enroll room design projects"
ON public.room_design_projects
FOR INSERT WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role = 'Admin'
  )
);

DROP POLICY IF EXISTS "admins remove room design projects" ON public.room_design_projects;
CREATE POLICY "admins remove room design projects"
ON public.room_design_projects
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role = 'Admin'
  )
);

DROP POLICY IF EXISTS "studio team reads room design workflows" ON public.room_design_workflows;
CREATE POLICY "studio team reads room design workflows"
ON public.room_design_workflows
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "studio team inserts room design workflows" ON public.room_design_workflows;
CREATE POLICY "studio team inserts room design workflows"
ON public.room_design_workflows
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "studio team updates room design workflows" ON public.room_design_workflows;
CREATE POLICY "studio team updates room design workflows"
ON public.room_design_workflows
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "studio team reads room design events" ON public.room_design_events;
CREATE POLICY "studio team reads room design events"
ON public.room_design_events
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "studio team appends room design events" ON public.room_design_events;
CREATE POLICY "studio team appends room design events"
ON public.room_design_events
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
  AND created_by = auth.uid()
);

COMMENT ON TABLE public.room_design_projects IS
  'Opt-in Room Design V2 project enrollment. Projects without a row remain on the legacy workflow.';
COMMENT ON TABLE public.room_design_workflows IS
  'Project-scoped Room Design V2 drafts and workflow state. Does not replace live design boards.';
COMMENT ON TABLE public.room_design_events IS
  'Append-only audit events for Room Design V2 actions such as board import and material sync.';
