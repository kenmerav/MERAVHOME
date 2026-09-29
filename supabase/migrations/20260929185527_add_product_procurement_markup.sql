alter table public.products
  add column if not exists retail_price text,
  add column if not exists markup_percent numeric,
  add column if not exists markup_basis text;

alter table public.products
  add constraint products_markup_basis_check
  check (markup_basis is null or markup_basis in ('retail_price', 'our_price'));

comment on column public.products.retail_price is
  'Public retail unit price before Studio markup.';

comment on column public.products.markup_percent is
  'Percentage applied to the selected markup basis to calculate client price.';

comment on column public.products.markup_basis is
  'Price used as the markup base: retail_price or our_price (unit_cost).';
