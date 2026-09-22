/* eslint-disable @typescript-eslint/no-explicit-any -- finality columns are pending generated Supabase types. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isStudioTeamRole } from "@/lib/permissions";

const admin = supabaseAdmin as any;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["final", "in_progress", "superseded"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function authorize(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { response: json({ error: "Sign in first." }, 401) };

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return { response: json({ error: "Your session is no longer valid." }, 401) };
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.is_active || !isStudioTeamRole(profile.role)) {
    return { response: json({ error: "Only MERAV team members can set document status." }, 403) };
  }

  return { user: userData.user };
}

export const Route = createFileRoute("/api/project-document-finality")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await authorize(request);
          if ("response" in access) return access.response;

          const body = await request.json().catch(() => null);
          const documentId = String(body?.documentId || "");
          const status = body?.status == null ? null : String(body.status);
          if (!UUID.test(documentId)) return json({ error: "Choose a valid document." }, 400);
          if (status !== null && !STATUSES.has(status)) {
            return json({ error: "Choose Final, In progress, or Superseded." }, 400);
          }

          const now = new Date().toISOString();
          const { data: document, error } = await admin
            .from("project_documents")
            .update({
              finality_override: status,
              finality_overridden_at: status ? now : null,
              finality_overridden_by: status ? access.user.id : null,
            })
            .eq("id", documentId)
            .select("id,finality_override,finality_overridden_at")
            .maybeSingle();
          if (error) return json({ error: error.message }, 400);
          if (!document) return json({ error: "Document not found." }, 404);

          return json({ document });
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : "Could not update document status." },
            500,
          );
        }
      },
    },
  },
});
