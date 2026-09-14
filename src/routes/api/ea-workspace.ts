/* eslint-disable @typescript-eslint/no-explicit-any -- EA schema remains server-only until types regenerate. */
import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canManageStudio, canUseEaWorkspace } from "@/lib/permissions";
import {
  cleanSafeImportRows,
  EA_VENDOR_SHEET_ID,
  EA_VENDOR_SHEET_TAB_ID,
  normalizeList,
} from "@/lib/eaWorkspace";
import { calculateEaProjectHealth, type EaProjectActivity } from "@/lib/eaProjectHealth";
import { runEaOperatingReview } from "@/lib/eaOperator.server";
import {
  findEaTaskAnswer,
  linkSource,
  MARVIN_SHARED_GMAIL,
  prepareEaTaskDraft,
  refreshPendingSourceMatches,
  saveEaOperatingMemory,
  syncEaEmailActions,
  syncFathom,
  syncSharedGmail,
} from "@/lib/marvin.server";

const admin = supabaseAdmin as any;

type Access = { user: { id: string }; profile: any };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalText(value: unknown, max = 2000) {
  return text(value, max) || null;
}

function date(value: unknown) {
  const clean = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null;
}

function id(value: unknown) {
  const clean = text(value, 80);
  return /^[0-9a-f-]{36}$/i.test(clean) ? clean : null;
}

function choice<T extends string>(value: unknown, values: readonly T[], fallback: T) {
  const clean = text(value, 80) as T;
  return values.includes(clean) ? clean : fallback;
}

function missingSchema(error: any) {
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205"
  );
}

async function requireEaAccess(request: Request): Promise<Access | { error: Response }> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { error: json({ error: "Sign in first." }, 401) };
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Your session expired." }, 401) };
  const { data: profile, error } = await admin
    .from("user_profiles")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error || !canUseEaWorkspace(profile)) {
    return {
      error: json({ error: "EA Desk is available only to Ken, Katie, and Brynn." }, 403),
    };
  }
  return { user: { id: userData.user.id }, profile };
}

async function allowedProjectIds(access: Access) {
  if (canManageStudio(access.profile) || access.profile.can_view_all_projects !== false)
    return null;
  const { data } = await admin
    .from("user_project_assignments")
    .select("project_id")
    .eq("user_id", access.user.id);
  return (data ?? []).map((row: any) => String(row.project_id));
}

async function ensureProjectAccess(access: Access, projectId: string) {
  const allowed = await allowedProjectIds(access);
  return allowed === null || allowed.includes(projectId);
}

async function loadWorkspace(access: Access) {
  const allowed = await allowedProjectIds(access);
  let projectQuery = admin
    .from("projects")
    .select(
      "id,name,client_name,status,project_type,cover_image_url,created_at,updated_at,accepted_date,promised_completion_date,forecast_completion_date,health_override,health_override_reason",
    )
    .order("name");
  if (allowed) {
    if (!allowed.length) return emptyWorkspace();
    projectQuery = projectQuery.in("id", allowed);
  }
  const { data: projects, error: projectError } = await projectQuery;
  if (projectError) throw projectError;
  const projectIds = (projects ?? []).map((project: any) => project.id);

  const [contacts, vendors, profiles, imports, memoryRules] = await Promise.all([
    admin.from("ea_directory_contacts").select("*").order("name"),
    admin
      .from("ea_vendor_profiles")
      .select(
        "*,primary_sales_contact:ea_directory_contacts!ea_vendor_profiles_primary_sales_contact_id_fkey(*),service_contact:ea_directory_contacts!ea_vendor_profiles_service_contact_id_fkey(*)",
      )
      .order("supplier_company"),
    admin
      .from("user_profiles")
      .select("id,email,full_name,role,is_active")
      .eq("is_active", true)
      .order("full_name"),
    admin.from("ea_directory_import_rows").select("*").order("source_row_number").limit(500),
    admin
      .from("marvin_sources")
      .select("id,title,body_text,occurred_at")
      .eq("external_provider", "ea_memory")
      .eq("review_status", "linked")
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(100),
  ]);
  if (profiles.error) throw profiles.error;
  for (const result of [contacts, vendors, imports, memoryRules]) {
    if (result.error && !missingSchema(result.error)) throw result.error;
  }
  let setupNeeded = [contacts, vendors, imports].some((result) => missingSchema(result.error));

  if (!projectIds.length) {
    return {
      ...emptyWorkspace(),
      projects: projects ?? [],
      contacts: contacts.error ? [] : (contacts.data ?? []),
      vendors: vendors.error ? [] : (vendors.data ?? []),
      profiles: profiles.data ?? [],
      importRows: imports.error ? [] : (imports.data ?? []),
      memoryRules: memoryRules.error ? [] : (memoryRules.data ?? []),
      setupNeeded,
      canManageAccess: canManageStudio(access.profile),
      canReviewApprovals:
        String(access.profile.email || "").toLowerCase() === "katie@meravinteriors.com",
      viewer: {
        id: access.user.id,
        email: access.profile.email,
        full_name: access.profile.full_name,
      },
    };
  }

  const eaTasksQuery = admin
    .from("shared_project_todos")
    .select("*")
    .or(`project_id.in.(${projectIds.join(",")}),project_id.is.null`)
    .in("source_type", ["ea_email", "ea_manual", "ea_agent"])
    .neq("status", "cancelled")
    .order("due_date", { ascending: true, nullsFirst: false });
  const taskContextsQuery = admin
    .from("ea_task_contexts")
    .select(
      "*,todo:shared_project_todos!inner(project_id),relevant_contact:ea_directory_contacts!ea_task_contexts_relevant_contact_id_fkey(id,name,company,email,phone),waiting_contact:ea_directory_contacts!ea_task_contexts_waiting_contact_id_fkey(id,name,company,email,phone)",
    )
    .limit(1000);

  const [
    operations,
    assignments,
    tasks,
    milestones,
    taskContexts,
    integrations,
    sourceLinks,
    pendingFathom,
    allProjectTasks,
    managementOwners,
    activitySources,
  ] = await Promise.all([
    admin.from("ea_project_operations").select("*").in("project_id", projectIds),
    admin
      .from("ea_project_contact_assignments")
      .select(
        "*,contact:ea_directory_contacts!ea_project_contact_assignments_contact_id_fkey(*),copy_contact:ea_directory_contacts!ea_project_contact_assignments_copy_contact_id_fkey(*),backup_contact:ea_directory_contacts!ea_project_contact_assignments_backup_contact_id_fkey(*)",
      )
      .in("project_id", projectIds),
    eaTasksQuery,
    admin
      .from("project_milestones")
      .select("id,project_id,title,stage,status,target_date,is_critical,sort_order")
      .in("project_id", projectIds)
      .order("sort_order"),
    taskContextsQuery,
    admin
      .from("marvin_integrations")
      .select("provider,account_email,status,last_sync_at,last_error,updated_at,metadata"),
    admin
      .from("marvin_source_projects")
      .select("source_id,project_id,project:projects(id,name,client_name,status)")
      .in("project_id", projectIds)
      .limit(300),
    admin
      .from("marvin_sources")
      .select(
        "id,title,occurred_at,source_url,suggested_project_id,match_confidence,match_reason,metadata",
      )
      .eq("source_type", "fathom")
      .eq("review_status", "pending")
      .gte("occurred_at", new Date(Date.now() - 45 * 86400000).toISOString())
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(20),
    admin
      .from("shared_project_todos")
      .select(
        "id,project_id,title,status,priority,due_date,waiting_on,assigned_user_id,source_type,created_at,updated_at,completed_at",
      )
      .in("project_id", projectIds)
      .order("due_date", { ascending: true, nullsFirst: false }),
    admin
      .from("project_management_owners")
      .select("project_id,user_id")
      .in("project_id", projectIds),
    admin
      .from("marvin_sources")
      .select(
        "id,source_type,title,occurred_at,source_url,metadata,marvin_source_projects(project_id)",
      )
      .in("source_type", ["email", "fathom"])
      .gte("occurred_at", new Date(Date.now() - 120 * 86400000).toISOString())
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(1000),
  ]);
  for (const result of [tasks, milestones, allProjectTasks]) if (result.error) throw result.error;
  for (const result of [operations, assignments, taskContexts]) {
    if (result.error && !missingSchema(result.error)) throw result.error;
  }
  setupNeeded ||= [operations, assignments, taskContexts].some((result) =>
    missingSchema(result.error),
  );

  const emailSourceIds = Array.from(
    new Set((sourceLinks.error ? [] : (sourceLinks.data ?? [])).map((link: any) => link.source_id)),
  );
  const emailSources = emailSourceIds.length
    ? await admin
        .from("marvin_sources")
        .select(
          "id,title,summary,author_name,author_email,occurred_at,source_url,processing_status",
        )
        .in("id", emailSourceIds)
        .eq("source_type", "email")
        .contains("metadata", { account_email: MARVIN_SHARED_GMAIL })
        .eq("review_status", "linked")
        .eq("knowledge_scope", "project")
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .limit(50)
    : { data: [], error: null };
  if (emailSources.error && !missingSchema(emailSources.error)) throw emailSources.error;

  const projectsBySource = new Map<string, any[]>();
  for (const link of sourceLinks.error ? [] : (sourceLinks.data ?? [])) {
    const list = projectsBySource.get(link.source_id) ?? [];
    if (link.project) list.push(link.project);
    projectsBySource.set(link.source_id, list);
  }

  const projectIdSet = new Set(projectIds);
  const contextByTodo = new Map(
    (taskContexts.data ?? [])
      .filter(
        (context: any) =>
          context.todo?.project_id == null || projectIdSet.has(context.todo.project_id),
      )
      .map((context: any) => [context.todo_id, context]),
  );
  const projectById = new Map((projects ?? []).map((project: any) => [project.id, project]));
  const profileById = new Map((profiles.data ?? []).map((profile: any) => [profile.id, profile]));
  const operationsByProject = new Map(
    (operations.error ? [] : (operations.data ?? [])).map((operation: any) => [
      operation.project_id,
      operation,
    ]),
  );
  const projectTasksForHealth = (allProjectTasks.data ?? []).filter(
    (task: any) => task.source_type !== "ea_fathom",
  );
  const allTasksByProject = new Map<string, any[]>();
  for (const task of projectTasksForHealth) {
    allTasksByProject.set(task.project_id, [
      ...(allTasksByProject.get(task.project_id) ?? []),
      task,
    ]);
  }
  const milestonesByProject = new Map<string, any[]>();
  for (const milestone of milestones.data ?? []) {
    milestonesByProject.set(milestone.project_id, [
      ...(milestonesByProject.get(milestone.project_id) ?? []),
      milestone,
    ]);
  }
  const ownerCountByProject = new Map<string, number>();
  for (const owner of managementOwners.error ? [] : (managementOwners.data ?? [])) {
    ownerCountByProject.set(owner.project_id, (ownerCountByProject.get(owner.project_id) ?? 0) + 1);
  }
  const activitiesByProject = new Map<string, EaProjectActivity[]>();
  const addActivity = (projectId: string, activity: EaProjectActivity) => {
    activitiesByProject.set(projectId, [...(activitiesByProject.get(projectId) ?? []), activity]);
  };
  for (const source of activitySources.error ? [] : (activitySources.data ?? [])) {
    if (!source.occurred_at) continue;
    if (
      source.source_type === "email" &&
      String(source.metadata?.account_email || "").toLowerCase() !== MARVIN_SHARED_GMAIL
    ) {
      continue;
    }
    for (const link of source.marvin_source_projects ?? []) {
      if (!projectById.has(link.project_id)) continue;
      addActivity(link.project_id, {
        id: source.id,
        kind: source.source_type === "fathom" ? "fathom" : "email",
        title: source.title || (source.source_type === "fathom" ? "Fathom meeting" : "Email"),
        occurred_at: source.occurred_at,
        source_url: source.source_url ?? null,
      });
    }
  }
  for (const task of projectTasksForHealth) {
    addActivity(task.project_id, {
      id: task.id,
      kind: "task",
      title: task.title,
      occurred_at: task.completed_at || task.updated_at || task.created_at,
      source_url: null,
    });
  }
  const projectHealth = (projects ?? []).map((project: any) => {
    const operation = operationsByProject.get(project.id) ?? null;
    return calculateEaProjectHealth({
      project,
      operation,
      tasks: allTasksByProject.get(project.id) ?? [],
      milestones: milestonesByProject.get(project.id) ?? [],
      activities: activitiesByProject.get(project.id) ?? [],
      ownerCount: ownerCountByProject.get(project.id) ?? 0,
      reviewedAt: operation?.last_reviewed_at ?? null,
    });
  });
  const fathomReview = (pendingFathom.error ? [] : (pendingFathom.data ?? []))
    .map((source: any) => ({
      id: source.id,
      title: source.title,
      occurred_at: source.occurred_at,
      source_url: source.source_url,
      suggested_project_id: source.suggested_project_id,
      match_confidence: source.match_confidence,
      match_reason: source.match_reason,
    }))
    .slice(0, 5);

  return {
    projects: projects ?? [],
    operations: operations.error ? [] : (operations.data ?? []),
    assignments: assignments.error ? [] : (assignments.data ?? []),
    contacts: contacts.error ? [] : (contacts.data ?? []),
    vendors: vendors.error ? [] : (vendors.data ?? []),
    tasks: (tasks.data ?? [])
      .filter((task: any) => {
        if (task.project_id == null) return true;
        const project = projectById.get(task.project_id);
        return !/(^|\s)(test|demo)(\s|$)/i.test(String(project?.name || ""));
      })
      .map((task: any) => ({
        ...task,
        project: projectById.get(task.project_id) ?? null,
        assigned_user: profileById.get(task.assigned_user_id) ?? null,
        recommended_assignee: profileById.get(task.recommended_assignee_id) ?? null,
        ...(!taskContexts.error ? (contextByTodo.get(task.id) ?? {}) : {}),
      })),
    milestones: milestones.data ?? [],
    profiles: profiles.data ?? [],
    importRows: imports.error ? [] : (imports.data ?? []),
    memoryRules: memoryRules.error ? [] : (memoryRules.data ?? []),
    syncStatus: integrations.error ? [] : (integrations.data ?? []),
    fathomReview,
    emails: (emailSources.data ?? []).map((source: any) => ({
      ...source,
      projects: projectsBySource.get(source.id) ?? [],
    })),
    projectHealth,
    setupNeeded,
    canManageAccess: canManageStudio(access.profile),
    canReviewApprovals:
      String(access.profile.email || "").toLowerCase() === "katie@meravinteriors.com",
    viewer: {
      id: access.user.id,
      email: access.profile.email,
      full_name: access.profile.full_name,
    },
  };
}

function emptyWorkspace() {
  return {
    projects: [],
    operations: [],
    assignments: [],
    contacts: [],
    vendors: [],
    tasks: [],
    milestones: [],
    profiles: [],
    importRows: [],
    memoryRules: [],
    syncStatus: [],
    fathomReview: [],
    emails: [],
    projectHealth: [],
    canManageAccess: false,
    canReviewApprovals: false,
    viewer: null,
  };
}

async function saveContact(access: Access, body: any) {
  const contactId = id(body.id);
  const name = text(body.name, 160);
  if (!name) return json({ error: "Contact name is required." }, 400);
  const verificationStatus = choice(
    body.verification_status,
    ["verified", "needs_verification", "archived"] as const,
    "needs_verification",
  );
  const payload: any = {
    contact_kind: choice(
      body.contact_kind,
      ["merav_team", "client", "builder_trade_consultant", "vendor_rep", "partner"] as const,
      "partner",
    ),
    name,
    company: optionalText(body.company, 160),
    general_role: optionalText(body.general_role, 240),
    email: optionalText(body.email, 240)?.toLowerCase() ?? null,
    phone: optionalText(body.phone, 80),
    preferred_communication: optionalText(body.preferred_communication, 120),
    internal_notes: optionalText(body.internal_notes),
    verification_status: verificationStatus,
    source_type: optionalText(body.source_type, 80) ?? "manual",
    source_reference: optionalText(body.source_reference, 500),
    ...(verificationStatus === "verified"
      ? { last_verified_at: new Date().toISOString(), verified_by: access.user.id }
      : {}),
  };
  const query = contactId
    ? admin.from("ea_directory_contacts").update(payload).eq("id", contactId)
    : admin.from("ea_directory_contacts").insert({ ...payload, created_by: access.user.id });
  const { data, error } = await query.select("*").single();
  if (error)
    return json(
      {
        error: error.code === "23505" ? "A contact with this email already exists." : error.message,
      },
      400,
    );
  return json({ contact: data });
}

async function saveVendor(access: Access, body: any) {
  const vendorId = id(body.id);
  const supplier = text(body.supplier_company, 160);
  if (!supplier) return json({ error: "Supplier company is required." }, 400);
  const routeStatus = choice(
    body.purchasing_route_status,
    ["confirmed", "confirm_route", "needs_verification", "archived"] as const,
    "needs_verification",
  );
  const payload = {
    supplier_company: supplier,
    brand_or_manufacturer: optionalText(body.brand_or_manufacturer, 160),
    primary_sales_contact_id: id(body.primary_sales_contact_id),
    service_contact_id: id(body.service_contact_id),
    ordering_method: optionalText(body.ordering_method, 500),
    categories: normalizeList(body.categories),
    brands_supplied: normalizeList(body.brands_supplied),
    purchasing_instructions: optionalText(body.purchasing_instructions),
    purchasing_route_status: routeStatus,
    contact_verification_status: choice(
      body.contact_verification_status,
      ["verified", "needs_verification", "archived"] as const,
      "needs_verification",
    ),
    source_type: optionalText(body.source_type, 80) ?? "manual",
    source_reference: optionalText(body.source_reference, 500),
    ...(routeStatus === "confirmed"
      ? { last_verified_at: new Date().toISOString(), verified_by: access.user.id }
      : {}),
  };
  const query = vendorId
    ? admin.from("ea_vendor_profiles").update(payload).eq("id", vendorId)
    : admin.from("ea_vendor_profiles").insert({ ...payload, created_by: access.user.id });
  const { data, error } = await query.select("*").single();
  if (error)
    return json(
      { error: error.code === "23505" ? "This supplier already exists." : error.message },
      400,
    );
  return json({ vendor: data });
}

async function saveAssignment(access: Access, body: any) {
  const projectId = id(body.project_id);
  const contactId = id(body.contact_id);
  const role = text(body.role_on_project, 160);
  if (!projectId || !contactId || !role)
    return json({ error: "Project, contact, and project role are required." }, 400);
  if (!(await ensureProjectAccess(access, projectId)))
    return json({ error: "Project access denied." }, 403);
  const verification = choice(
    body.verification_status,
    ["verified", "needs_verification", "archived"] as const,
    "needs_verification",
  );
  const payload = {
    project_id: projectId,
    contact_id: contactId,
    role_on_project: role,
    responsibilities: optionalText(body.responsibilities),
    ask_them_about: optionalText(body.ask_them_about),
    preferred_communication: optionalText(body.preferred_communication, 120),
    copy_contact_id: id(body.copy_contact_id),
    backup_contact_id: id(body.backup_contact_id),
    verification_status: verification,
    source_type: optionalText(body.source_type, 80) ?? "manual",
    source_reference: optionalText(body.source_reference, 500),
    ...(verification === "verified"
      ? { last_verified_at: new Date().toISOString(), verified_by: access.user.id }
      : {}),
    created_by: access.user.id,
  };
  const { data, error } = await admin
    .from("ea_project_contact_assignments")
    .upsert(payload, { onConflict: "project_id,contact_id,role_on_project" })
    .select("*")
    .single();
  if (error) return json({ error: error.message }, 400);
  return json({ assignment: data });
}

async function saveOperations(access: Access, body: any) {
  const projectId = id(body.project_id);
  if (!projectId) return json({ error: "Project is required." }, 400);
  if (!(await ensureProjectAccess(access, projectId)))
    return json({ error: "Project access denied." }, 403);
  const payload = {
    project_id: projectId,
    lifecycle_status: choice(
      body.lifecycle_status,
      ["active", "on_hold", "completed"] as const,
      "active",
    ),
    phase: optionalText(body.phase, 160),
    aliases: normalizeList(body.aliases),
    next_milestone: optionalText(body.next_milestone, 300),
    current_blocker: optionalText(body.current_blocker),
    waiting_party: optionalText(body.waiting_party, 240),
    next_action: optionalText(body.next_action),
    responsible_user_id: id(body.responsible_user_id),
    responsible_contact_id: id(body.responsible_contact_id),
    follow_up_date: date(body.follow_up_date),
    last_reviewed_at: new Date().toISOString(),
    reviewed_by: access.user.id,
  };
  const { data, error } = await admin
    .from("ea_project_operations")
    .upsert(payload, { onConflict: "project_id" })
    .select("*")
    .single();
  if (error) return json({ error: error.message }, 400);
  return json({ operations: data });
}

async function saveTask(access: Access, body: any) {
  const taskId = id(body.id);
  if (!taskId) return json({ error: "Task is required." }, 400);
  const currentTask = await admin
    .from("shared_project_todos")
    .select("id,project_id")
    .eq("id", taskId)
    .maybeSingle();
  if (currentTask.error) return json({ error: currentTask.error.message }, 400);
  if (!currentTask.data) return json({ error: "Task not found." }, 404);
  const projectId = currentTask.data.project_id as string | null;
  if (projectId && !(await ensureProjectAccess(access, projectId)))
    return json({ error: "Project access denied." }, 403);
  if (
    ["approved", "changes_requested"].includes(String(body.approval_status || "")) &&
    String(access.profile.email || "").toLowerCase() !== "katie@meravinteriors.com"
  ) {
    return json({ error: "Only Katie can record an approval decision." }, 403);
  }
  const contextFields = [
    "relevant_contact_id",
    "waiting_contact_id",
    "ea_next_action",
    "next_follow_up_date",
    "completion_evidence",
    "acknowledged",
    "work_artifact_kind",
    "work_artifact_text",
    "approval_status",
  ];
  const shouldSaveContext = contextFields.some((field) => field in body);
  const updates: any = {};
  if ("relevant_contact_id" in body) updates.relevant_contact_id = id(body.relevant_contact_id);
  if ("waiting_contact_id" in body) updates.waiting_contact_id = id(body.waiting_contact_id);
  if ("ea_next_action" in body) updates.ea_next_action = optionalText(body.ea_next_action);
  if ("next_follow_up_date" in body) updates.next_follow_up_date = date(body.next_follow_up_date);
  if ("completion_evidence" in body)
    updates.completion_evidence = optionalText(body.completion_evidence);
  if ("work_artifact_kind" in body)
    updates.work_artifact_kind = choice(
      body.work_artifact_kind,
      ["work_note", "email_draft", "action_plan"] as const,
      "work_note",
    );
  if ("work_artifact_text" in body)
    updates.work_artifact_text = optionalText(body.work_artifact_text, 20_000);
  if ("approval_status" in body) {
    updates.approval_status = choice(
      body.approval_status,
      ["draft", "pending", "approved", "changes_requested"] as const,
      "draft",
    );
    if (updates.approval_status === "pending") {
      updates.approval_requested_at = new Date().toISOString();
      updates.approval_reviewed_at = null;
      updates.approval_reviewed_by = null;
    } else if (["approved", "changes_requested"].includes(updates.approval_status)) {
      updates.approval_reviewed_at = new Date().toISOString();
      updates.approval_reviewed_by = access.user.id;
    }
  }
  if (body.acknowledged === true) updates.acknowledged_at = new Date().toISOString();
  if (body.acknowledged === false) updates.acknowledged_at = null;
  let context = null;
  if (shouldSaveContext) {
    const saved = await admin
      .from("ea_task_contexts")
      .upsert({ todo_id: taskId, ...updates }, { onConflict: "todo_id" })
      .select("*")
      .single();
    if (saved.error && !missingSchema(saved.error)) {
      return json({ error: saved.error.message }, 400);
    }
    context = saved.error ? null : saved.data;
  }

  const taskUpdates: any = {};
  if ("assigned_user_id" in body) taskUpdates.assigned_user_id = id(body.assigned_user_id);
  if ("status" in body) {
    taskUpdates.status = choice(
      body.status,
      ["suggested", "open", "ready", "in_progress", "waiting", "blocked", "cancelled"] as const,
      "open",
    );
  }
  if (body.mark_complete === true) {
    taskUpdates.status = "complete";
    taskUpdates.completed_at = new Date().toISOString();
  }
  if (Object.keys(taskUpdates).length) {
    const savedTask = await admin.from("shared_project_todos").update(taskUpdates).eq("id", taskId);
    if (savedTask.error) return json({ error: savedTask.error.message }, 400);
  }
  return json({ task: context, ok: true });
}

async function deleteApproval(access: Access, body: any) {
  const taskId = id(body.id);
  if (!taskId) return json({ error: "Task is required." }, 400);
  const currentTask = await admin
    .from("shared_project_todos")
    .select("id,project_id")
    .eq("id", taskId)
    .maybeSingle();
  if (currentTask.error) return json({ error: currentTask.error.message }, 400);
  if (!currentTask.data) return json({ error: "Task not found." }, 404);
  const projectId = currentTask.data.project_id as string | null;
  if (projectId && !(await ensureProjectAccess(access, projectId))) {
    return json({ error: "Project access denied." }, 403);
  }

  const removed = await admin
    .from("ea_task_contexts")
    .update({
      work_artifact_kind: null,
      work_artifact_text: null,
      approval_status: "draft",
      approval_requested_at: null,
      approval_reviewed_at: null,
      approval_reviewed_by: null,
    })
    .eq("todo_id", taskId);
  if (removed.error) return json({ error: removed.error.message }, 400);
  return json({ ok: true });
}

async function addTask(access: Access, body: any) {
  const projectId = id(body.project_id);
  const title = text(body.title, 300);
  const assignedUserId = id(body.assigned_user_id);
  if (!projectId || !title) return json({ error: "Project and item are required." }, 400);
  if (!(await ensureProjectAccess(access, projectId)))
    return json({ error: "Project access denied." }, 403);
  if (assignedUserId) {
    const owner = await admin
      .from("user_profiles")
      .select("id,email,full_name,is_active")
      .eq("id", assignedUserId)
      .eq("is_active", true)
      .maybeSingle();
    const firstName = String(owner.data?.full_name || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    const emailName = String(owner.data?.email || "")
      .split("@")[0]
      .toLowerCase();
    if (
      owner.error ||
      !owner.data ||
      (!["katie", "brynn", "ken"].includes(firstName) &&
        !["katie", "brynn", "ken"].includes(emailName))
    ) {
      return json({ error: "Choose Katie, Brynn, or Ken as the owner." }, 400);
    }
  }
  const saved = await admin
    .from("shared_project_todos")
    .insert({
      project_id: projectId,
      assigned_user_id: assignedUserId,
      title,
      notes: optionalText(body.notes, 2000),
      due_date: date(body.due_date),
      priority: "normal",
      status: assignedUserId ? "ready" : "open",
      visibility: "internal",
      source_type: "ea_manual",
      created_by: access.user.id,
    })
    .select("*")
    .single();
  if (saved.error) return json({ error: saved.error.message }, 400);
  return json({ task: saved.data });
}

async function reviewProject(access: Access, body: any) {
  const projectId = id(body.project_id);
  if (!projectId) return json({ error: "Project is required." }, 400);
  if (!(await ensureProjectAccess(access, projectId)))
    return json({ error: "Project access denied." }, 403);
  const payload: Record<string, unknown> = {
    project_id: projectId,
    last_reviewed_at: new Date().toISOString(),
    reviewed_by: access.user.id,
  };
  const existing = await admin
    .from("ea_project_operations")
    .select("project_id")
    .eq("project_id", projectId)
    .maybeSingle();
  if (existing.error) return json({ error: existing.error.message }, 400);
  if (!existing.data) {
    const project = await admin.from("projects").select("status").eq("id", projectId).maybeSingle();
    if (project.error) return json({ error: project.error.message }, 400);
    const status = String(project.data?.status || "").toLowerCase();
    payload.lifecycle_status =
      status === "complete" ? "completed" : status.includes("hold") ? "on_hold" : "active";
  }
  if ("lifecycle_status" in body) {
    payload.lifecycle_status = choice(
      body.lifecycle_status,
      ["active", "on_hold", "completed"] as const,
      "active",
    );
  }
  if ("follow_up_date" in body) payload.follow_up_date = date(body.follow_up_date);
  const { data, error } = await admin
    .from("ea_project_operations")
    .upsert(payload, { onConflict: "project_id" })
    .select("*")
    .single();
  if (error) return json({ error: error.message }, 400);
  return json({ operations: data });
}

async function updateProjectMilestone(access: Access, body: any) {
  const projectId = id(body.project_id);
  const milestoneId = id(body.id);
  if (!projectId || !milestoneId)
    return json({ error: "Project and milestone are required." }, 400);
  if (!(await ensureProjectAccess(access, projectId)))
    return json({ error: "Project access denied." }, 403);
  const updates: Record<string, unknown> = {};
  if ("status" in body) {
    updates.status = choice(
      body.status,
      ["not_started", "in_progress", "blocked", "complete", "skipped"] as const,
      "not_started",
    );
    updates.completed_at = updates.status === "complete" ? new Date().toISOString() : null;
  }
  if ("target_date" in body) updates.target_date = date(body.target_date);
  if (!Object.keys(updates).length) return json({ error: "No milestone change provided." }, 400);
  const { data, error } = await admin
    .from("project_milestones")
    .update(updates)
    .eq("id", milestoneId)
    .eq("project_id", projectId)
    .select("id,project_id,title,stage,status,target_date,is_critical,sort_order")
    .maybeSingle();
  if (error) return json({ error: error.message }, 400);
  if (!data) return json({ error: "Milestone not found." }, 404);
  return json({ milestone: data });
}

async function findTaskAnswer(access: Access, body: any) {
  const taskId = id(body.id);
  const projectId = id(body.project_id);
  if (!taskId || !projectId) return json({ error: "Task and project are required." }, 400);
  if (!(await ensureProjectAccess(access, projectId)))
    return json({ error: "Project access denied." }, 403);
  return json({ answer: await findEaTaskAnswer(taskId, projectId) });
}

async function prepareTaskDraft(access: Access, body: any) {
  const taskId = id(body.id);
  if (!taskId) return json({ error: "Task is required." }, 400);
  const currentTask = await admin
    .from("shared_project_todos")
    .select("id,project_id")
    .eq("id", taskId)
    .maybeSingle();
  if (currentTask.error) return json({ error: currentTask.error.message }, 400);
  if (!currentTask.data) return json({ error: "Task not found." }, 404);
  const projectId = currentTask.data.project_id as string | null;
  if (projectId && !(await ensureProjectAccess(access, projectId))) {
    return json({ error: "Project access denied." }, 403);
  }
  return json({ draft: await prepareEaTaskDraft(taskId, projectId, true) });
}

async function labelFathomProject(access: Access, body: any) {
  const sourceId = id(body.id);
  const projectId = id(body.project_id);
  if (!sourceId || !projectId) return json({ error: "Transcript and project are required." }, 400);
  if (!(await ensureProjectAccess(access, projectId)))
    return json({ error: "Project access denied." }, 403);
  const source = await admin
    .from("marvin_sources")
    .select("id,source_type")
    .eq("id", sourceId)
    .eq("source_type", "fathom")
    .maybeSingle();
  if (source.error) return json({ error: source.error.message }, 400);
  if (!source.data) return json({ error: "Fathom transcript not found." }, 404);
  await linkSource(access, sourceId, [projectId]);
  return json({ ok: true });
}

async function assignSuggestedOwners(access: Access) {
  const allowed = await allowedProjectIds(access);
  const ownerProfiles = await admin
    .from("user_profiles")
    .select("id,email,full_name")
    .eq("is_active", true);
  if (ownerProfiles.error) return json({ error: ownerProfiles.error.message }, 400);
  const permittedOwnerIds = (ownerProfiles.data ?? [])
    .filter((profile: any) => {
      const firstName = String(profile.full_name || "")
        .trim()
        .split(/\s+/)[0]
        .toLowerCase();
      const emailName = String(profile.email || "")
        .split("@")[0]
        .toLowerCase();
      return (
        ["katie", "brynn", "ken"].includes(firstName) ||
        ["katie", "brynn", "ken"].includes(emailName)
      );
    })
    .map((profile: any) => profile.id);
  if (!permittedOwnerIds.length) return json({ updated: 0 });
  let query = admin
    .from("shared_project_todos")
    .select("id,project_id,recommended_assignee_id")
    .eq("source_type", "ea_email")
    .is("assigned_user_id", null)
    .not("recommended_assignee_id", "is", null)
    .in("recommended_assignee_id", permittedOwnerIds)
    .not("status", "in", "(complete,cancelled)");
  if (allowed) {
    if (!allowed.length) return json({ updated: 0 });
    query = query.in("project_id", allowed);
  }
  const { data, error } = await query.limit(200);
  if (error) return json({ error: error.message }, 400);
  let updated = 0;
  for (const task of data ?? []) {
    const result = await admin
      .from("shared_project_todos")
      .update({ assigned_user_id: task.recommended_assignee_id })
      .eq("id", task.id)
      .is("assigned_user_id", null);
    if (!result.error) updated += 1;
  }
  return json({ updated });
}

async function refreshEmailActions(access: Access) {
  const [gmail, fathom] = await Promise.all([syncSharedGmail(), syncFathom()]);
  const sourceMatches = await refreshPendingSourceMatches();
  const emailActions = await syncEaEmailActions();
  const operatingReview = await runEaOperatingReview(access.user.id);
  return json({ gmail, fathom, sourceMatches, emailActions, operatingReview });
}

async function saveMemoryRule(access: Access, body: any) {
  const title = text(body.title, 200);
  const rule = text(body.rule, 5000);
  if (!title || !rule) return json({ error: "A title and operating rule are required." }, 400);
  const memory = await saveEaOperatingMemory({ title, rule, createdBy: access.user.id });
  return json({ memory });
}

async function previewImport(access: Access, body: any) {
  const rows = cleanSafeImportRows(body.rows);
  if (!rows.length) return json({ error: "No safe vendor rows were found." }, 400);
  const [existingVendors, existingContacts] = await Promise.all([
    admin.from("ea_vendor_profiles").select("id,supplier_company"),
    admin.from("ea_directory_contacts").select("id,email").not("email", "is", null),
  ]);
  if (existingVendors.error || existingContacts.error)
    return json({ error: "Unable to compare imported rows." }, 500);
  const vendors = new Map(
    (existingVendors.data ?? []).map((row: any) => [row.supplier_company.toLowerCase(), row.id]),
  );
  const contacts = new Map(
    (existingContacts.data ?? []).map((row: any) => [row.email.toLowerCase(), row.id]),
  );
  const seenVendors = new Set<string>();
  const payload = rows.map((row) => {
    const fingerprint = createHash("sha256")
      .update([row.vendor, row.category, row.rep_name, row.rep_email].join("|").toLowerCase())
      .digest("hex");
    const matchedVendorId = vendors.get(row.vendor.toLowerCase()) ?? null;
    const matchedContactId = row.rep_email ? (contacts.get(row.rep_email) ?? null) : null;
    const vendorKey = row.vendor.toLowerCase();
    const conflict = Boolean(matchedVendorId || matchedContactId || seenVendors.has(vendorKey));
    seenVendors.add(vendorKey);
    return {
      source_document_id: EA_VENDOR_SHEET_ID,
      source_sheet_id: EA_VENDOR_SHEET_TAB_ID,
      source_row_number: row.source_row_number,
      source_fingerprint: fingerprint,
      safe_payload: row,
      review_status: conflict ? "conflict" : "needs_review",
      review_notes: conflict
        ? "Possible existing supplier or contact. Review before approval."
        : null,
      matched_vendor_id: matchedVendorId,
      matched_contact_id: matchedContactId,
    };
  });
  const { data, error } = await admin
    .from("ea_directory_import_rows")
    .upsert(payload, {
      onConflict: "source_document_id,source_sheet_id,source_row_number",
      ignoreDuplicates: false,
    })
    .select("*");
  if (error) return json({ error: error.message }, 400);
  return json({
    importRows: data,
    safeFieldCount: 4,
    excludedFields: ["account login", "password", "notes", "discount"],
  });
}

async function reviewImport(access: Access, body: any) {
  const importId = id(body.id);
  const decision = choice(body.decision, ["approved", "skipped"] as const, "skipped");
  if (!importId) return json({ error: "Import row is required." }, 400);
  const { data: row, error } = await admin
    .from("ea_directory_import_rows")
    .select("*")
    .eq("id", importId)
    .single();
  if (error || !row) return json({ error: "Import row was not found." }, 404);
  if (decision === "skipped") {
    await admin
      .from("ea_directory_import_rows")
      .update({
        review_status: "skipped",
        reviewed_by: access.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", importId);
    return json({ ok: true });
  }

  const safe = cleanSafeImportRows([row.safe_payload])[0];
  if (!safe) return json({ error: "The safe import payload is invalid." }, 400);
  let contactId = row.matched_contact_id;
  if (!contactId && safe.rep_name) {
    const { data: contact, error: contactError } = await admin
      .from("ea_directory_contacts")
      .insert({
        contact_kind: "vendor_rep",
        name: safe.rep_name,
        company: safe.vendor,
        email: safe.rep_email,
        verification_status: "needs_verification",
        source_type: "google_sheet_review",
        source_reference: `Vendor Directory row ${safe.source_row_number}`,
        created_by: access.user.id,
      })
      .select("id")
      .single();
    if (contactError && contactError.code !== "23505")
      return json({ error: contactError.message }, 400);
    contactId = contact?.id ?? null;
    if (!contactId && safe.rep_email) {
      const existing = await admin
        .from("ea_directory_contacts")
        .select("id")
        .ilike("email", safe.rep_email)
        .maybeSingle();
      contactId = existing.data?.id ?? null;
    }
  }

  let vendorId = row.matched_vendor_id;
  if (!vendorId) {
    const { data: vendor, error: vendorError } = await admin
      .from("ea_vendor_profiles")
      .insert({
        supplier_company: safe.vendor,
        primary_sales_contact_id: contactId,
        categories: safe.category ? [safe.category] : [],
        purchasing_route_status: "needs_verification",
        contact_verification_status: "needs_verification",
        source_type: "google_sheet_review",
        source_reference: `Vendor Directory row ${safe.source_row_number}`,
        created_by: access.user.id,
      })
      .select("id")
      .single();
    if (vendorError && vendorError.code !== "23505")
      return json({ error: vendorError.message }, 400);
    vendorId = vendor?.id ?? null;
    if (!vendorId) {
      const existing = await admin
        .from("ea_vendor_profiles")
        .select("id")
        .ilike("supplier_company", safe.vendor)
        .maybeSingle();
      vendorId = existing.data?.id ?? null;
    }
  }
  await admin
    .from("ea_directory_import_rows")
    .update({
      review_status: "approved",
      matched_vendor_id: vendorId,
      matched_contact_id: contactId,
      reviewed_by: access.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", importId);
  return json({ ok: true, vendorId, contactId });
}

export const Route = createFileRoute("/api/ea-workspace")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await requireEaAccess(request);
        if ("error" in access) return access.error;
        try {
          return json(await loadWorkspace(access));
        } catch (error: any) {
          if (missingSchema(error)) return json({ ...emptyWorkspace(), setupNeeded: true });
          console.error("EA workspace load failed", error?.message);
          return json({ error: "Unable to load EA Desk." }, 500);
        }
      },
      POST: async ({ request }) => {
        const access = await requireEaAccess(request);
        if ("error" in access) return access.error;
        try {
          const body = await request.json();
          if (body.action === "save_contact") return saveContact(access, body);
          if (body.action === "save_vendor") return saveVendor(access, body);
          if (body.action === "save_assignment") return saveAssignment(access, body);
          if (body.action === "save_operations") return saveOperations(access, body);
          if (body.action === "save_task") return saveTask(access, body);
          if (body.action === "delete_approval") return deleteApproval(access, body);
          if (body.action === "add_task") return addTask(access, body);
          if (body.action === "review_project") return reviewProject(access, body);
          if (body.action === "update_milestone") return updateProjectMilestone(access, body);
          if (body.action === "find_task_answer") return findTaskAnswer(access, body);
          if (body.action === "prepare_task_draft") return prepareTaskDraft(access, body);
          if (body.action === "label_fathom_project") return labelFathomProject(access, body);
          if (body.action === "assign_suggested_owners") return assignSuggestedOwners(access);
          if (body.action === "refresh_email_actions") return refreshEmailActions(access);
          if (body.action === "run_operating_review") {
            return json({ operatingReview: await runEaOperatingReview(access.user.id) });
          }
          if (body.action === "save_memory_rule") return saveMemoryRule(access, body);
          if (body.action === "preview_import") return previewImport(access, body);
          if (body.action === "review_import") return reviewImport(access, body);
          return json({ error: "Unsupported EA workspace action." }, 400);
        } catch (error: any) {
          if (missingSchema(error))
            return json(
              { error: "Apply the EA workspace migration first.", setupNeeded: true },
              503,
            );
          console.error("EA workspace action failed", error?.message);
          return json({ error: "Unable to save EA workspace changes." }, 500);
        }
      },
    },
  },
});
