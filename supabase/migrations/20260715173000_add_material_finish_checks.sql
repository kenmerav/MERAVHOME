alter table public.material_items
  add column if not exists finish_check_status text not null default 'unchecked',
  add column if not exists finish_check_image_finish text,
  add column if not exists finish_check_product_finish text,
  add column if not exists finish_check_image_url text,
  add column if not exists finish_check_confidence numeric,
  add column if not exists finish_check_reason text,
  add column if not exists finish_checked_at timestamptz;

alter table public.material_items
  drop constraint if exists material_items_finish_check_status_check;

alter table public.material_items
  add constraint material_items_finish_check_status_check
  check (finish_check_status in ('unchecked', 'match', 'possible_mismatch', 'uncertain'));
