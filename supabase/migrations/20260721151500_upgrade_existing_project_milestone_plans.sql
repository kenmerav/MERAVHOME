BEGIN;

-- Project management has not been put into active use yet, so rebuild generated
-- plans from the current templates instead of migrating the original plans in place.
-- Manual/shared to-dos and all non-project-management project data are preserved.
DELETE FROM public.shared_project_todos
WHERE source_type IN ('template', 'studio_signal');

DELETE FROM public.project_milestones;

WITH plan_rows AS (
  SELECT
    project.id AS project_id,
    project.accepted_date,
    project.promised_completion_date,
    owner.user_id AS owner_id,
    item.title,
    item.stage,
    item.default_weight,
    item.required_capability,
    item.is_critical,
    item.sort_order,
    row_number() OVER (
      PARTITION BY project.id
      ORDER BY item.sort_order, item.id
    ) AS step_number,
    count(*) OVER (PARTITION BY project.id) AS step_count
  FROM public.projects project
  JOIN public.project_milestone_templates template
    ON template.is_default = true
   AND template.project_type = CASE
     WHEN project.project_type::text IN ('Kitchen', 'Bathroom') THEN 'Kitchen'
     WHEN project.project_type::text IN ('Whole Home', 'New Build') THEN 'Whole Home'
     WHEN project.project_type::text IN ('Furnishings', 'Commercial') THEN 'Furnishings'
     ELSE 'Whole Home'
   END
  JOIN public.project_milestone_template_items item ON item.template_id = template.id
  LEFT JOIN LATERAL (
    SELECT management_owner.user_id
    FROM public.project_management_owners management_owner
    WHERE management_owner.project_id = project.id
    ORDER BY management_owner.created_at, management_owner.user_id
    LIMIT 1
  ) owner ON true
)
INSERT INTO public.project_milestones (
  project_id,
  title,
  stage,
  status,
  target_date,
  weight,
  owner_id,
  required_capability,
  is_critical,
  sort_order
)
SELECT
  plan.project_id,
  plan.title,
  plan.stage,
  CASE WHEN plan.step_number = 1 THEN 'in_progress' ELSE 'not_started' END,
  CASE
    WHEN plan.accepted_date IS NOT NULL AND plan.promised_completion_date IS NOT NULL
      THEN plan.accepted_date + round(
        greatest(0, plan.promised_completion_date - plan.accepted_date)::numeric
        * plan.step_number
        / plan.step_count
      )::integer
    ELSE NULL
  END,
  plan.default_weight,
  plan.owner_id,
  plan.required_capability,
  plan.is_critical,
  plan.sort_order
FROM plan_rows plan;

WITH ordered_milestones AS (
  SELECT
    milestone.id,
    lag(milestone.id) OVER (
      PARTITION BY milestone.project_id
      ORDER BY milestone.sort_order, milestone.created_at, milestone.id
    ) AS previous_id
  FROM public.project_milestones milestone
)
INSERT INTO public.project_milestone_dependencies (
  milestone_id,
  depends_on_milestone_id
)
SELECT ordered.id, ordered.previous_id
FROM ordered_milestones ordered
WHERE ordered.previous_id IS NOT NULL;

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
  'Template task for ' || milestone.stage || '. Review before assigning.',
  milestone.target_date,
  'suggested',
  CASE WHEN milestone.is_critical THEN 'high' ELSE 'normal' END,
  CASE
    WHEN milestone.required_capability = 'design boards' THEN 8
    WHEN milestone.required_capability IN ('materials and specs', 'procurement') THEN 4
    ELSE 2
  END,
  milestone.required_capability,
  'template',
  'template:' || trim(both '-' FROM regexp_replace(lower(milestone.title), '[^a-z0-9]+', '-', 'g')),
  'internal',
  milestone.owner_id
FROM public.project_milestones milestone;

WITH primary_tasks AS (
  SELECT task.id, task.milestone_id, task.project_id
  FROM public.shared_project_todos task
  WHERE task.source_type = 'template'
), ordered_tasks AS (
  SELECT
    task.id,
    lag(task.id) OVER (
      PARTITION BY task.project_id
      ORDER BY milestone.sort_order, milestone.created_at, milestone.id
    ) AS previous_id
  FROM primary_tasks task
  JOIN public.project_milestones milestone ON milestone.id = task.milestone_id
)
UPDATE public.shared_project_todos task
SET depends_on_todo_id = ordered.previous_id
FROM ordered_tasks ordered
WHERE task.id = ordered.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT milestone.project_id
    FROM public.project_milestones milestone
    GROUP BY milestone.project_id
    HAVING sum(milestone.weight) <> 100
  ) THEN
    RAISE EXCEPTION 'A rebuilt project milestone plan does not total 100 percent';
  END IF;
END;
$$;

COMMIT;
