-- Serialize sends for the same board element across tabs and users. Existing
-- duplicates remain untouched; an ordinary edit to them still works.
CREATE OR REPLACE FUNCTION public.guard_board_material_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.source_board_element_id IS NULL OR COALESCE(NEW.not_needed, false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.project_id IS NOT DISTINCT FROM NEW.project_id
     AND OLD.source_board_element_id IS NOT DISTINCT FROM NEW.source_board_element_id
     AND NOT COALESCE(OLD.not_needed, false) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'board-material:' || NEW.project_id::text || ':' || NEW.source_board_element_id, 0
  ));
  IF EXISTS (
    SELECT 1 FROM public.material_items AS item
    WHERE item.project_id = NEW.project_id
      AND item.source_board_element_id = NEW.source_board_element_id
      AND NOT COALESCE(item.not_needed, false)
      AND item.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'material_items_board_source_unique: board item already exists';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_board_material_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_board_material_identity ON public.material_items;
CREATE TRIGGER guard_board_material_identity
BEFORE INSERT OR UPDATE OF project_id, source_board_element_id, not_needed
ON public.material_items FOR EACH ROW
EXECUTE FUNCTION public.guard_board_material_identity();
