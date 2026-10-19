-- Preserve selection measurement/TBD/waste through the shared Materials path.
-- Additive columns; the original unit column/constraint and all rows stay intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Assignments are already managed through the authenticated admin server.
-- Restore the original table's intended browser read-only contract so callers
-- cannot grant themselves project access. Keep all assignment records intact.
REVOKE ALL PRIVILEGES ON TABLE public.user_project_assignments FROM anon, authenticated;
GRANT SELECT ON TABLE public.user_project_assignments TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.user_project_assignments TO service_role;

ALTER TABLE public.material_items
  ADD COLUMN IF NOT EXISTS waste_percent numeric NOT NULL DEFAULT 0
    CHECK (waste_percent >= 0 AND waste_percent <= 100),
  ADD COLUMN IF NOT EXISTS selection_quantity_unit text
    CHECK (selection_quantity_unit IN ('count','square_feet','linear_feet','pair','set','box','carton','slab','roll','gallon'));

CREATE OR REPLACE FUNCTION public.guard_material_quantity_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  profile public.user_profiles%ROWTYPE;
  staff boolean;
  checked_project uuid;
  selected_unit text := coalesce(NEW.selection_quantity_unit, NEW.quantity_unit);
BEGIN
  IF TG_OP = 'UPDATE' AND
    NEW.quantity IS NOT DISTINCT FROM OLD.quantity AND
    NEW.quantity_unit IS NOT DISTINCT FROM OLD.quantity_unit AND
    NEW.quantity_tbd IS NOT DISTINCT FROM OLD.quantity_tbd AND
    NEW.selection_quantity_unit IS NOT DISTINCT FROM OLD.selection_quantity_unit AND
    NEW.waste_percent IS NOT DISTINCT FROM OLD.waste_percent AND
    NEW.project_id IS NOT DISTINCT FROM OLD.project_id AND
    NEW.room_id IS NOT DISTINCT FROM OLD.room_id THEN RETURN NEW; END IF;
  IF NEW.quantity IS NOT NULL AND (
    NOT (NEW.quantity >= 0 AND NEW.quantity <= 1000000000000) OR scale(NEW.quantity) > 4 OR
    (selected_unit IN ('count','pair','set','box','carton','slab') AND NEW.quantity <> trunc(NEW.quantity))
  ) THEN RAISE EXCEPTION 'Enter a non-negative quantity with up to 4 decimal places; count, pair, set, box, carton and slab require whole numbers.' USING ERRCODE = '23514'; END IF;
  IF NEW.waste_percent IS NULL OR NEW.waste_percent < 0 OR NEW.waste_percent > 100 THEN
    RAISE EXCEPTION 'Waste must be between 0 and 100 percent.' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' AND NEW.quantity IS NULL AND NEW.quantity_unit = 'count' AND NEW.selection_quantity_unit IS NULL
    AND NOT NEW.quantity_tbd AND NEW.waste_percent = 0 THEN RETURN NEW; END IF;
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to edit quantities.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO profile FROM public.user_profiles WHERE id = actor;
  staff := coalesce(lower(trim(profile.role::text)) IN ('admin','employee'), false);
  IF NOT coalesce(profile.is_active, false) OR NOT coalesce((staff OR
    lower(trim(profile.role::text)) IN ('contractor','builder','gc') OR
    lower(profile.email) = 'homebycastellani@gmail.com'), false) THEN
    RAISE EXCEPTION 'This account cannot edit Spec Book quantities.' USING ERRCODE = '42501'; END IF;
  FOR checked_project IN SELECT NEW.project_id UNION SELECT CASE WHEN TG_OP = 'UPDATE' THEN OLD.project_id ELSE NEW.project_id END LOOP
    IF NOT (staff AND (profile.role::text = 'Admin' OR profile.can_view_all_projects IS DISTINCT FROM false)) AND NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments WHERE user_id = actor AND project_id = checked_project
    ) THEN RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = '42501'; END IF;
    IF NOT staff AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = checked_project AND
      CASE WHEN lower(trim(profile.role::text)) = 'client' THEN client_can_view_spec_book ELSE contractor_can_view_spec_book END
    ) THEN RAISE EXCEPTION 'Spec Book access is disabled for this project.' USING ERRCODE = '42501'; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = NEW.room_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'The room does not belong to this project.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_material_quantity_edit() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER guard_material_measurement_edit BEFORE INSERT OR UPDATE OF selection_quantity_unit, waste_percent
ON public.material_items FOR EACH ROW EXECUTE FUNCTION public.guard_material_quantity_edit();

-- Designers can use enrolled projects, with the same assignment restriction in
-- the browser, server endpoints and direct database requests. External roles
-- never gain Room Design access. Enrollment remains an administrator action.
DO $$
DECLARE
  table_name text;
  rule record;
  access_expression text;
  check_expression text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['room_design_projects','room_design_workflows','room_design_events'] LOOP
    access_expression := format($policy$
      EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_active = true
        AND p.role::text IN ('Admin','Employee') AND (p.role::text = 'Admin' OR p.can_view_all_projects IS DISTINCT FROM false
          OR EXISTS (SELECT 1 FROM public.user_project_assignments a WHERE a.user_id = p.id AND a.project_id = %I.project_id)))
    $policy$, table_name);
    FOR rule IN SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name
      AND policyname LIKE 'studio team%' LOOP
      IF rule.cmd = 'SELECT' THEN
        EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated USING (%s)', rule.policyname, table_name, access_expression);
      ELSIF rule.cmd = 'UPDATE' THEN
        EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated USING (%s) WITH CHECK (%s)', rule.policyname, table_name, access_expression, access_expression);
      ELSIF rule.cmd = 'INSERT' THEN
        check_expression := access_expression;
        IF table_name = 'room_design_events' THEN
          check_expression := check_expression || ' AND created_by = (SELECT auth.uid()) AND (room_id IS NULL OR EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.project_id = room_design_events.project_id))';
        END IF;
        EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated WITH CHECK (%s)', rule.policyname, table_name, check_expression);
      END IF;
    END LOOP;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
