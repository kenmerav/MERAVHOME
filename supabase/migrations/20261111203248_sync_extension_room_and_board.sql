CREATE FUNCTION public.save_extension_room_and_board(
  p_project_id uuid,
  p_room_id uuid,
  p_board_updated_at timestamptz,
  p_room_updated_at timestamptz,
  p_board_state jsonb,
  p_room_state jsonb,
  p_event_details jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_board_updated_at IS NULL THEN
    INSERT INTO public.design_boards (project_id, board_state)
    VALUES (p_project_id, p_board_state)
    ON CONFLICT (project_id) DO NOTHING;
  ELSE
    UPDATE public.design_boards
    SET board_state = p_board_state
    WHERE project_id = p_project_id AND updated_at = p_board_updated_at;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Design board changed during import' USING ERRCODE = '40001';
  END IF;

  IF p_room_updated_at IS NULL THEN
    INSERT INTO public.room_design_workflows (project_id, room_id, state)
    VALUES (p_project_id, p_room_id, p_room_state)
    ON CONFLICT (project_id, room_id) DO NOTHING;
  ELSE
    UPDATE public.room_design_workflows
    SET state = p_room_state, updated_by = NULL
    WHERE project_id = p_project_id AND room_id = p_room_id AND updated_at = p_room_updated_at;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room Design changed during import' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.room_design_events (project_id, room_id, event_type, details)
  VALUES (p_project_id, p_room_id, 'extension_selection_imported', p_event_details);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_extension_room_and_board(uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_extension_room_and_board(uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb)
TO service_role;
