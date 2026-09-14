/* eslint-disable @typescript-eslint/no-explicit-any -- server auth uses generated Supabase schema. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const admin = supabaseAdmin as any;
const RECIPIENT_EMAILS = new Set(["ken@meravinteriors.com", "katie@meravinteriors.com"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    .select("id,email,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.is_active || !RECIPIENT_EMAILS.has(String(profile.email).toLowerCase())) {
    return {
      response: json({ error: "Calendar notices are available only to Ken and Katie." }, 403),
    };
  }
  return { user: userData.user };
}

export const Route = createFileRoute("/api/calendar-notifications")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await authorize(request);
        if ("response" in access) return access.response;
        const { data, error } = await admin
          .from("studio_calendar_notification_recipients")
          .select(
            "notification_id,notification:studio_calendar_notifications(id,calendar_event_id,task_id,calendar_name,title,start_at,end_at,location,created_at)",
          )
          .eq("user_id", access.user.id)
          .is("seen_at", null)
          .order("created_at", { ascending: true })
          .limit(25);
        if (error) return json({ error: error.message }, 400);
        const notifications = (data ?? [])
          .map((row: any) =>
            Array.isArray(row.notification) ? row.notification[0] : row.notification,
          )
          .filter(Boolean);
        return json({ notifications });
      },
      POST: async ({ request }) => {
        const access = await authorize(request);
        if ("response" in access) return access.response;
        const body = await request.json().catch(() => null);
        const notificationIds = Array.from(
          new Set(
            (Array.isArray(body?.notification_ids) ? body.notification_ids : [])
              .map((value: unknown) => String(value || ""))
              .filter((value: string) => UUID.test(value)),
          ),
        ).slice(0, 25);
        if (!notificationIds.length) return json({ error: "Choose a notification." }, 400);
        const { error } = await admin
          .from("studio_calendar_notification_recipients")
          .update({ seen_at: new Date().toISOString() })
          .eq("user_id", access.user.id)
          .in("notification_id", notificationIds)
          .is("seen_at", null);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      },
    },
  },
});
