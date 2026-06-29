import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canViewFinancials } from "@/lib/permissions";

type ReminderStatus = "open" | "complete";
type ReminderPriority = "low" | "normal" | "high";
type ReminderAssignee = "ken" | "katie" | "studio";

const STATUSES: ReminderStatus[] = ["open", "complete"];
const PRIORITIES: ReminderPriority[] = ["low", "normal", "high"];
const ASSIGNEES: ReminderAssignee[] = ["ken", "katie", "studio"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireReminderAccess(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in as Ken or Katie to use reminders." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!canViewFinancials(profile)) return { error: json({ error: "Only Ken and Katie can use reminders." }, 403) };
  return { user: userData.user };
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNullableText(value: unknown) {
  const text = cleanText(value);
  return text.length ? text : null;
}

function cleanDate(value: unknown) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanChoice<T extends string>(value: unknown, choices: T[], fallback: T) {
  return choices.includes(value as T) ? (value as T) : fallback;
}

function isMissingTable(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "42P01";
}

export const Route = createFileRoute("/api/studio-reminders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireReminderAccess(request);
          if ("error" in access) return access.error;

          const { data, error } = await supabaseAdmin
            .from("studio_reminders")
            .select("*, project:projects(id,name,client_name)")
            .order("status", { ascending: false })
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("reminder_date", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(100);

          if (error) {
            if (isMissingTable(error)) return json({ reminders: [], setupNeeded: true });
            return json({ error: error.message }, 500);
          }

          return json({
            reminders: (data ?? []).map((reminder: any) => ({
              ...reminder,
              project_name: reminder.project?.name ?? null,
              project_client_name: reminder.project?.client_name ?? null,
            })),
          });
        } catch (e: any) {
          console.error("List reminders failed", e);
          return json({ error: "Unable to load studio reminders." }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const access = await requireReminderAccess(request);
          if ("error" in access) return access.error;

          const body = await request.json();
          const title = cleanText(body.title);
          if (!title) return json({ error: "Add a reminder title." }, 400);

          const payload = {
            title,
            project_id: cleanNullableText(body.project_id),
            notes: cleanNullableText(body.notes),
            due_date: cleanDate(body.due_date),
            reminder_date: cleanDate(body.reminder_date),
            priority: cleanChoice(body.priority, PRIORITIES, "normal"),
            assigned_to: cleanChoice(body.assigned_to, ASSIGNEES, "studio"),
            status: "open",
            created_by: access.user.id,
          };

          const { data, error } = await supabaseAdmin
            .from("studio_reminders")
            .insert(payload as any)
            .select("*, project:projects(id,name,client_name)")
            .single();

          if (error) return json({ error: error.message }, isMissingTable(error) ? 503 : 500);
          return json({ reminder: data });
        } catch (e: any) {
          console.error("Create reminder failed", e);
          return json({ error: "Unable to create reminder." }, 500);
        }
      },
      PATCH: async ({ request }) => {
        try {
          const access = await requireReminderAccess(request);
          if ("error" in access) return access.error;

          const body = await request.json();
          const id = cleanText(body.id);
          if (!id) return json({ error: "Missing reminder id." }, 400);

          const updates: Record<string, unknown> = {};
          if ("title" in body) {
            const title = cleanText(body.title);
            if (!title) return json({ error: "Reminder title cannot be blank." }, 400);
            updates.title = title;
          }
          if ("project_id" in body) updates.project_id = cleanNullableText(body.project_id);
          if ("notes" in body) updates.notes = cleanNullableText(body.notes);
          if ("due_date" in body) updates.due_date = cleanDate(body.due_date);
          if ("reminder_date" in body) updates.reminder_date = cleanDate(body.reminder_date);
          if ("priority" in body) updates.priority = cleanChoice(body.priority, PRIORITIES, "normal");
          if ("assigned_to" in body) updates.assigned_to = cleanChoice(body.assigned_to, ASSIGNEES, "studio");
          if ("status" in body) {
            const status = cleanChoice(body.status, STATUSES, "open");
            updates.status = status;
            updates.completed_at = status === "complete" ? new Date().toISOString() : null;
          }

          const { data, error } = await supabaseAdmin
            .from("studio_reminders")
            .update(updates as any)
            .eq("id", id)
            .select("*, project:projects(id,name,client_name)")
            .single();

          if (error) return json({ error: error.message }, isMissingTable(error) ? 503 : 500);
          return json({ reminder: data });
        } catch (e: any) {
          console.error("Update reminder failed", e);
          return json({ error: "Unable to update reminder." }, 500);
        }
      },
      DELETE: async ({ request }) => {
        try {
          const access = await requireReminderAccess(request);
          if ("error" in access) return access.error;

          const url = new URL(request.url);
          const id = cleanText(url.searchParams.get("id"));
          if (!id) return json({ error: "Missing reminder id." }, 400);

          const { error } = await supabaseAdmin.from("studio_reminders").delete().eq("id", id);
          if (error) return json({ error: error.message }, isMissingTable(error) ? 503 : 500);
          return json({ ok: true });
        } catch (e: any) {
          console.error("Delete reminder failed", e);
          return json({ error: "Unable to delete reminder." }, 500);
        }
      },
    },
  },
});
