DO $$ BEGIN
  CREATE TYPE public.app_user_role AS ENUM ('Admin', 'Employee', 'Contractor', 'Client');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role public.app_user_role NOT NULL DEFAULT 'Client',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_profiles_role_idx ON public.user_profiles(role);

CREATE OR REPLACE FUNCTION public.set_user_profiles_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER set_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_user_profiles_updated_at();

REVOKE ALL ON public.user_profiles FROM anon, authenticated;
GRANT SELECT ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;
