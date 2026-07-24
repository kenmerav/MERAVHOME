ALTER TABLE public.marvin_suggestions
  ADD COLUMN IF NOT EXISTS estimated_hours numeric
    CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  ADD COLUMN IF NOT EXISTS required_capability text,
  ADD COLUMN IF NOT EXISTS assignee_reason text;
