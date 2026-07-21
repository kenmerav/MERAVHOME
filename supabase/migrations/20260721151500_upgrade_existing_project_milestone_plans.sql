BEGIN;

-- Upgrade only complete, untouched copies of the original standard workflow.
-- Custom plans remain exactly as their managers configured them.
CREATE TEMP TABLE _pm_upgrade_projects ON COMMIT DROP AS
SELECT project.id AS project_id, project.project_type
FROM public.projects project
WHERE NOT EXISTS (
    SELECT 1
    FROM public.project_milestones milestone
    WHERE milestone.project_id = project.id
      AND milestone.is_custom = true
  )
  AND (
    SELECT count(DISTINCT milestone.title)
    FROM public.project_milestones milestone
    WHERE milestone.project_id = project.id
      AND milestone.title IN (
        'Create Project',
        'Create Rooms',
        'Upload SketchUp',
        'Design Selections',
        'AI Renderings',
        'Presentation Boards',
        'Client Approval',
        'Spec Book',
        'Procurement'
      )
  ) = 9;

CREATE TEMP TABLE _pm_sequence_dates ON COMMIT DROP AS
SELECT
  upgrade.project_id,
  max(milestone.target_date) FILTER (WHERE milestone.title = 'Design Selections') AS selections_date,
  max(milestone.target_date) FILTER (WHERE milestone.title = 'Upload SketchUp') AS sketchup_date
FROM _pm_upgrade_projects upgrade
JOIN public.project_milestones milestone ON milestone.project_id = upgrade.project_id
GROUP BY upgrade.project_id;

CREATE TEMP TABLE _pm_setup_merge ON COMMIT DROP AS
SELECT
  project_milestone.project_id,
  project_milestone.id AS keep_id,
  room_milestone.id AS remove_id,
  CASE
    WHEN project_milestone.status = 'complete' AND room_milestone.status = 'complete' THEN 'complete'
    WHEN project_milestone.status = 'blocked' OR room_milestone.status = 'blocked' THEN 'blocked'
    WHEN project_milestone.status IN ('in_progress', 'complete')
      OR room_milestone.status IN ('in_progress', 'complete') THEN 'in_progress'
    WHEN project_milestone.status = 'skipped' AND room_milestone.status = 'skipped' THEN 'skipped'
    ELSE 'not_started'
  END AS merged_status,
  greatest(project_milestone.target_date, room_milestone.target_date) AS merged_target_date,
  CASE
    WHEN project_milestone.status = 'complete' AND room_milestone.status = 'complete'
      THEN greatest(project_milestone.completed_at, room_milestone.completed_at)
    ELSE NULL
  END AS merged_completed_at,
  coalesce(project_milestone.owner_id, room_milestone.owner_id) AS merged_owner_id
FROM public.project_milestones project_milestone
JOIN public.project_milestones room_milestone
  ON room_milestone.project_id = project_milestone.project_id
 AND room_milestone.title = 'Create Rooms'
JOIN _pm_upgrade_projects upgrade ON upgrade.project_id = project_milestone.project_id
WHERE project_milestone.title = 'Create Project';

-- Dependencies are rebuilt after the new sequence is in place.
DELETE FROM public.project_milestone_dependencies dependency
USING public.project_milestones milestone, _pm_upgrade_projects upgrade
WHERE milestone.project_id = upgrade.project_id
  AND (
    dependency.milestone_id = milestone.id
    OR dependency.depends_on_milestone_id = milestone.id
  );

-- Keep one setup milestone and preserve non-template work linked to the old Rooms milestone.
DELETE FROM public.shared_project_todos task
USING _pm_setup_merge merge
WHERE task.milestone_id = merge.remove_id
  AND task.source_type = 'template'
  AND task.status = 'suggested';

UPDATE public.shared_project_todos task
SET
  status = 'cancelled',
  milestone_id = NULL,
  depends_on_todo_id = NULL
FROM _pm_setup_merge merge
WHERE task.milestone_id = merge.remove_id
  AND task.source_type = 'template';

UPDATE public.shared_project_todos task
SET milestone_id = merge.keep_id
FROM _pm_setup_merge merge
WHERE task.milestone_id = merge.remove_id
  AND task.source_type IS DISTINCT FROM 'template';

UPDATE public.project_milestones milestone
SET
  title = 'Create Project & Rooms',
  status = merge.merged_status,
  target_date = merge.merged_target_date,
  completed_at = merge.merged_completed_at,
  weight = 5,
  owner_id = merge.merged_owner_id,
  required_capability = 'project setup',
  is_critical = true,
  sort_order = 10
FROM _pm_setup_merge merge
WHERE milestone.id = merge.keep_id;

UPDATE public.shared_project_todos task
SET
  title = 'Create Project & Rooms',
  source_key = 'template:create-project-rooms',
  required_capability = 'project setup'
FROM _pm_setup_merge merge
WHERE task.milestone_id = merge.keep_id
  AND task.source_type = 'template'
  AND task.source_key = 'template:create-project';

DELETE FROM public.project_milestones milestone
USING _pm_setup_merge merge
WHERE milestone.id = merge.remove_id;

-- Design Selections now precedes SketchUp. Preserve the two original dates in sequence order.
UPDATE public.project_milestones milestone
SET
  weight = CASE
    WHEN upgrade.project_type IN ('Furnishings', 'Commercial') THEN 10
    ELSE 20
  END,
  target_date = least(dates.selections_date, dates.sketchup_date),
  required_capability = 'design boards',
  is_critical = true,
  sort_order = 20
FROM _pm_upgrade_projects upgrade
JOIN _pm_sequence_dates dates ON dates.project_id = upgrade.project_id
WHERE milestone.project_id = upgrade.project_id
  AND milestone.title = 'Design Selections';

UPDATE public.project_milestones milestone
SET
  title = 'Render and Draw SketchUp',
  target_date = greatest(dates.selections_date, dates.sketchup_date),
  weight = 20,
  required_capability = 'sketchup',
  is_critical = true,
  sort_order = 30
FROM _pm_upgrade_projects upgrade
JOIN _pm_sequence_dates dates ON dates.project_id = upgrade.project_id
WHERE milestone.project_id = upgrade.project_id
  AND milestone.title = 'Upload SketchUp';

UPDATE public.shared_project_todos task
SET
  title = 'Render and Draw SketchUp',
  source_key = 'template:render-and-draw-sketchup',
  required_capability = 'sketchup'
FROM _pm_upgrade_projects upgrade
WHERE task.project_id = upgrade.project_id
  AND task.source_type = 'template'
  AND task.source_key = 'template:upload-sketchup';

UPDATE public.project_milestones milestone
SET weight = 10, sort_order = 50
FROM _pm_upgrade_projects upgrade
WHERE milestone.project_id = upgrade.project_id
  AND milestone.title = 'AI Renderings';

UPDATE public.project_milestones milestone
SET weight = 5, sort_order = 60
FROM _pm_upgrade_projects upgrade
WHERE milestone.project_id = upgrade.project_id
  AND milestone.title = 'Presentation Boards';

-- Remove Client Approval from non-furniture workflows while retaining task history.
CREATE TEMP TABLE _pm_removed_client_milestones ON COMMIT DROP AS
SELECT milestone.id, milestone.project_id
FROM public.project_milestones milestone
JOIN _pm_upgrade_projects upgrade ON upgrade.project_id = milestone.project_id
WHERE milestone.title = 'Client Approval'
  AND coalesce(upgrade.project_type, '') NOT IN ('Furnishings', 'Commercial');

DELETE FROM public.shared_project_todos task
USING _pm_removed_client_milestones removed
WHERE task.milestone_id = removed.id
  AND task.source_type = 'template'
  AND task.status = 'suggested';

UPDATE public.shared_project_todos task
SET
  status = CASE WHEN task.source_type = 'template' THEN 'cancelled' ELSE task.status END,
  milestone_id = NULL,
  depends_on_todo_id = NULL
FROM _pm_removed_client_milestones removed
WHERE task.milestone_id = removed.id;

DELETE FROM public.project_milestones milestone
USING _pm_removed_client_milestones removed
WHERE milestone.id = removed.id;

UPDATE public.project_milestones milestone
SET weight = 10, sort_order = 70
FROM _pm_upgrade_projects upgrade
WHERE milestone.project_id = upgrade.project_id
  AND milestone.title = 'Client Approval'
  AND upgrade.project_type IN ('Furnishings', 'Commercial');

UPDATE public.project_milestones milestone
SET
  weight = 5,
  sort_order = CASE
    WHEN upgrade.project_type IN ('Furnishings', 'Commercial') THEN 80
    ELSE 70
  END
FROM _pm_upgrade_projects upgrade
WHERE milestone.project_id = upgrade.project_id
  AND milestone.title = 'Spec Book';

UPDATE public.project_milestones milestone
SET
  weight = 15,
  sort_order = CASE
    WHEN upgrade.project_type IN ('Furnishings', 'Commercial') THEN 90
    ELSE 80
  END
FROM _pm_upgrade_projects upgrade
WHERE milestone.project_id = upgrade.project_id
  AND milestone.title = 'Procurement';

-- Add Construction Docs between SketchUp and AI Renderings. If a downstream step was
-- already completed, treat Construction Docs as complete so existing progress is preserved.
INSERT INTO public.project_milestones (
  project_id,
  title,
  stage,
  status,
  target_date,
  completed_at,
  weight,
  owner_id,
  required_capability,
  is_critical,
  sort_order
)
SELECT
  upgrade.project_id,
  'Construction Docs Completed',
  'Design',
  CASE WHEN downstream.completed_at IS NOT NULL THEN 'complete' ELSE 'not_started' END,
  CASE
    WHEN sketchup.target_date IS NOT NULL AND rendering.target_date IS NOT NULL
      THEN sketchup.target_date + ((rendering.target_date - sketchup.target_date) / 2)
    ELSE coalesce(sketchup.target_date, rendering.target_date)
  END,
  downstream.completed_at,
  20,
  sketchup.owner_id,
  'layout',
  true,
  40
FROM _pm_upgrade_projects upgrade
LEFT JOIN LATERAL (
  SELECT milestone.*
  FROM public.project_milestones milestone
  WHERE milestone.project_id = upgrade.project_id
    AND milestone.title = 'Render and Draw SketchUp'
  LIMIT 1
) sketchup ON true
LEFT JOIN LATERAL (
  SELECT milestone.*
  FROM public.project_milestones milestone
  WHERE milestone.project_id = upgrade.project_id
    AND milestone.title = 'AI Renderings'
  LIMIT 1
) rendering ON true
LEFT JOIN LATERAL (
  SELECT max(milestone.completed_at) AS completed_at
  FROM public.project_milestones milestone
  WHERE milestone.project_id = upgrade.project_id
    AND milestone.title IN ('AI Renderings', 'Presentation Boards', 'Spec Book', 'Procurement')
    AND milestone.status = 'complete'
) downstream ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.project_milestones existing
  WHERE existing.project_id = upgrade.project_id
    AND existing.title = 'Construction Docs Completed'
);

INSERT INTO public.shared_project_todos (
  project_id,
  milestone_id,
  title,
  notes,
  due_date,
  status,
  priority,
  estimated_hours,
  required_capability,
  source_type,
  source_key,
  visibility,
  recommended_assignee_id
)
SELECT
  milestone.project_id,
  milestone.id,
  milestone.title,
  'Template task for Design. Review before assigning.',
  milestone.target_date,
  'suggested',
  'high',
  8,
  milestone.required_capability,
  'template',
  'template:construction-docs-completed',
  'internal',
  milestone.owner_id
FROM public.project_milestones milestone
JOIN _pm_upgrade_projects upgrade ON upgrade.project_id = milestone.project_id
WHERE milestone.title = 'Construction Docs Completed'
ON CONFLICT (project_id, source_key) DO NOTHING;

-- Keep generated suggestions aligned to the migrated dates without overwriting due dates
-- on tasks that a manager has already accepted or assigned.
UPDATE public.shared_project_todos task
SET due_date = milestone.target_date
FROM public.project_milestones milestone, _pm_upgrade_projects upgrade
WHERE task.milestone_id = milestone.id
  AND milestone.project_id = upgrade.project_id
  AND task.source_type = 'template'
  AND task.status = 'suggested';

-- Rebuild the milestone chain in the new order.
WITH ordered AS (
  SELECT
    milestone.id,
    lag(milestone.id) OVER (
      PARTITION BY milestone.project_id
      ORDER BY milestone.sort_order, milestone.created_at, milestone.id
    ) AS previous_id
  FROM public.project_milestones milestone
  JOIN _pm_upgrade_projects upgrade ON upgrade.project_id = milestone.project_id
)
INSERT INTO public.project_milestone_dependencies (milestone_id, depends_on_milestone_id)
SELECT ordered.id, ordered.previous_id
FROM ordered
WHERE ordered.previous_id IS NOT NULL;

-- Rebuild dependencies for the primary template task linked to each milestone.
UPDATE public.shared_project_todos task
SET depends_on_todo_id = NULL
FROM _pm_upgrade_projects upgrade
WHERE task.project_id = upgrade.project_id
  AND task.source_type = 'template';

WITH primary_tasks AS (
  SELECT DISTINCT ON (task.milestone_id)
    task.id,
    task.milestone_id,
    task.project_id
  FROM public.shared_project_todos task
  JOIN _pm_upgrade_projects upgrade ON upgrade.project_id = task.project_id
  WHERE task.source_type = 'template'
    AND task.milestone_id IS NOT NULL
    AND task.status <> 'cancelled'
  ORDER BY task.milestone_id, task.created_at, task.id
), ordered AS (
  SELECT
    primary_tasks.id,
    lag(primary_tasks.id) OVER (
      PARTITION BY primary_tasks.project_id
      ORDER BY milestone.sort_order, milestone.created_at, milestone.id
    ) AS previous_id
  FROM primary_tasks
  JOIN public.project_milestones milestone ON milestone.id = primary_tasks.milestone_id
)
UPDATE public.shared_project_todos task
SET depends_on_todo_id = ordered.previous_id
FROM ordered
WHERE task.id = ordered.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT upgrade.project_id
    FROM _pm_upgrade_projects upgrade
    JOIN public.project_milestones milestone ON milestone.project_id = upgrade.project_id
    GROUP BY upgrade.project_id
    HAVING sum(milestone.weight) <> 100
  ) THEN
    RAISE EXCEPTION 'A migrated project milestone plan does not total 100 percent';
  END IF;
END;
$$;

COMMIT;
