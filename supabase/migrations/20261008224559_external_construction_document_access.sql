-- Applied with production migration version 20261008224559.
-- Reviewed access change: no files or history are removed. Staff keep history.
-- External logins get one latest uploaded Construction Doc per assigned project,
-- only while the project's construction-doc access setting permits that role.
-- Existing project-level sharing settings remain the source of truth.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.studio_readable_project_document_ids()
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE actor uuid := auth.uid(); profile public.user_profiles%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RETURN; END IF;
  SELECT * INTO profile FROM public.user_profiles WHERE id = actor;
  IF NOT coalesce(profile.is_active, false) THEN RETURN; END IF;
  IF lower(trim(profile.role::text)) IN ('admin', 'employee') THEN
    RETURN QUERY SELECT d.id FROM public.project_documents d
      WHERE profile.role::text = 'Admin' OR coalesce(profile.can_view_all_projects, true)
        OR EXISTS (SELECT 1 FROM public.user_project_assignments a WHERE a.user_id = actor AND a.project_id = d.project_id);
  ELSIF lower(trim(profile.role::text)) IN ('client', 'contractor', 'builder', 'gc') THEN
    RETURN QUERY SELECT latest.id FROM (
      SELECT DISTINCT ON (d.project_id) d.id, d.project_id
      FROM public.project_documents d
      JOIN public.projects p ON p.id = d.project_id
      JOIN public.user_project_assignments a ON a.project_id = d.project_id AND a.user_id = actor
      WHERE d.document_type = 'Construction Doc'
        AND CASE WHEN lower(trim(profile.role::text)) = 'client'
          THEN p.client_can_view_construction_docs ELSE p.contractor_can_view_construction_docs END
      ORDER BY d.project_id, d.created_at DESC, d.id DESC
    ) latest;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.studio_readable_project_document_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.studio_readable_project_document_ids() TO authenticated;

CREATE OR REPLACE FUNCTION private.studio_can_manage_document_project(target_project uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.is_active
      AND lower(trim(u.role::text)) IN ('admin', 'employee')
      AND (lower(trim(u.role::text)) = 'admin' OR coalesce(u.can_view_all_projects, true)
        OR EXISTS (SELECT 1 FROM public.user_project_assignments a WHERE a.user_id = auth.uid() AND a.project_id = target_project))
  );
$$;
REVOKE ALL ON FUNCTION private.studio_can_manage_document_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.studio_can_manage_document_project(uuid) TO authenticated;

-- Restrictive policies intersect existing broad policies instead of replacing
-- unrelated policies. The private lookup avoids recursive document RLS.
CREATE POLICY "Studio document read scope" ON public.project_documents
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (id IN (SELECT private.studio_readable_project_document_ids()));
CREATE POLICY "Studio document insert scope" ON public.project_documents
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (private.studio_can_manage_document_project(project_id));
CREATE POLICY "Studio document update scope" ON public.project_documents
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (private.studio_can_manage_document_project(project_id))
  WITH CHECK (private.studio_can_manage_document_project(project_id));
CREATE POLICY "Studio document delete scope" ON public.project_documents
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (private.studio_can_manage_document_project(project_id));

-- Preserve existing staff/contractor/editor ordering access. Kip's narrow
-- exception goes through the authenticated server API, which verifies his
-- login email, assignment and project setting before a service-role update.
CREATE OR REPLACE FUNCTION public.guard_spec_ordering_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE actor uuid := auth.uid(); profile public.user_profiles%ROWTYPE;
  staff boolean; editor boolean; checked_project uuid;
BEGIN
  IF NEW.ordered IS NOT DISTINCT FROM OLD.ordered AND NEW.ordered_by IS NOT DISTINCT FROM OLD.ordered_by THEN RETURN NEW; END IF;
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to update ordering.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO profile FROM public.user_profiles WHERE id = actor;
  IF NOT coalesce(profile.is_active, false) THEN RAISE EXCEPTION 'This account is not active.' USING ERRCODE = '42501'; END IF;
  staff := lower(trim(profile.role::text)) IN ('admin', 'employee');
  editor := staff OR lower(trim(profile.role::text)) IN ('contractor', 'builder', 'gc') OR lower(profile.email) = 'homebycastellani@gmail.com';
  -- Direct client database writes fail closed; use the narrow ordering API.
  IF NOT editor THEN RAISE EXCEPTION 'Use the Spec Book ordering control to update this item.' USING ERRCODE = '42501'; END IF;
  FOR checked_project IN SELECT OLD.project_id UNION SELECT NEW.project_id LOOP
    IF NOT (staff AND (lower(trim(profile.role::text)) = 'admin' OR coalesce(profile.can_view_all_projects, true))) AND NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments WHERE user_id = actor AND project_id = checked_project
    ) THEN RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = '42501'; END IF;
    IF NOT staff AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = checked_project AND
      CASE WHEN lower(trim(profile.role::text)) = 'client' THEN client_can_view_spec_book ELSE contractor_can_view_spec_book END
    ) THEN RAISE EXCEPTION 'Spec Book access is disabled for this project.' USING ERRCODE = '42501'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_spec_ordering_edit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_spec_ordering_edit BEFORE UPDATE OF ordered, ordered_by ON public.material_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_spec_ordering_edit();
NOTIFY pgrst, 'reload schema';
COMMIT;
