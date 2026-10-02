-- STAGED ONLY: review before applying to production.
-- Existing integers remain unchanged and default to Count; no row becomes TBD.
-- ALTER TYPE may briefly lock/rewrite material_items. Apply in a quiet window
-- with a verified database backup. Do not coerce quantities back to integer after
-- decimal areas have been saved. To roll back the UI, retain these compatible
-- columns/type; removing them would discard unit/TBD information.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.material_items
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric,
  ADD COLUMN quantity_unit text NOT NULL DEFAULT 'count'
    CHECK (quantity_unit IN ('count', 'square_feet')),
  ADD COLUMN quantity_tbd boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT material_items_tbd_quantity CHECK (NOT quantity_tbd OR quantity IS NULL);

-- The legacy material policy permits broad writes. Protect quantity changes at
-- the database boundary too, rather than relying on disabled client controls.
-- SECURITY INVOKER, not DEFINER; no privileged function exposed as a REST RPC.
CREATE FUNCTION public.guard_material_quantity_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  profile public.user_profiles%ROWTYPE;
  staff boolean;
  checked_project uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND
    NEW.quantity IS NOT DISTINCT FROM OLD.quantity AND
    NEW.quantity_unit IS NOT DISTINCT FROM OLD.quantity_unit AND
    NEW.quantity_tbd IS NOT DISTINCT FROM OLD.quantity_tbd AND
    NEW.project_id IS NOT DISTINCT FROM OLD.project_id AND
    NEW.room_id IS NOT DISTINCT FROM OLD.room_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.quantity IS NULL AND
    NEW.quantity_unit = 'count' AND NOT NEW.quantity_tbd THEN
    RETURN NEW; -- Preserve existing blank-placeholder creation flows.
  END IF;
  IF NEW.quantity IS NOT NULL AND (
    NOT (NEW.quantity >= 0 AND NEW.quantity <= 1000000000000) OR
    scale(NEW.quantity) > 4 OR
    (NEW.quantity_unit = 'count' AND NEW.quantity <> trunc(NEW.quantity))
  ) THEN
    RAISE EXCEPTION 'Enter a non-negative quantity; Count requires a whole number, Sq Ft allows up to 4 decimal places.' USING ERRCODE = '23514';
  END IF;
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW; -- Existing trusted imports/system operations.
  END IF;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to edit quantities.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO profile FROM public.user_profiles WHERE id = actor;
  staff := coalesce(lower(trim(profile.role::text)) IN ('admin', 'employee'), false);
  IF NOT coalesce(profile.is_active, false) OR NOT coalesce((
    staff OR lower(trim(profile.role::text)) IN ('contractor', 'builder', 'gc') OR
    lower(profile.email) = 'homebycastellani@gmail.com'
  ), false) THEN
    RAISE EXCEPTION 'This account cannot edit Spec Book quantities.' USING ERRCODE = '42501';
  END IF;
  -- Check the old project as well as the new one so moving a row cannot bypass
  -- assignment checks. Assigned clients still cannot edit unless already an
  -- explicitly authorized Spec Book editor.
  FOR checked_project IN
    SELECT NEW.project_id UNION SELECT CASE WHEN TG_OP = 'UPDATE' THEN OLD.project_id ELSE NEW.project_id END
  LOOP
    IF NOT (staff AND coalesce(profile.can_view_all_projects, false)) AND NOT EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = actor AND project_id = checked_project
    ) THEN
      RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = '42501';
    END IF;
    IF NOT staff AND NOT EXISTS (
      SELECT 1 FROM public.projects WHERE id = checked_project AND
        CASE WHEN lower(trim(profile.role::text)) = 'client' THEN client_can_view_spec_book
             ELSE contractor_can_view_spec_book END
    ) THEN
      RAISE EXCEPTION 'Spec Book access is disabled for this project.' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = NEW.room_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'The room does not belong to this project.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_material_quantity_edit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_material_quantity_edit
BEFORE INSERT OR UPDATE OF quantity, quantity_unit, quantity_tbd, project_id, room_id
ON public.material_items
FOR EACH ROW EXECUTE FUNCTION public.guard_material_quantity_edit();

NOTIFY pgrst, 'reload schema';
COMMIT;
