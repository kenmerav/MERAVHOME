-- Native Studio operations workspace for the Executive Assistant.
-- All records stay behind server APIs; browser roles receive no direct table access.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS can_use_ea_workspace boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.ea_directory_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_kind text NOT NULL DEFAULT 'partner'
    CHECK (contact_kind IN ('merav_team', 'client', 'builder_trade_consultant', 'vendor_rep', 'partner')),
  name text NOT NULL,
  company text,
  general_role text,
  email text,
  phone text,
  preferred_communication text,
  internal_notes text,
  verification_status text NOT NULL DEFAULT 'needs_verification'
    CHECK (verification_status IN ('verified', 'needs_verification', 'archived')),
  source_type text,
  source_reference text,
  last_verified_at timestamptz,
  verified_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ea_directory_contacts_email_key
  ON public.ea_directory_contacts(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS ea_directory_contacts_name_idx
  ON public.ea_directory_contacts(lower(name), lower(company));

CREATE TABLE IF NOT EXISTS public.ea_vendor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_company text NOT NULL,
  brand_or_manufacturer text,
  primary_sales_contact_id uuid REFERENCES public.ea_directory_contacts(id) ON DELETE SET NULL,
  service_contact_id uuid REFERENCES public.ea_directory_contacts(id) ON DELETE SET NULL,
  ordering_method text,
  categories text[] NOT NULL DEFAULT '{}',
  brands_supplied text[] NOT NULL DEFAULT '{}',
  purchasing_instructions text,
  purchasing_route_status text NOT NULL DEFAULT 'needs_verification'
    CHECK (purchasing_route_status IN ('confirmed', 'confirm_route', 'needs_verification', 'archived')),
  contact_verification_status text NOT NULL DEFAULT 'needs_verification'
    CHECK (contact_verification_status IN ('verified', 'needs_verification', 'archived')),
  source_type text,
  source_reference text,
  last_verified_at timestamptz,
  verified_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ea_vendor_profiles_supplier_key
  ON public.ea_vendor_profiles(lower(supplier_company));

CREATE TABLE IF NOT EXISTS public.ea_project_contact_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.ea_directory_contacts(id) ON DELETE CASCADE,
  role_on_project text NOT NULL,
  responsibilities text,
  ask_them_about text,
  preferred_communication text,
  copy_contact_id uuid REFERENCES public.ea_directory_contacts(id) ON DELETE SET NULL,
  backup_contact_id uuid REFERENCES public.ea_directory_contacts(id) ON DELETE SET NULL,
  verification_status text NOT NULL DEFAULT 'needs_verification'
    CHECK (verification_status IN ('verified', 'needs_verification', 'archived')),
  source_type text,
  source_reference text,
  last_verified_at timestamptz,
  verified_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, contact_id, role_on_project)
);

CREATE INDEX IF NOT EXISTS ea_project_contact_assignments_project_idx
  ON public.ea_project_contact_assignments(project_id, role_on_project);

CREATE TABLE IF NOT EXISTS public.ea_project_operations (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'on_hold', 'completed')),
  phase text,
  aliases text[] NOT NULL DEFAULT '{}',
  next_milestone text,
  current_blocker text,
  waiting_party text,
  next_action text,
  responsible_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  responsible_contact_id uuid REFERENCES public.ea_directory_contacts(id) ON DELETE SET NULL,
  follow_up_date date,
  last_reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ea_directory_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id text NOT NULL,
  source_sheet_id text NOT NULL,
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  source_fingerprint text NOT NULL,
  safe_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_status text NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review', 'approved', 'skipped', 'conflict')),
  review_notes text,
  matched_vendor_id uuid REFERENCES public.ea_vendor_profiles(id) ON DELETE SET NULL,
  matched_contact_id uuid REFERENCES public.ea_directory_contacts(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_document_id, source_sheet_id, source_row_number)
);

CREATE INDEX IF NOT EXISTS ea_directory_import_rows_fingerprint_idx
  ON public.ea_directory_import_rows(source_document_id, source_fingerprint);

CREATE TABLE IF NOT EXISTS public.ea_task_contexts (
  todo_id uuid PRIMARY KEY REFERENCES public.shared_project_todos(id) ON DELETE CASCADE,
  relevant_contact_id uuid REFERENCES public.ea_directory_contacts(id) ON DELETE SET NULL,
  waiting_contact_id uuid REFERENCES public.ea_directory_contacts(id) ON DELETE SET NULL,
  ea_next_action text,
  next_follow_up_date date,
  acknowledged_at timestamptz,
  completion_evidence text,
  work_artifact_kind text CHECK (work_artifact_kind IS NULL OR work_artifact_kind IN ('work_note', 'email_draft', 'action_plan')),
  work_artifact_text text,
  approval_status text NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft', 'pending', 'approved', 'changes_requested')),
  approval_requested_at timestamptz,
  approval_reviewed_at timestamptz,
  approval_reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ea_task_contexts_follow_up_idx
  ON public.ea_task_contexts(next_follow_up_date);

DROP TRIGGER IF EXISTS ea_directory_contacts_touch ON public.ea_directory_contacts;
CREATE TRIGGER ea_directory_contacts_touch
BEFORE UPDATE ON public.ea_directory_contacts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS ea_vendor_profiles_touch ON public.ea_vendor_profiles;
CREATE TRIGGER ea_vendor_profiles_touch
BEFORE UPDATE ON public.ea_vendor_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS ea_project_contact_assignments_touch ON public.ea_project_contact_assignments;
CREATE TRIGGER ea_project_contact_assignments_touch
BEFORE UPDATE ON public.ea_project_contact_assignments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS ea_project_operations_touch ON public.ea_project_operations;
CREATE TRIGGER ea_project_operations_touch
BEFORE UPDATE ON public.ea_project_operations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS ea_directory_import_rows_touch ON public.ea_directory_import_rows;
CREATE TRIGGER ea_directory_import_rows_touch
BEFORE UPDATE ON public.ea_directory_import_rows
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS ea_task_contexts_touch ON public.ea_task_contexts;
CREATE TRIGGER ea_task_contexts_touch
BEFORE UPDATE ON public.ea_task_contexts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.ea_directory_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ea_vendor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ea_project_contact_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ea_project_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ea_directory_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ea_task_contexts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
  public.ea_directory_contacts,
  public.ea_vendor_profiles,
  public.ea_project_contact_assignments,
  public.ea_project_operations,
  public.ea_directory_import_rows,
  public.ea_task_contexts
FROM anon, authenticated;

GRANT ALL ON
  public.ea_directory_contacts,
  public.ea_vendor_profiles,
  public.ea_project_contact_assignments,
  public.ea_project_operations,
  public.ea_directory_import_rows,
  public.ea_task_contexts
TO service_role;

-- User-confirmed purchasing routes override conflicting historical notes.
INSERT INTO public.ea_vendor_profiles (
  supplier_company,
  brand_or_manufacturer,
  categories,
  brands_supplied,
  purchasing_instructions,
  purchasing_route_status,
  contact_verification_status,
  source_type,
  source_reference
)
VALUES
  (
    'Sunlighting',
    NULL,
    ARRAY['Lighting'],
    ARRAY[]::text[],
    'Primary route for general lighting. Jeff is the primary contact; contact details still need verification.',
    'confirmed',
    'needs_verification',
    'user_confirmed',
    'EA workspace brief, 2026-09-08'
  ),
  (
    'Visual Comfort',
    'Visual Comfort',
    ARRAY['Lighting'],
    ARRAY['Visual Comfort'],
    'Use for designated lighting only. Do not assume every Visual Comfort-branded item uses this route; confirm when unclear.',
    'confirmed',
    'needs_verification',
    'user_confirmed',
    'EA workspace brief, 2026-09-08'
  ),
  (
    'Four Hands',
    'Four Hands',
    ARRAY['Furniture', 'Lighting'],
    ARRAY['Four Hands'],
    'Purchase Four Hands products directly through Four Hands, including Four Hands lighting.',
    'confirmed',
    'needs_verification',
    'user_confirmed',
    'EA workspace brief, 2026-09-08'
  )
ON CONFLICT ((lower(supplier_company))) DO UPDATE SET
  purchasing_instructions = EXCLUDED.purchasing_instructions,
  purchasing_route_status = EXCLUDED.purchasing_route_status,
  source_type = EXCLUDED.source_type,
  source_reference = EXCLUDED.source_reference,
  updated_at = now();
