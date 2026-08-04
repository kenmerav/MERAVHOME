-- Procurement and the Spec Book must use the same material item rows.
-- Preserve legacy procurement status while moving status fields onto materials.
ALTER TABLE public.material_items
  ADD COLUMN IF NOT EXISTS received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS installed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS procurement_notes text;

WITH ranked_materials AS (
  SELECT
    mi.id,
    mi.room_id,
    mi.product_id,
    row_number() OVER (
      PARTITION BY mi.room_id, mi.product_id
      ORDER BY mi.created_at, mi.id
    ) AS pair_rank
  FROM public.material_items mi
  WHERE mi.product_id IS NOT NULL
),
ranked_procurement AS (
  SELECT
    pi.ordered,
    pi.received,
    pi.installed,
    pi.notes,
    rp.room_id,
    rp.product_id,
    row_number() OVER (
      PARTITION BY rp.room_id, rp.product_id
      ORDER BY pi.updated_at, pi.id
    ) AS pair_rank
  FROM public.procurement_items pi
  JOIN public.room_products rp ON rp.id = pi.room_product_id
)
UPDATE public.material_items mi
SET
  ordered = COALESCE(rp.ordered, mi.ordered, false),
  received = COALESCE(rp.received, false),
  installed = COALESCE(rp.installed, false),
  procurement_notes = COALESCE(rp.notes, mi.procurement_notes)
FROM ranked_materials rm
JOIN ranked_procurement rp
  ON rp.room_id = rm.room_id
 AND rp.product_id = rm.product_id
 AND rp.pair_rank = rm.pair_rank
WHERE mi.id = rm.id;

CREATE INDEX IF NOT EXISTS idx_material_items_procurement
  ON public.material_items(project_id, room_id, product_id)
  WHERE not_needed = false AND product_id IS NOT NULL;
