-- Additive, internal-only storage. Existing materials, products and documents
-- Filename matches the version recorded by the approved Supabase migration.
-- are never updated by these functions. Only guarded Studio server APIs use it.
CREATE TABLE public.spec_completion_reviews (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  report jsonb,
  issues jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(issues) = 'object'),
  source_signature text,
  checked_at timestamptz,
  checked_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.spec_completion_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spec_completion_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.spec_completion_reviews TO service_role;

CREATE FUNCTION public.save_spec_completion_review(
  p_project_id uuid, p_user_id uuid, p_report jsonb, p_source_signature text, p_issues jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  existing public.spec_completion_reviews%ROWTYPE;
  incoming_time timestamptz := (p_report->>'checked_at')::timestamptz;
  entry record;
  merged jsonb;
  prior jsonb;
BEGIN
  IF jsonb_typeof(p_report) IS DISTINCT FROM 'object' OR incoming_time IS NULL
    OR jsonb_typeof(p_issues) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid review' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.spec_completion_reviews(project_id) VALUES (p_project_id) ON CONFLICT DO NOTHING;
  SELECT * INTO existing FROM public.spec_completion_reviews WHERE project_id = p_project_id FOR UPDATE;
  IF existing.checked_at IS NOT NULL AND existing.checked_at >= incoming_time THEN
    RAISE EXCEPTION 'A newer check already exists' USING ERRCODE = '40001';
  END IF;
  merged := existing.issues;
  FOR entry IN SELECT * FROM jsonb_each(p_issues) LOOP
    IF entry.key !~ '^[a-f0-9]{64}$' OR entry.value->>'key' IS DISTINCT FROM entry.key THEN
      RAISE EXCEPTION 'Invalid issue' USING ERRCODE = '22023';
    END IF;
    prior := existing.issues->entry.key;
    merged := jsonb_set(merged, ARRAY[entry.key], entry.value || jsonb_build_object(
      'status', coalesce(prior->>'status', 'open'),
      'first_seen_at', coalesce(prior->'first_seen_at', entry.value->'first_seen_at'),
      'suggestion', CASE WHEN prior->'suggestion'->>'kind' = 'dimensions' AND (
        prior->'suggestion'->'value'->'document'->>'id' IS DISTINCT FROM p_report->'document'->>'id'
        OR prior->'suggestion'->>'document_updated_at' IS DISTINCT FROM p_report->'document'->>'updated_at'
      ) THEN NULL ELSE prior->'suggestion' END,
      'status_updated_at', prior->'status_updated_at',
      'status_updated_by', prior->'status_updated_by'
    ));
  END LOOP;
  -- Retain earlier findings too: absence from a later AI answer is not proof
  -- that staff fixed an issue. The UI labels findings from earlier checks.
  UPDATE public.spec_completion_reviews SET report = p_report, issues = merged,
    source_signature = p_source_signature, checked_at = incoming_time,
    checked_by = p_user_id, updated_at = clock_timestamp() WHERE project_id = p_project_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_spec_completion_review(uuid,uuid,jsonb,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_spec_completion_review(uuid,uuid,jsonb,text,jsonb) TO service_role;

CREATE FUNCTION public.set_spec_completion_issue_status(
  p_project_id uuid, p_user_id uuid, p_issue_key text, p_status text, p_expected_updated_at text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  current_issue jsonb;
BEGIN
  IF p_status NOT IN ('open','completed','not_needed') OR p_status IS NULL
    OR p_issue_key !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid issue status' USING ERRCODE = '22023';
  END IF;
  SELECT issues->p_issue_key INTO current_issue FROM public.spec_completion_reviews
    WHERE project_id = p_project_id FOR UPDATE;
  IF current_issue IS NULL OR (current_issue->>'status_updated_at') IS DISTINCT FROM p_expected_updated_at THEN
    RETURN false;
  END IF;
  UPDATE public.spec_completion_reviews SET issues = jsonb_set(issues, ARRAY[p_issue_key], current_issue || jsonb_build_object(
    'status', p_status, 'status_updated_at', clock_timestamp(), 'status_updated_by', p_user_id
  )), updated_at = clock_timestamp() WHERE project_id = p_project_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_spec_completion_issue_status(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_spec_completion_issue_status(uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.save_spec_completion_suggestion(
  p_project_id uuid, p_issue_key text, p_checked_at text, p_suggestion jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  current_issue jsonb;
BEGIN
  IF p_issue_key !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_suggestion) IS DISTINCT FROM 'object'
    OR p_suggestion->>'kind' NOT IN ('color','dimensions') OR p_suggestion->>'kind' IS NULL THEN
    RAISE EXCEPTION 'Invalid suggestion' USING ERRCODE = '22023';
  END IF;
  SELECT issues->p_issue_key INTO current_issue FROM public.spec_completion_reviews
    WHERE project_id = p_project_id FOR UPDATE;
  IF current_issue IS NULL OR current_issue->>'last_seen_at' IS DISTINCT FROM p_checked_at
    OR current_issue->'finding'->>'field' IS DISTINCT FROM p_suggestion->>'kind' THEN
    RETURN false;
  END IF;
  UPDATE public.spec_completion_reviews SET issues = jsonb_set(issues, ARRAY[p_issue_key,'suggestion'], p_suggestion),
    updated_at = clock_timestamp() WHERE project_id = p_project_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.save_spec_completion_suggestion(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_spec_completion_suggestion(uuid,text,text,jsonb) TO service_role;
