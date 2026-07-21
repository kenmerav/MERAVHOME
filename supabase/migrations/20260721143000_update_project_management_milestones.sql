-- Keep the construction-oriented command-center workflow aligned with MERAV's process.
DELETE FROM public.project_milestone_template_items item
USING public.project_milestone_templates template
WHERE item.template_id = template.id
  AND template.project_type IN ('Kitchen', 'Whole Home', 'Furnishings');

INSERT INTO public.project_milestone_template_items
  (template_id, title, stage, default_weight, required_capability, is_critical, sort_order)
SELECT template.id, item.title, item.stage, item.weight, item.capability, item.critical, item.sort_order
FROM public.project_milestone_templates template
CROSS JOIN (VALUES
  ('Create Project & Rooms', 'Design', 5::numeric, 'project setup', true, 10),
  ('Design Selections', 'Design', 20::numeric, 'design boards', true, 20),
  ('Render and Draw SketchUp', 'Design', 20::numeric, 'sketchup', true, 30),
  ('Construction Docs Completed', 'Design', 20::numeric, 'layout', true, 40),
  ('AI Renderings', 'Presentation', 10::numeric, 'renderings', false, 50),
  ('Presentation Boards', 'Presentation', 5::numeric, 'presentations', true, 60),
  ('Spec Book', 'Approved', 5::numeric, 'materials and specs', true, 70),
  ('Procurement', 'Procurement', 15::numeric, 'procurement', true, 80)
) AS item(title, stage, weight, capability, critical, sort_order)
WHERE template.project_type IN ('Kitchen', 'Whole Home');

-- Furnishings and Commercial projects retain the client-approval milestone.
INSERT INTO public.project_milestone_template_items
  (template_id, title, stage, default_weight, required_capability, is_critical, sort_order)
SELECT template.id, item.title, item.stage, item.weight, item.capability, item.critical, item.sort_order
FROM public.project_milestone_templates template
CROSS JOIN (VALUES
  ('Create Project & Rooms', 'Design', 5::numeric, 'project setup', true, 10),
  ('Design Selections', 'Design', 10::numeric, 'design boards', true, 20),
  ('Render and Draw SketchUp', 'Design', 20::numeric, 'sketchup', true, 30),
  ('Construction Docs Completed', 'Design', 20::numeric, 'layout', true, 40),
  ('AI Renderings', 'Presentation', 10::numeric, 'renderings', false, 50),
  ('Presentation Boards', 'Presentation', 5::numeric, 'presentations', true, 60),
  ('Client Approval', 'Approved', 10::numeric, 'client coordination', true, 70),
  ('Spec Book', 'Approved', 5::numeric, 'materials and specs', true, 80),
  ('Procurement', 'Procurement', 15::numeric, 'procurement', true, 90)
) AS item(title, stage, weight, capability, critical, sort_order)
WHERE template.project_type = 'Furnishings';
