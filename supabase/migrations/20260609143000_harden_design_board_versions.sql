CREATE TABLE IF NOT EXISTS public.design_board_versions (
  version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_board_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  board_state_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  save_type text NOT NULL DEFAULT 'update',
  save_reason text
);

CREATE INDEX IF NOT EXISTS design_board_versions_project_created_idx
  ON public.design_board_versions(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS design_board_versions_board_created_idx
  ON public.design_board_versions(design_board_id, created_at DESC);

GRANT SELECT ON public.design_board_versions TO authenticated;
GRANT ALL ON public.design_board_versions TO service_role;

ALTER TABLE public.design_board_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "design board versions admin select" ON public.design_board_versions;
CREATE POLICY "design board versions admin select"
ON public.design_board_versions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role = 'Admin'
  )
);

DROP POLICY IF EXISTS "design board versions service insert" ON public.design_board_versions;
CREATE POLICY "design board versions service insert"
ON public.design_board_versions
FOR INSERT
WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.archive_design_board_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  snapshot jsonb;
  snapshot_board_id uuid;
  snapshot_project_id uuid;
  snapshot_created_by uuid;
  snapshot_type text;
  snapshot_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    snapshot := NEW.board_state;
    snapshot_board_id := NEW.project_id;
    snapshot_project_id := NEW.project_id;
    snapshot_created_by := NEW.updated_by;
    snapshot_type := 'create';
    snapshot_reason := 'Initial board snapshot';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.board_state IS NOT DISTINCT FROM OLD.board_state THEN
      RETURN NEW;
    END IF;
    snapshot := OLD.board_state;
    snapshot_board_id := OLD.project_id;
    snapshot_project_id := OLD.project_id;
    snapshot_created_by := COALESCE(NEW.updated_by, OLD.updated_by);
    snapshot_type := 'update';
    snapshot_reason := 'Snapshot before board update';
  ELSIF TG_OP = 'DELETE' THEN
    snapshot := OLD.board_state;
    snapshot_board_id := OLD.project_id;
    snapshot_project_id := OLD.project_id;
    snapshot_created_by := OLD.updated_by;
    snapshot_type := 'delete';
    snapshot_reason := 'Snapshot before board delete';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.design_board_versions (
    design_board_id,
    project_id,
    board_state_snapshot,
    created_by,
    save_type,
    save_reason
  ) VALUES (
    snapshot_board_id,
    snapshot_project_id,
    snapshot,
    snapshot_created_by,
    snapshot_type,
    snapshot_reason
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS design_boards_archive_before_update ON public.design_boards;
CREATE TRIGGER design_boards_archive_before_update
BEFORE UPDATE ON public.design_boards
FOR EACH ROW EXECUTE FUNCTION public.archive_design_board_version();

DROP TRIGGER IF EXISTS design_boards_archive_before_delete ON public.design_boards;
CREATE TRIGGER design_boards_archive_before_delete
BEFORE DELETE ON public.design_boards
FOR EACH ROW EXECUTE FUNCTION public.archive_design_board_version();

DROP TRIGGER IF EXISTS design_boards_archive_after_insert ON public.design_boards;
CREATE TRIGGER design_boards_archive_after_insert
AFTER INSERT ON public.design_boards
FOR EACH ROW EXECUTE FUNCTION public.archive_design_board_version();

INSERT INTO public.design_board_versions (
  design_board_id,
  project_id,
  board_state_snapshot,
  created_at,
  created_by,
  save_type,
  save_reason
)
SELECT
  board.project_id,
  board.project_id,
  COALESCE(version.value -> 'state', board.board_state - 'versions'),
  CASE
    WHEN COALESCE(version.value ->> 'createdAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN (version.value ->> 'createdAt')::timestamptz
    ELSE board.updated_at
  END,
  CASE
    WHEN COALESCE(version.value ->> 'createdBy', '') ~* '^[0-9a-f-]{36}$'
      THEN (version.value ->> 'createdBy')::uuid
    ELSE board.updated_by
  END,
  'legacy-inline-backfill',
  NULLIF(COALESCE(version.value ->> 'label', 'Backfilled from inline design board history'), '')
FROM public.design_boards board
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(board.board_state -> 'versions') = 'array'
      THEN board.board_state -> 'versions'
    ELSE '[]'::jsonb
  END
) AS version(value);

UPDATE public.design_boards
SET board_state = board_state - 'versions'
WHERE board_state ? 'versions';
