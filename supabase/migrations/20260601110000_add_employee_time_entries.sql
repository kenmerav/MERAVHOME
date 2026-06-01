ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.employee_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  hours numeric NOT NULL CHECK (hours >= 0 AND hours <= 24),
  task_project text NOT NULL,
  hourly_rate numeric NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  paid_on date,
  paid_through text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_time_entries_user_id_idx ON public.employee_time_entries(user_id);
CREATE INDEX IF NOT EXISTS employee_time_entries_paid_idx ON public.employee_time_entries(paid);
CREATE INDEX IF NOT EXISTS employee_time_entries_work_date_idx ON public.employee_time_entries(work_date);

DROP TRIGGER IF EXISTS employee_time_entries_touch ON public.employee_time_entries;
CREATE TRIGGER employee_time_entries_touch
BEFORE UPDATE ON public.employee_time_entries
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_time_entries TO authenticated;
GRANT ALL ON public.employee_time_entries TO service_role;

ALTER TABLE public.employee_time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee time select" ON public.employee_time_entries;
CREATE POLICY "employee time select"
ON public.employee_time_entries
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
);

DROP POLICY IF EXISTS "employee time insert own" ON public.employee_time_entries;
CREATE POLICY "employee time insert own"
ON public.employee_time_entries
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND profile.role IN ('Admin', 'Employee', 'Contractor')
  )
);

DROP POLICY IF EXISTS "employee time update own unpaid or manager" ON public.employee_time_entries;
CREATE POLICY "employee time update own unpaid or manager"
ON public.employee_time_entries
FOR UPDATE
USING (
  (
    user_id = auth.uid()
    AND paid = false
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles profile
      WHERE profile.id = auth.uid()
        AND profile.is_active = true
        AND profile.role IN ('Admin', 'Employee', 'Contractor')
    )
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
)
WITH CHECK (
  (
    user_id = auth.uid()
    AND paid = false
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles profile
      WHERE profile.id = auth.uid()
        AND profile.is_active = true
        AND profile.role IN ('Admin', 'Employee', 'Contractor')
    )
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
);

DROP POLICY IF EXISTS "employee time delete own unpaid or manager" ON public.employee_time_entries;
CREATE POLICY "employee time delete own unpaid or manager"
ON public.employee_time_entries
FOR DELETE
USING (
  (
    user_id = auth.uid()
    AND paid = false
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles profile
      WHERE profile.id = auth.uid()
        AND profile.is_active = true
        AND profile.role IN ('Admin', 'Employee', 'Contractor')
    )
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
);
