ALTER TABLE public.marvin_sources
  ADD COLUMN IF NOT EXISTS knowledge_scope text NOT NULL DEFAULT 'project';

ALTER TABLE public.marvin_sources
  DROP CONSTRAINT IF EXISTS marvin_sources_knowledge_scope_check;

ALTER TABLE public.marvin_sources
  ADD CONSTRAINT marvin_sources_knowledge_scope_check
  CHECK (knowledge_scope IN ('project', 'general'));

ALTER TABLE public.marvin_index_files
  ALTER COLUMN project_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marvin_index_files_general_source_key
  ON public.marvin_index_files(source_id)
  WHERE project_id IS NULL;
