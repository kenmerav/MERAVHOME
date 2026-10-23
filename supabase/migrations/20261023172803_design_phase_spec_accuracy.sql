-- Opt-in records; no backfill or changes to historical projects.
CREATE TABLE public.design_accuracy_projects (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision >= 0),
  state jsonb NOT NULL CHECK (state->>'schema' = '1'),
  projection jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES public.user_profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state->>'projectId' = project_id::text),
  CHECK ((state->>'revision')::bigint = revision)
);
ALTER TABLE public.design_accuracy_projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.design_accuracy_projects FROM anon, authenticated;
GRANT SELECT ON public.design_accuracy_projects TO authenticated;
GRANT ALL ON public.design_accuracy_projects TO service_role;
CREATE POLICY "assigned designers read accuracy decisions" ON public.design_accuracy_projects
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = auth.uid() AND p.is_active
    AND p.role IN ('Admin', 'Employee') AND
    (p.role = 'Admin' OR p.can_view_all_projects OR EXISTS
      (SELECT 1 FROM public.user_project_assignments a WHERE a.project_id = design_accuracy_projects.project_id AND a.user_id = auth.uid())))
);

-- Binds exact, project-specific facts without changing shared catalog products or manual notes.
ALTER TABLE public.material_items ADD COLUMN design_accuracy_fact jsonb;

CREATE FUNCTION public.save_design_accuracy(p_project_id uuid, p_expected_revision bigint, p_state jsonb, p_projection jsonb, p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE affected bigint; room jsonb; item jsonb; fact jsonb;
BEGIN
  -- Only the authorized server may call this function. The server derives approvals using shared validation.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'server validation required'; END IF;
  IF p_expected_revision = -1 THEN
    INSERT INTO public.design_accuracy_projects(project_id,revision,state,projection,updated_by)
    VALUES (p_project_id,(p_state->>'revision')::bigint,p_state,p_projection,p_actor)
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.design_accuracy_projects SET revision=(p_state->>'revision')::bigint,
      state=p_state,projection=p_projection,updated_by=p_actor,updated_at=now()
    WHERE project_id=p_project_id AND revision=p_expected_revision
      AND (p_state->>'revision')::bigint > p_expected_revision;
  END IF;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN RETURN false; END IF;
  FOR room IN SELECT value FROM jsonb_array_elements(p_state->'rooms') LOOP
    FOR item IN SELECT value FROM jsonb_array_elements(room->'items') LOOP
      IF item->>'materialId' IS NULL THEN CONTINUE; END IF;
      SELECT value INTO fact FROM jsonb_array_elements(p_projection->'rows') WHERE value->>'sourceId'=item->>'id';
      IF fact IS NOT NULL THEN
        UPDATE public.material_items SET design_accuracy_fact=fact,
          color=fact->>'color',quantity=(fact->>'quantity')::numeric,
          quantity_tbd=(fact->>'quantity') IS NULL,
          quantity_unit=CASE WHEN fact->>'quantityUnit'='sq ft' THEN 'square_feet' ELSE 'count' END,
          selection_quantity_unit=CASE WHEN fact->>'quantityUnit'='sq ft' THEN 'square_feet' WHEN fact->>'quantityUnit'='linear ft' THEN 'linear_feet' WHEN fact->>'quantityUnit'='each' THEN 'count' ELSE NULLIF(fact->>'quantityUnit','') END,
          image_url=NULLIF(fact->>'imageUrl',''), product_url=NULLIF(fact->>'url',''),not_needed=false
        WHERE id=(item->>'materialId')::uuid AND project_id=p_project_id AND room_id=(room->>'id')::uuid;
      ELSIF item->'decision'->>'disposition'='not-needed' THEN
        UPDATE public.material_items SET not_needed=true,design_accuracy_fact=NULL
        WHERE id=(item->>'materialId')::uuid AND project_id=p_project_id AND room_id=(room->>'id')::uuid;
      END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.save_design_accuracy(uuid,bigint,jsonb,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_design_accuracy(uuid,bigint,jsonb,jsonb,uuid) TO service_role;

CREATE FUNCTION public.guard_design_accuracy_material() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF NEW.design_accuracy_fact IS DISTINCT FROM OLD.design_accuracy_fact THEN RAISE EXCEPTION 'Use Room Design to change confirmed selection facts'; END IF;
    IF OLD.design_accuracy_fact IS NOT NULL AND
      ROW(NEW.quantity,NEW.quantity_tbd,NEW.quantity_unit,NEW.selection_quantity_unit,NEW.color,NEW.product_url,NEW.image_url,NEW.product_id,NEW.not_needed)
      IS DISTINCT FROM ROW(OLD.quantity,OLD.quantity_tbd,OLD.quantity_unit,OLD.selection_quantity_unit,OLD.color,OLD.product_url,OLD.image_url,OLD.product_id,OLD.not_needed)
      THEN RAISE EXCEPTION 'This selection is connected to Room Design. Change its design decision there.'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_design_accuracy_material BEFORE UPDATE ON public.material_items
FOR EACH ROW EXECUTE FUNCTION public.guard_design_accuracy_material();
-- INSERT has no OLD record; disallow forged canonical facts on direct inserts too.
CREATE FUNCTION public.guard_design_accuracy_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NEW.design_accuracy_fact IS NOT NULL THEN RAISE EXCEPTION 'server validation required'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_design_accuracy_insert BEFORE INSERT ON public.material_items
FOR EACH ROW EXECUTE FUNCTION public.guard_design_accuracy_insert();
