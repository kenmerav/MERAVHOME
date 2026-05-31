ALTER TABLE public.room_images
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS revision_notes TEXT,
  ADD COLUMN IF NOT EXISTS revision_parent_id UUID REFERENCES public.room_images(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'room_images_review_status_check'
  ) THEN
    ALTER TABLE public.room_images
      ADD CONSTRAINT room_images_review_status_check
      CHECK (review_status IN ('draft', 'needs_revision', 'approved', 'rejected'));
  END IF;
END $$;
