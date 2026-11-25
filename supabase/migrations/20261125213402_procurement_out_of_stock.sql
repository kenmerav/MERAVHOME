CREATE TABLE public.procurement_item_availability (
  material_item_id uuid PRIMARY KEY REFERENCES public.material_items(id) ON DELETE CASCADE,
  out_of_stock boolean NOT NULL DEFAULT false,
  notes text
);

ALTER TABLE public.procurement_item_availability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.procurement_item_availability FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.procurement_item_availability TO authenticated;

CREATE POLICY "Ken and Katie procurement availability"
ON public.procurement_item_availability
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.is_active = true
      AND lower(profile.email) IN ('ken@meravinteriors.com', 'katie@meravinteriors.com')
  )
);
