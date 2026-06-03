CREATE TABLE IF NOT EXISTS public.design_boards (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  board_state jsonb NOT NULL DEFAULT '{"pages":[],"selectedPageId":""}'::jsonb,
  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_boards_updated_at_idx
  ON public.design_boards(updated_at);

DROP TRIGGER IF EXISTS design_boards_touch ON public.design_boards;
CREATE TRIGGER design_boards_touch
BEFORE UPDATE ON public.design_boards
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.design_boards TO authenticated;
GRANT ALL ON public.design_boards TO service_role;

ALTER TABLE public.design_boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "design boards admin employee select" ON public.design_boards;
CREATE POLICY "design boards admin employee select"
ON public.design_boards
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "design boards admin employee insert" ON public.design_boards;
CREATE POLICY "design boards admin employee insert"
ON public.design_boards
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "design boards admin employee update" ON public.design_boards;
CREATE POLICY "design boards admin employee update"
ON public.design_boards
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);

DROP POLICY IF EXISTS "design boards admin employee delete" ON public.design_boards;
CREATE POLICY "design boards admin employee delete"
ON public.design_boards
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee')
  )
);
