/* eslint-disable @typescript-eslint/no-explicit-any -- New Supabase schema is not in the generated client types yet. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canManageStudio, isStudioTeamRole } from "@/lib/permissions";
import {
  addDays,
  recommendAssignee,
  type ProjectManagementEmployee,
} from "@/lib/projectManagement";

const admin = supabaseAdmin as any;

const PROJECT_FIELDS = [
  "id",
  "name",
  "client_name",
  "project_type",
  "project_label",
  "status",
  "cover_image_url",
  "accepted_date",
  "turnaround_speed",
  "promised_completion_date",
  "forecast_completion_date",
  "progress_override",
  "health_override",
  "health_override_reason",
  "created_at",
  "updated_at",
].join(",");

const PROJECT_UPDATE_FIELDS = new Set([
  "accepted_date",
  "turnaround_speed",
  "promised_completion_date",
  "forecast_completion_date",
  "progress_override",
  "health_override",
  "health_override_reason",
]);

const TASK_UPDATE_FIELDS = new Set([
  "title",
  "notes",
  "internal_notes",
  "link_url",
  "assigned_user_id",
  "recommended_assignee_id",
  "milestone_id",
  "depends_on_todo_id",
  "due_date",
  "reminder_date",
  "priority",
  "status",
  "estimated_hours",
  "required_capability",
  "visibility",
  "waiting_on",
  "is_pinned",
  "rank_override",
]);

const MILESTONE_UPDATE_FIELDS = new Set([
  "title",
  "stage",
  "status",
  "target_date",
  "weight",
  "owner_id",
  "required_capability",
  "is_critical",
  "sort_order",
]);

type Access = { user: { id: string }; profile: any };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const text = cleanText(value);
  return text || null;
}

function cleanDate(value: unknown) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function missingCommandCenterSchema(error: any) {
  return error?.code === "42P01" || error?.code === "42703";
}

async function requireUser(request: Request): Promise<Access | { error: Response }> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { error: json({ error: "Sign in first." }, 401) };
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user)
    return { error: json({ error: "Your session is no longer valid." }, 401) };
  const { data: profile, error } = await admin
    .from("user_profiles")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error || !profile?.is_active)
    return { error: json({ error: "Your account is not active." }, 403) };
  return { user: { id: userData.user.id }, profile };
}

async function requireStudio(request: Request) {
  const access = await requireUser(request);
  if ("error" in access) return access;
  if (!isStudioTeamRole(access.profile.role)) {
    return { error: json({ error: "Project management is for MERAV employees." }, 403) };
  }
  return access;
}

async function managedProjectIds(access: Access) {
  if (access.profile.role === "Admin" || access.profile.can_view_all_projects !== false)
    return null;
  const [{ data: assignments }, { data: ownerships }] = await Promise.all([
    admin.from("user_project_assignments").select("project_id").eq("user_id", access.user.id),
    admin
      .from("project_management_owners" as any)
      .select("project_id")
      .eq("user_id", access.user.id),
  ]);
  return Array.from(
    new Set<string>([
      ...(assignments ?? []).map((row: any) => String(row.project_id)),
      ...(ownerships ?? []).map((row: any) => String(row.project_id)),
    ]),
  );
}

async function isProjectOwner(userId: string, projectId: string) {
  const { data } = await admin
    .from("project_management_owners" as any)
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function canManageProject(access: Access, projectId: string) {
  return canManageStudio(access.profile) || (await isProjectOwner(access.user.id, projectId));
}

async function loadCommandCenter(access: Access) {
  const allowedIds = await managedProjectIds(access);
  let projectQuery = admin
    .from("projects")
    .select(PROJECT_FIELDS)
    .neq("status", "Complete")
    .order("promised_completion_date", { ascending: true, nullsFirst: false });
  if (allowedIds) {
    if (!allowedIds.length) return emptyCommandCenter();
    projectQuery = projectQuery.in("id", allowedIds);
  }
  const { data: projects, error: projectError } = await projectQuery;
  if (projectError) throw projectError;
  const projectIds = (projects ?? []).map((project: any) => project.id);
  if (!projectIds.length) return { ...emptyCommandCenter(), projects: projects ?? [] };

  const [
    ownersResult,
    milestonesResult,
    tasksResult,
    peopleResult,
    profilesResult,
    timeEntriesResult,
  ] = await Promise.all([
    admin
      .from("project_management_owners" as any)
      .select("*, user:user_profiles(id,email,full_name,role)")
      .in("project_id", projectIds),
    admin
      .from("project_milestones" as any)
      .select("*")
      .in("project_id", projectIds)
      .order("sort_order"),
    admin
      .from("shared_project_todos" as any)
      .select("*")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false }),
    admin
      .from("user_profiles")
      .select("id,email,full_name,role,is_active")
      .eq("is_active", true)
      .order("full_name"),
    admin.from("employee_work_profiles" as any).select("*"),
    admin
      .from("employee_time_entries")
      .select("todo_id,user_id,hours,work_date")
      .in("project_id", projectIds),
  ]);
  for (const result of [
    ownersResult,
    milestonesResult,
    tasksResult,
    peopleResult,
    profilesResult,
    timeEntriesResult,
  ]) {
    if (result.error) throw result.error;
  }
  const milestoneIds = (milestonesResult.data ?? []).map((milestone: any) => milestone.id);
  const dependenciesResult = milestoneIds.length
    ? await admin
        .from("project_milestone_dependencies" as any)
        .select("*")
        .in("milestone_id", milestoneIds)
    : { data: [], error: null };
  if (dependenciesResult.error) throw dependenciesResult.error;

  const personById = new Map((peopleResult.data ?? []).map((person: any) => [person.id, person]));
  const actualHoursByTask = new Map<string, number>();
  for (const entry of timeEntriesResult.data ?? []) {
    if (!entry.todo_id) continue;
    actualHoursByTask.set(
      entry.todo_id,
      (actualHoursByTask.get(entry.todo_id) ?? 0) + Number(entry.hours || 0),
    );
  }
  const tasks = (tasksResult.data ?? []).map((task: any) => ({
    ...task,
    assigned_user: task.assigned_user_id ? (personById.get(task.assigned_user_id) ?? null) : null,
    recommended_assignee: task.recommended_assignee_id
      ? (personById.get(task.recommended_assignee_id) ?? null)
      : null,
    actual_hours: actualHoursByTask.get(task.id) ?? 0,
  }));
  const scheduledByEmployee = new Map<string, number>();
  for (const task of tasks) {
    if (!task.assigned_user_id || ["complete", "cancelled", "suggested"].includes(task.status))
      continue;
    scheduledByEmployee.set(
      task.assigned_user_id,
      (scheduledByEmployee.get(task.assigned_user_id) ?? 0) + Number(task.estimated_hours || 0),
    );
  }
  const profileByUser = new Map(
    (profilesResult.data ?? []).map((profile: any) => [profile.user_id, profile]),
  );
  const employees = (peopleResult.data ?? [])
    .filter((person: any) => ["Admin", "Employee"].includes(person.role))
    .map((employee: any) => ({
      ...employee,
      work_profile: profileByUser.get(employee.id) ?? null,
      scheduled_hours: scheduledByEmployee.get(employee.id) ?? 0,
    }));

  return {
    projects: projects ?? [],
    owners: ownersResult.data ?? [],
    milestones: milestonesResult.data ?? [],
    dependencies: dependenciesResult.data ?? [],
    tasks,
    employees,
    time_entries: timeEntriesResult.data ?? [],
  };
}

function emptyCommandCenter() {
  return {
    projects: [],
    owners: [],
    milestones: [],
    dependencies: [],
    tasks: [],
    employees: [],
    time_entries: [],
  };
}

async function setupProject(access: Access, body: any) {
  if (!canManageStudio(access.profile))
    return json({ error: "Only Ken and Katie can configure project commitments." }, 403);
  const projectId = cleanText(body.project_id);
  if (!projectId) return json({ error: "Choose a project." }, 400);
  const acceptedDate = cleanDate(body.accepted_date);
  const promisedDate = cleanDate(body.promised_completion_date);
  const forecastDate = cleanDate(body.forecast_completion_date);
  const speed = ["Standard", "Priority", "Rush", "Custom"].includes(body.turnaround_speed)
    ? body.turnaround_speed
    : null;
  const ownerIds = Array.isArray(body.owner_ids)
    ? body.owner_ids.map(cleanText).filter(Boolean)
    : [];

  const { data: project, error: projectError } = await admin
    .from("projects")
    .update({
      accepted_date: acceptedDate,
      turnaround_speed: speed,
      promised_completion_date: promisedDate,
      forecast_completion_date: forecastDate,
    } as any)
    .eq("id", projectId)
    .select("id,project_type")
    .single();
  if (projectError) throw projectError;

  await admin
    .from("project_management_owners" as any)
    .delete()
    .eq("project_id", projectId);
  if (ownerIds.length) {
    const { error } = await admin
      .from("project_management_owners" as any)
      .insert(ownerIds.map((userId: string) => ({ project_id: projectId, user_id: userId })));
    if (error) throw error;
  }

  const { count } = await admin
    .from("project_milestones" as any)
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (!count)
    await instantiateMilestones(
      projectId,
      project.project_type,
      acceptedDate,
      promisedDate,
      ownerIds,
    );
  return json({ ok: true });
}

async function instantiateMilestones(
  projectId: string,
  projectType: string,
  acceptedDate: string | null,
  promisedDate: string | null,
  ownerIds: string[],
) {
  const templateType = ["Kitchen", "Bathroom"].includes(projectType)
    ? "Kitchen"
    : ["Whole Home", "New Build"].includes(projectType)
      ? "Whole Home"
      : "Furnishings";
  const { data: template } = await admin
    .from("project_milestone_templates" as any)
    .select("id")
    .eq("project_type", templateType)
    .eq("is_default", true)
    .maybeSingle();
  if (!template) throw new Error("No milestone template is configured for this project type.");
  const { data: items, error } = await admin
    .from("project_milestone_template_items" as any)
    .select("*")
    .eq("template_id", template.id)
    .order("sort_order");
  if (error) throw error;
  const totalDays =
    acceptedDate && promisedDate ? Math.max(0, dayDifference(promisedDate, acceptedDate)) : 0;
  const rows = (items ?? []).map((item: any, index: number, all: any[]) => ({
    project_id: projectId,
    title: item.title,
    stage: item.stage,
    status: index === 0 ? "in_progress" : "not_started",
    target_date:
      acceptedDate && promisedDate
        ? addDays(acceptedDate, Math.round(totalDays * ((index + 1) / all.length)))
        : null,
    weight: item.default_weight,
    owner_id: ownerIds[0] ?? null,
    required_capability: item.required_capability,
    is_critical: item.is_critical,
    sort_order: item.sort_order,
  }));
  const { data: milestones, error: milestoneError } = await admin
    .from("project_milestones" as any)
    .insert(rows)
    .select("*");
  if (milestoneError) throw milestoneError;
  const dependencyRows = (milestones ?? []).slice(1).map((milestone: any, index: number) => ({
    milestone_id: milestone.id,
    depends_on_milestone_id: milestones![index].id,
  }));
  if (dependencyRows.length)
    await admin.from("project_milestone_dependencies" as any).insert(dependencyRows);

  const employees = await loadEmployeesForRecommendation(projectId);
  const ownerSet = new Set(ownerIds);
  const tasks = (milestones ?? []).map((milestone: any) => {
    const recommendation = recommendAssignee(milestone.required_capability, employees, ownerSet);
    return {
      project_id: projectId,
      milestone_id: milestone.id,
      title: milestone.title,
      notes: `Template task for ${milestone.stage}. Review before assigning.`,
      due_date: milestone.target_date,
      status: "suggested",
      priority: milestone.is_critical ? "high" : "normal",
      estimated_hours: defaultEstimate(milestone.required_capability),
      required_capability: milestone.required_capability,
      source_type: "template",
      source_key: `template:${milestone.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      visibility: "internal",
      recommended_assignee_id: recommendation?.id ?? null,
      recommended_by: null,
    };
  });
  if (tasks.length) {
    const { data: createdTasks, error: taskError } = await admin
      .from("shared_project_todos" as any)
      .upsert(tasks, { onConflict: "project_id,source_key", ignoreDuplicates: true })
      .select("id,milestone_id");
    if (taskError) throw taskError;
    const taskByMilestone = new Map(
      (createdTasks ?? []).map((task: any) => [task.milestone_id, task.id]),
    );
    for (let index = 1; index < (milestones ?? []).length; index += 1) {
      const taskId = taskByMilestone.get(milestones![index].id);
      const prerequisiteId = taskByMilestone.get(milestones![index - 1].id);
      if (taskId && prerequisiteId) {
        const { error: dependencyError } = await admin
          .from("shared_project_todos" as any)
          .update({ depends_on_todo_id: prerequisiteId })
          .eq("id", taskId);
        if (dependencyError) throw dependencyError;
      }
    }
  }
}

async function createTask(access: Access, body: any) {
  const projectId = cleanText(body.project_id);
  if (!projectId || !cleanText(body.title))
    return json({ error: "Project and task title are required." }, 400);
  if (!(await canManageProject(access, projectId)) && !canManageStudio(access.profile)) {
    return json({ error: "Only a project owner can add tasks." }, 403);
  }
  const assignedUserId = nullableText(body.assigned_user_id);
  const visibility = body.visibility === "assigned_external" ? "assigned_external" : "internal";
  const waitingOn = nullableText(body.waiting_on);
  if (visibility === "assigned_external" && !assignedUserId)
    return json({ error: "Choose the outside person for this request." }, 400);
  let recommendedAssigneeId: string | null = null;
  if (!assignedUserId && visibility === "internal") {
    const [{ data: owners }, employees] = await Promise.all([
      admin
        .from("project_management_owners" as any)
        .select("user_id")
        .eq("project_id", projectId),
      loadEmployeesForRecommendation(projectId),
    ]);
    recommendedAssigneeId =
      recommendAssignee(
        nullableText(body.required_capability),
        employees,
        new Set((owners ?? []).map((owner: any) => owner.user_id)),
      )?.id ?? null;
  }
  const { data, error } = await admin
    .from("shared_project_todos" as any)
    .insert({
      project_id: projectId,
      assigned_user_id: assignedUserId,
      recommended_assignee_id: recommendedAssigneeId,
      recommended_by: recommendedAssigneeId ? access.user.id : null,
      title: cleanText(body.title),
      notes: nullableText(body.notes),
      internal_notes: nullableText(body.internal_notes),
      link_url: nullableText(body.link_url),
      due_date: cleanDate(body.due_date),
      reminder_date: cleanDate(body.reminder_date),
      priority: ["low", "normal", "high"].includes(body.priority) ? body.priority : "normal",
      status: waitingOn ? "waiting" : assignedUserId ? "ready" : "open",
      estimated_hours: numericOrNull(body.estimated_hours),
      required_capability: nullableText(body.required_capability),
      milestone_id: nullableText(body.milestone_id),
      depends_on_todo_id: nullableText(body.depends_on_todo_id),
      visibility,
      waiting_on: waitingOn,
      is_pinned: Boolean(body.is_pinned),
      created_by: access.user.id,
    })
    .select("*")
    .single();
  if (error) throw error;
  return json({ task: data });
}

async function createMilestone(access: Access, body: any) {
  const projectId = cleanText(body.project_id);
  if (!projectId || !cleanText(body.title))
    return json({ error: "Project and milestone title are required." }, 400);
  if (!(await canManageProject(access, projectId)))
    return json({ error: "Only a project owner can add milestones." }, 403);
  const { data: last } = await admin
    .from("project_milestones" as any)
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await admin
    .from("project_milestones" as any)
    .insert({
      project_id: projectId,
      title: cleanText(body.title),
      stage: cleanText(body.stage) || "Design",
      status: "not_started",
      target_date: cleanDate(body.target_date),
      weight: Math.max(0, Number(body.weight || 0)),
      owner_id: nullableText(body.owner_id),
      required_capability: nullableText(body.required_capability),
      is_critical: Boolean(body.is_critical),
      is_custom: true,
      sort_order: Number(last?.sort_order || 0) + 10,
    })
    .select("*")
    .single();
  if (error) throw error;
  const dependencyId = nullableText(body.depends_on_milestone_id);
  if (dependencyId) {
    const { error: dependencyError } = await admin
      .from("project_milestone_dependencies" as any)
      .insert({
        milestone_id: data.id,
        depends_on_milestone_id: dependencyId,
      });
    if (dependencyError) throw dependencyError;
  }
  return json({ milestone: data });
}

async function suggestTasks(access: Access, body: any) {
  if (!canManageStudio(access.profile))
    return json({ error: "Only Ken and Katie can generate task suggestions." }, 403);
  const projectId = cleanText(body.project_id);
  if (!projectId) return json({ error: "Choose a project." }, 400);
  const suggestions = await collectStudioSignals(projectId);
  const employees = await loadEmployeesForRecommendation(projectId);
  const { data: owners } = await admin
    .from("project_management_owners" as any)
    .select("user_id")
    .eq("project_id", projectId);
  const ownerIds = new Set<string>((owners ?? []).map((owner: any) => String(owner.user_id)));
  const rows = suggestions.map((suggestion) => ({
    project_id: projectId,
    title: suggestion.title,
    notes: suggestion.notes,
    priority: suggestion.priority,
    status: "suggested",
    estimated_hours: suggestion.estimatedHours,
    required_capability: suggestion.capability,
    source_type: "studio_signal",
    source_key: suggestion.sourceKey,
    visibility: "internal",
    recommended_assignee_id:
      recommendAssignee(suggestion.capability, employees, ownerIds)?.id ?? null,
    recommended_by: access.user.id,
    created_by: access.user.id,
  }));
  if (!rows.length) return json({ created: 0 });
  const { data, error } = await admin
    .from("shared_project_todos" as any)
    .upsert(rows, { onConflict: "project_id,source_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return json({ created: data?.length ?? 0 });
}

async function updateProject(access: Access, body: any) {
  const projectId = cleanText(body.project_id);
  if (!projectId || !(await canManageProject(access, projectId)))
    return json({ error: "Only a project owner can update this plan." }, 403);
  const patch = pickFields(body.patch, PROJECT_UPDATE_FIELDS);
  if ("progress_override" in patch)
    patch.progress_override = numericOrNull(patch.progress_override);
  if (
    "health_override" in patch &&
    patch.health_override &&
    !nullableText(patch.health_override_reason)
  ) {
    return json({ error: "Add a reason for the health override." }, 400);
  }
  const { error } = await admin
    .from("projects")
    .update(patch as any)
    .eq("id", projectId);
  if (error) throw error;
  return json({ ok: true });
}

async function updateTask(access: Access, body: any) {
  const taskId = cleanText(body.id);
  const { data: task, error: loadError } = await admin
    .from("shared_project_todos" as any)
    .select("project_id,status,assigned_user_id")
    .eq("id", taskId)
    .maybeSingle();
  if (loadError || !task) return json({ error: "Task not found." }, 404);
  const managesProject = await canManageProject(access, task.project_id);
  const isAssignee = task.assigned_user_id === access.user.id;
  if (!managesProject && !isAssignee)
    return json({ error: "Only the assignee or a project owner can update this task." }, 403);
  const patch = pickFields(
    body.patch,
    managesProject ? TASK_UPDATE_FIELDS : new Set(["status", "waiting_on", "notes", "link_url"]),
  );
  if (patch.status === "complete") patch.completed_at = new Date().toISOString();
  if (task.status === "suggested" && patch.status === "ready" && !patch.assigned_user_id) {
    const { data: fullTask } = await admin
      .from("shared_project_todos" as any)
      .select("recommended_assignee_id")
      .eq("id", taskId)
      .single();
    patch.assigned_user_id = fullTask?.recommended_assignee_id ?? null;
  }
  const { error } = await admin
    .from("shared_project_todos" as any)
    .update(patch)
    .eq("id", taskId);
  if (error) throw error;
  return json({ ok: true });
}

async function updateMilestone(access: Access, body: any) {
  const id = cleanText(body.id);
  const { data: milestone } = await admin
    .from("project_milestones" as any)
    .select("project_id")
    .eq("id", id)
    .maybeSingle();
  if (!milestone || !(await canManageProject(access, milestone.project_id)))
    return json({ error: "Only a project owner can update this milestone." }, 403);
  const patch = pickFields(body.patch, MILESTONE_UPDATE_FIELDS);
  if (patch.status === "complete") patch.completed_at = new Date().toISOString();
  if (patch.status && patch.status !== "complete") patch.completed_at = null;
  const { error } = await admin
    .from("project_milestones" as any)
    .update(patch)
    .eq("id", id);
  if (error) throw error;
  return json({ ok: true });
}

async function updateWorkProfile(access: Access, body: any) {
  if (!canManageStudio(access.profile))
    return json({ error: "Only Ken and Katie can update employee capacity." }, 403);
  const userId = cleanText(body.user_id);
  const capacity = Math.max(0, Math.min(168, Number(body.weekly_capacity_hours || 0)));
  const tags = Array.isArray(body.capability_tags)
    ? body.capability_tags.map(cleanText).filter(Boolean)
    : [];
  const { error } = await admin.from("employee_work_profiles" as any).upsert({
    user_id: userId,
    weekly_capacity_hours: capacity,
    capability_tags: tags,
    unavailable_until: cleanDate(body.unavailable_until),
  });
  if (error) throw error;
  return json({ ok: true });
}

async function addMessage(access: Access, body: any) {
  const todoId = cleanText(body.todo_id);
  const message = cleanText(body.message);
  if (!todoId || !message) return json({ error: "Write a message first." }, 400);
  const { data: task } = await admin
    .from("shared_project_todos" as any)
    .select("project_id,assigned_user_id")
    .eq("id", todoId)
    .maybeSingle();
  if (
    !task ||
    (!(await canManageProject(access, task.project_id)) && task.assigned_user_id !== access.user.id)
  )
    return json({ error: "You cannot add a message to this task." }, 403);
  const { error } = await admin.from("project_todo_messages" as any).insert({
    todo_id: todoId,
    author_id: access.user.id,
    body: message,
    visibility: body.visibility === "internal" ? "internal" : "shared",
  });
  if (error) throw error;
  return json({ ok: true });
}

async function loadEmployeesForRecommendation(
  projectId: string,
): Promise<ProjectManagementEmployee[]> {
  const [{ data: users }, { data: profiles }, { data: tasks }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("id,email,full_name,role,is_active")
      .eq("is_active", true)
      .in("role", ["Admin", "Employee"]),
    admin.from("employee_work_profiles" as any).select("*"),
    admin
      .from("shared_project_todos" as any)
      .select("assigned_user_id,estimated_hours,status")
      .eq("project_id", projectId),
  ]);
  const profileById = new Map((profiles ?? []).map((profile: any) => [profile.user_id, profile]));
  const loadById = new Map<string, number>();
  for (const task of tasks ?? []) {
    if (!task.assigned_user_id || ["complete", "cancelled", "suggested"].includes(task.status))
      continue;
    loadById.set(
      task.assigned_user_id,
      (loadById.get(task.assigned_user_id) ?? 0) + Number(task.estimated_hours || 0),
    );
  }
  return (users ?? []).map((user: any) => ({
    ...user,
    work_profile: profileById.get(user.id) ?? null,
    scheduled_hours: loadById.get(user.id) ?? 0,
  }));
}

async function collectStudioSignals(projectId: string) {
  const { data: rooms } = await admin.from("rooms").select("id").eq("project_id", projectId);
  const roomIds = (rooms ?? []).map((room: any) => room.id);
  const suggestions: Array<{
    sourceKey: string;
    title: string;
    notes: string;
    capability: string;
    priority: "normal" | "high";
    estimatedHours: number;
  }> = [];
  if (!roomIds.length)
    suggestions.push(
      signal(
        "rooms-missing",
        "Create project rooms",
        "This project does not have any rooms yet.",
        "project setup",
        "high",
        1,
      ),
    );

  const [{ data: board }, { data: materials }, { data: roomProducts }, { data: images }] =
    await Promise.all([
      admin
        .from("design_boards" as any)
        .select("board_state")
        .eq("project_id", projectId)
        .maybeSingle(),
      admin
        .from("material_items" as any)
        .select("id,item_label,product_url,product_id,scrape_status,not_needed")
        .eq("project_id", projectId)
        .eq("not_needed", false),
      roomIds.length
        ? admin.from("room_products").select("id,product_id,approval_status").in("room_id", roomIds)
        : Promise.resolve({ data: [] as any[] }),
      roomIds.length
        ? admin
            .from("room_images")
            .select("id,kind,status,review_status,is_approved")
            .in("room_id", roomIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

  const boardIssues = inspectBoardState((board as any)?.board_state);
  if (boardIssues.labels + boardIssues.links + boardIssues.rooms > 0) {
    suggestions.push(
      signal(
        "design-board-missing-information",
        "Complete design-board product information",
        `${boardIssues.labels} missing labels, ${boardIssues.links} missing links, and ${boardIssues.rooms} items without rooms need review.`,
        "design boards",
        "high",
        Math.max(1, Math.ceil((boardIssues.labels + boardIssues.links + boardIssues.rooms) / 8)),
      ),
    );
  }
  const declined = (roomProducts ?? []).filter(
    (item: any) => item.approval_status === "declined",
  ).length;
  if (declined)
    suggestions.push(
      signal(
        "declined-selections",
        "Replace declined selections",
        `${declined} selections need re-selection.`,
        "design boards",
        "high",
        Math.max(1, declined * 0.5),
      ),
    );
  const activeMaterials = materials ?? [];
  const catalogProductIds = Array.from(
    new Set(activeMaterials.map((item: any) => item.product_id).filter(Boolean)),
  );
  const { data: catalogProducts } = catalogProductIds.length
    ? await admin
        .from("products")
        .select("id,price,sku,vendor,finish,dimensions")
        .in("id", catalogProductIds)
    : { data: [] as any[] };
  const productById = new Map<string, any>(
    (catalogProducts ?? []).map((product: any) => [String(product.id), product]),
  );
  const missingLinks = activeMaterials.filter((item: any) => !item.product_url).length;
  if (missingLinks)
    suggestions.push(
      signal(
        "materials-missing-links",
        "Complete missing material links",
        `${missingLinks} active material items do not have product links.`,
        "materials and specs",
        "normal",
        Math.max(1, missingLinks * 0.2),
      ),
    );
  const pendingScrape = activeMaterials.filter(
    (item: any) => item.product_url && item.scrape_status !== "scraped",
  ).length;
  if (pendingScrape)
    suggestions.push(
      signal(
        "materials-pending-scrape",
        "Scrape remaining product details",
        `${pendingScrape} linked materials still need product details or pricing.`,
        "materials and specs",
        "normal",
        Math.max(1, pendingScrape * 0.1),
      ),
    );
  const missingPrices = activeMaterials.filter(
    (item: any) => item.product_id && !cleanText(productById.get(item.product_id)?.price),
  ).length;
  if (missingPrices)
    suggestions.push(
      signal(
        "materials-missing-pricing",
        "Complete missing product pricing",
        `${missingPrices} active material selections are linked to catalog products without pricing.`,
        "materials and specs",
        "high",
        Math.max(1, missingPrices * 0.15),
      ),
    );
  const missingSpecifications = activeMaterials.filter((item: any) => {
    const product = item.product_id ? productById.get(item.product_id) : null;
    return (
      product &&
      !cleanText(product.sku) &&
      !cleanText(product.vendor) &&
      !cleanText(product.finish) &&
      !cleanText(product.dimensions)
    );
  }).length;
  if (missingSpecifications)
    suggestions.push(
      signal(
        "materials-missing-specifications",
        "Complete missing product specifications",
        `${missingSpecifications} catalog-linked selections are missing vendor, SKU, finish, and dimensions.`,
        "materials and specs",
        "normal",
        Math.max(1, missingSpecifications * 0.2),
      ),
    );
  const undecided = (roomProducts ?? []).filter(
    (item: any) => item.approval_status === "undecided",
  ).length;
  if (undecided)
    suggestions.push(
      signal(
        "approvals-pending",
        "Move pending selections through approval",
        `${undecided} room selections are still undecided.`,
        "client coordination",
        "normal",
        Math.max(1, undecided * 0.1),
      ),
    );
  const approvedIds = (roomProducts ?? [])
    .filter((item: any) => item.approval_status === "approved")
    .map((item: any) => item.id);
  const { data: procurementRows } = approvedIds.length
    ? await admin
        .from("procurement_items")
        .select("room_product_id,ordered")
        .in("room_product_id", approvedIds)
    : { data: [] as any[] };
  const orderedIds = new Set(
    (procurementRows ?? [])
      .filter((item: any) => item.ordered)
      .map((item: any) => item.room_product_id),
  );
  const procurementReady = approvedIds.filter((id: string) => !orderedIds.has(id)).length;
  if (procurementReady)
    suggestions.push(
      signal(
        "procurement-approved-not-ordered",
        "Review approved selections for procurement",
        `${procurementReady} approved selections have not been marked ordered.`,
        "procurement",
        "normal",
        Math.max(1, procurementReady * 0.15),
      ),
    );
  const sketchups = (images ?? []).filter((image: any) => image.kind === "sketchup").length;
  const approvedRenderings = (images ?? []).filter(
    (image: any) =>
      image.kind === "rendering" &&
      image.status === "complete" &&
      (image.is_approved || image.review_status === "approved"),
  ).length;
  if (sketchups > approvedRenderings)
    suggestions.push(
      signal(
        "renderings-incomplete",
        "Complete approved AI renderings",
        `${sketchups - approvedRenderings} SketchUp views do not yet have an approved rendering.`,
        "renderings",
        "normal",
        Math.max(1, (sketchups - approvedRenderings) * 0.5),
      ),
    );
  return suggestions;
}

function inspectBoardState(value: any) {
  const counts = { labels: 0, links: 0, rooms: 0 };
  const pages = Array.isArray(value?.pages) ? value.pages : [];
  for (const page of pages) {
    if (page?.hidden || page?.isHidden) continue;
    const elements = Array.isArray(page?.elements) ? page.elements : [];
    for (const element of elements) {
      if (
        element?.type !== "image" ||
        element?.excludeFromMaterials ||
        element?.includeInMaterials === false
      )
        continue;
      if (!cleanText(element.label || element.productName)) counts.labels += 1;
      if (!cleanText(element.link || element.productUrl)) counts.links += 1;
      if (!cleanText(element.roomId || page.roomId || element.room)) counts.rooms += 1;
    }
  }
  return counts;
}

function signal(
  sourceKey: string,
  title: string,
  notes: string,
  capability: string,
  priority: "normal" | "high",
  estimatedHours: number,
) {
  return { sourceKey, title, notes, capability, priority, estimatedHours };
}

function defaultEstimate(capability: string | null) {
  if (capability === "design boards") return 8;
  if (capability === "materials and specs") return 4;
  if (capability === "procurement") return 4;
  return 2;
}

function pickFields(source: any, allowed: Set<string>) {
  return Object.fromEntries(Object.entries(source ?? {}).filter(([key]) => allowed.has(key)));
}

function numericOrNull(value: unknown) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dayDifference(later: string, earlier: string) {
  return Math.round(
    (new Date(`${later}T12:00:00`).getTime() - new Date(`${earlier}T12:00:00`).getTime()) /
      86_400_000,
  );
}

export const Route = createFileRoute("/api/project-management")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireStudio(request);
          if ("error" in access) return access.error;
          return json(await loadCommandCenter(access));
        } catch (error: any) {
          if (missingCommandCenterSchema(error))
            return json({ ...emptyCommandCenter(), setupNeeded: true });
          console.error("Load project command center failed", error);
          return json({ error: error?.message || "Unable to load project management." }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const access = await requireStudio(request);
          if ("error" in access) return access.error;
          const body = await request.json();
          if (body.action === "setup_project") return await setupProject(access, body);
          if (body.action === "create_task") return await createTask(access, body);
          if (body.action === "create_milestone") return await createMilestone(access, body);
          if (body.action === "suggest_tasks") return await suggestTasks(access, body);
          if (body.action === "message") return await addMessage(access, body);
          return json({ error: "Unknown project-management action." }, 400);
        } catch (error: any) {
          console.error("Project command center action failed", error);
          return json({ error: error?.message || "Unable to save project management." }, 500);
        }
      },
      PATCH: async ({ request }) => {
        try {
          const access = await requireStudio(request);
          if ("error" in access) return access.error;
          const body = await request.json();
          if (body.action === "project") return await updateProject(access, body);
          if (body.action === "task") return await updateTask(access, body);
          if (body.action === "milestone") return await updateMilestone(access, body);
          if (body.action === "work_profile") return await updateWorkProfile(access, body);
          return json({ error: "Unknown project-management update." }, 400);
        } catch (error: any) {
          console.error("Project command center update failed", error);
          return json({ error: error?.message || "Unable to update project management." }, 500);
        }
      },
    },
  },
});
