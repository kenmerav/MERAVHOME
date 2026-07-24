/* eslint-disable @typescript-eslint/no-explicit-any -- Marvin schema is server-only. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  addManualSource,
  approveSuggestion,
  deleteSource,
  disconnectIntegration,
  dismissSource,
  generateBriefingForUser,
  gmailAuthorizationUrl,
  json,
  linkSource,
  loadConversation,
  loadMarvinBootstrap,
  loadSourceDetail,
  marvinChat,
  refreshPendingSourceMatches,
  rebuildSourceSegments,
  requireMarvinUser,
  saveFathomIntegration,
  syncAllGmail,
  syncFathom,
} from "@/lib/marvin.server";

const admin = supabaseAdmin as any;

export const Route = createFileRoute("/api/marvin")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const access = await requireMarvinUser(request);
          if ("error" in access) return access.error;
          const url = new URL(request.url);
          const conversationId = url.searchParams.get("conversation_id");
          if (conversationId) {
            return json({ messages: await loadConversation(access, conversationId) });
          }
          return json(await loadMarvinBootstrap(access));
        } catch (error: any) {
          console.error("Marvin read failed", error?.message);
          return json({ error: error?.message || "Marvin could not load." }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const access = await requireMarvinUser(request);
          if ("error" in access) return access.error;
          const body = await request.json();
          switch (body.action) {
            case "chat":
              return json(await marvinChat(access, body));
            case "add_source":
              return json({ source: await addManualSource(access, body) });
            case "link_source":
              await linkSource(
                access,
                String(body.id || ""),
                Array.isArray(body.project_ids) ? body.project_ids : [],
                body.general_business === true,
                body.include_general === true,
              );
              return json({ ok: true });
            case "dismiss_source":
              await dismissSource(String(body.id || ""));
              return json({ ok: true });
            case "source_detail":
              return json({ source: await loadSourceDetail(String(body.id || "")) });
            case "delete_source":
              await deleteSource(String(body.id || ""));
              return json({ ok: true });
            case "gmail_connect":
              return json({ url: gmailAuthorizationUrl(access) });
            case "sync_now":
              return json({ gmail: await syncAllGmail(), fathom: await syncFathom() });
            case "refresh_source_matches":
              return json(await refreshPendingSourceMatches());
            case "rebuild_source_segments":
              return json({ segments: await rebuildSourceSegments(String(body.id || "")) });
            case "run_briefing":
              return json({ briefing: await generateBriefingForUser(access.user.id, true) });
            case "approve_suggestion":
              return json({ todo: await approveSuggestion(access, body) });
            case "dismiss_suggestion":
              await admin
                .from("marvin_suggestions")
                .update({ status: "dismissed" })
                .eq("id", body.id)
                .eq("user_id", access.user.id);
              return json({ ok: true });
            case "update_suggestion":
              await admin
                .from("marvin_suggestions")
                .update({
                  title: String(body.title || "").trim(),
                  notes: body.notes || null,
                  due_date: body.due_date || null,
                  priority: ["Low", "Medium", "High", "Urgent"].includes(body.priority)
                    ? body.priority
                    : "Medium",
                  estimated_hours:
                    body.estimated_hours === null || body.estimated_hours === ""
                      ? null
                      : Math.max(0, Number(body.estimated_hours) || 0),
                  recommended_assignee_id: body.assigned_user_id || null,
                })
                .eq("id", body.id)
                .eq("user_id", access.user.id);
              return json({ ok: true });
            case "connect_fathom": {
              const webhookUrl =
                process.env.MARVIN_FATHOM_WEBHOOK_URL ||
                `${new URL(request.url).origin}/api/marvin-fathom-webhook`;
              return json({
                integration: await saveFathomIntegration(
                  access,
                  String(body.api_key || ""),
                  webhookUrl,
                ),
              });
            }
            case "disconnect":
              await disconnectIntegration(String(body.id || ""));
              return json({ ok: true });
            case "add_contact":
              return json(await addContact(access, body));
            default:
              return json({ error: "Unknown Marvin action." }, 400);
          }
        } catch (error: any) {
          console.error("Marvin action failed", error?.message);
          return json({ error: error?.message || "Marvin could not complete that action." }, 500);
        }
      },
    },
  },
});

async function addContact(access: any, body: any) {
  const projectId = String(body.project_id || "").trim();
  const email =
    String(body.email || "")
      .trim()
      .toLowerCase() || null;
  const alias = String(body.alias || "").trim() || null;
  if (!projectId || (!email && !alias))
    throw new Error("Choose a project and add an email or alias.");
  const { data, error } = await admin
    .from("marvin_project_contacts")
    .insert({
      project_id: projectId,
      contact_type: ["client", "gc", "vendor", "architect", "employee", "other"].includes(
        body.contact_type,
      )
        ? body.contact_type
        : "other",
      name: String(body.name || "").trim() || null,
      email,
      alias,
      created_by: access.user.id,
    })
    .select("*")
    .single();
  if (error) throw error;
  return { contact: data };
}
