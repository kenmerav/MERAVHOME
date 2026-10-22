-- Optional provenance only. Existing images stay unclassified and are not guessed or changed.
ALTER TABLE public.room_images
  ADD COLUMN rendering_source text
  CHECK (rendering_source IN ('external', 'generated', 'imported'));

COMMENT ON COLUMN public.room_images.rendering_source IS
  'How an image entered Studio; null means older/unknown. Does not change visibility or approval.';
