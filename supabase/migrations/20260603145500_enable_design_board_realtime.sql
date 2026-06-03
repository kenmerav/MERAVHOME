ALTER TABLE public.design_boards REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'design_boards'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.design_boards;
  END IF;
END $$;
