CREATE TABLE IF NOT EXISTS public.project_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  document_type text NOT NULL DEFAULT 'Construction Doc',
  file_url text NOT NULL,
  file_name text,
  file_size bigint,
  mime_type text,
  visible_to_contractors boolean NOT NULL DEFAULT true,
  visible_to_clients boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_documents_document_type_check CHECK (
    document_type IN ('SketchUp Rendering', 'AI Rendering', 'Layout Doc', 'Construction Doc')
  )
);

CREATE INDEX IF NOT EXISTS idx_project_documents_project_created
  ON public.project_documents(project_id, created_at DESC);

DROP TRIGGER IF EXISTS project_documents_touch ON public.project_documents;
CREATE TRIGGER project_documents_touch
BEFORE UPDATE ON public.project_documents
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_documents TO authenticated;
GRANT ALL ON public.project_documents TO service_role;

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read project documents" ON public.project_documents;
CREATE POLICY "Authenticated users can read project documents"
ON public.project_documents
FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert project documents" ON public.project_documents;
CREATE POLICY "Authenticated users can insert project documents"
ON public.project_documents
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update project documents" ON public.project_documents;
CREATE POLICY "Authenticated users can update project documents"
ON public.project_documents
FOR UPDATE
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete project documents" ON public.project_documents;
CREATE POLICY "Authenticated users can delete project documents"
ON public.project_documents
FOR DELETE
USING (auth.role() = 'authenticated');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-files',
  'project-files',
  true,
  52428800,
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
