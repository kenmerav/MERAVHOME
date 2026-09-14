/* eslint-disable @typescript-eslint/no-explicit-any -- server auth uses generated Supabase schema. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createAppleCalendarEvent, loadAppleCalendar } from "@/lib/appleCalendar.server";
import { canUseEaWorkspace } from "@/lib/permissions";

const admin = supabaseAdmin as any;
const CALENDAR_NOTICE_EMAILS = ["ken@meravinteriors.com", "katie@meravinteriors.com"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function authorize(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { response: json({ error: "Sign in first." }, 401) };
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return { response: json({ error: "Your session expired." }, 401) };
  }
  const { data: profile } = await admin
    .from("user_profiles")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!canUseEaWorkspace(profile)) {
    return {
      response: json({ error: "EA Calendar is available only to Ken, Katie, and Brynn." }, 403),
    };
  }
  return { profile, user: userData.user };
}

async function ensureCalendarLoginNotification(
  taskId: string,
  createdBy: string,
  result: Awaited<ReturnType<typeof createAppleCalendarEvent>>,
) {
  if (!result.event.id) throw new Error("Apple Calendar did not return an event ID.");
  const { data: notification, error: notificationError } = await admin
    .from("studio_calendar_notifications")
    .upsert(
      {
        calendar_event_id: result.event.id,
        task_id: taskId,
        calendar_name: result.event.calendar,
        title: result.event.title,
        start_at: result.event.start_at,
        end_at: result.event.end_at,
        location: result.event.location,
        created_by: createdBy,
      },
      { onConflict: "calendar_event_id" },
    )
    .select("id")
    .single();
  if (notificationError) throw notificationError;

  const { data: profiles, error: profileError } = await admin
    .from("user_profiles")
    .select("id,email")
    .in("email", CALENDAR_NOTICE_EMAILS)
    .eq("is_active", true);
  if (profileError) throw profileError;
  const recipients = (profiles ?? []).filter((profile: any) =>
    CALENDAR_NOTICE_EMAILS.includes(String(profile.email || "").toLowerCase()),
  );
  if (!recipients.length) throw new Error("Ken and Katie notification profiles were not found.");
  const { error: recipientError } = await admin
    .from("studio_calendar_notification_recipients")
    .upsert(
      recipients.map((profile: any) => ({
        notification_id: notification.id,
        user_id: profile.id,
      })),
      { onConflict: "notification_id,user_id" },
    );
  if (recipientError) throw recipientError;
}

export const Route = createFileRoute("/api/ea-calendar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await authorize(request);
        if ("response" in access) return access.response;
        const force = new URL(request.url).searchParams.get("refresh") === "1";
        return json(await loadAppleCalendar(force));
      },
      POST: async ({ request }) => {
        const access = await authorize(request);
        if ("response" in access) return access.response;
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") return json({ error: "Invalid request." }, 400);
        try {
          const taskId = String(body.task_id || "");
          const result = await createAppleCalendarEvent({
            task_id: taskId,
            calendar: body.calendar,
            title: String(body.title || ""),
            date: String(body.date || ""),
            start_time: String(body.start_time || ""),
            end_time: String(body.end_time || ""),
            location: body.location == null ? null : String(body.location),
          });
          if (result.created || result.event.url?.startsWith("merav-ea://task/")) {
            await ensureCalendarLoginNotification(taskId, access.user.id, result);
          }
          return json(result);
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : "Unable to add the appointment." },
            400,
          );
        }
      },
    },
  },
});
