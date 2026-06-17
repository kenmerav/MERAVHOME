CREATE INDEX CONCURRENTLY IF NOT EXISTS design_board_versions_project_created_version_idx
  ON public.design_board_versions(project_id, created_at DESC, version_id DESC);
