ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.user_profiles
SET is_owner = TRUE
WHERE lower(email) = 'ken@meravinteriors.com';

UPDATE public.user_profiles
SET is_owner = FALSE
WHERE lower(email) <> 'ken@meravinteriors.com';

CREATE INDEX IF NOT EXISTS user_profiles_is_owner_idx ON public.user_profiles(is_owner);
