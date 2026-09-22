/* eslint-disable @typescript-eslint/no-explicit-any -- finality columns are pending generated Supabase types. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  constructionDocumentFamilyKey,
  isConstructionDocumentVersionLater,
} from "@/lib/constructionDocumentFinality";
import { analyzeConstructionDocumentFinality } from "@/lib/constructionDocumentFinality.server";
import { isStudioTeamRole } from "@/lib/permissions";

const admin = supabaseAdmin as any;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    .select("role,is_active,can_view_all_projects")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.is_active || !isStudioTeamRole(profile.role)) {
    return { response: json({ error: "Only MERAV team members can analyze documents." }, 403) };
  }
  return { user: userData.user, profile };
}

export const Route = createFileRoute("/api/analyze-project-document")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await authorize(request);
          if ("response" in access) return access.response;
          const body = await request.json().catch(() => null);
          const documentId = String(body?.documentId || "");
          if (!UUID.test(documentId)) return json({ error: "Choose a valid document." }, 400);

          const { data: document, error: documentError } = await admin
            .from("project_documents")
            .select("*")
            .eq("id", documentId)
            .eq("document_type", "Construction Doc")
            .maybeSingle();
          if (documentError) throw documentError;
          if (!document) return json({ error: "Construction document not found." }, 404);

          if (
            access.profile.role === "Employee" &&
            access.profile.can_view_all_projects === false
          ) {
            const { data: assignment } = await admin
              .from("user_project_assignments")
              .select("project_id")
              .eq("user_id", access.user.id)
              .eq("project_id", document.project_id)
              .maybeSingle();
            if (!assignment) return json({ error: "You do not have access to this project." }, 403);
          }

          const response = await fetch(String(document.file_url || ""));
          if (!response.ok) return json({ error: "Construction PDF could not be opened." }, 502);
          const declaredSize = Number(response.headers.get("content-length") || 0);
          if (declaredSize > MAX_PDF_BYTES) return json({ error: "PDF exceeds 50 MB." }, 413);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (!bytes.length || bytes.length > MAX_PDF_BYTES) {
            return json({ error: "PDF is empty or exceeds 50 MB." }, 413);
          }
          const file = new File([bytes], document.file_name || "construction-document.pdf", {
            type: document.mime_type || "application/pdf",
          });

          const { data: sources } = await admin
            .from("marvin_sources")
            .select("title,body_text,external_provider,metadata")
            .contains("metadata", { project_document_id: document.id })
            .order("occurred_at", { ascending: false })
            .limit(1);
          const source = sources?.[0] || null;
          const parentSourceId = String(source?.metadata?.parent_email_source_id || "");
          const { data: parentSource } = parentSourceId
            ? await admin
                .from("marvin_sources")
                .select("title,body_text")
                .eq("id", parentSourceId)
                .maybeSingle()
            : { data: null };
          const { data: priorDocuments } = await admin
            .from("project_documents")
            .select(
              "id,file_name,title,created_at,finality_override,finality_revision,finality_document_date,superseded_by_document_id",
            )
            .eq("project_id", document.project_id)
            .eq("document_type", "Construction Doc")
            .neq("id", document.id)
            .order("created_at", { ascending: false })
            .limit(50);

          const analysis = await analyzeConstructionDocumentFinality({
            file,
            fileName: document.file_name || document.title,
            emailSubject: source?.metadata?.email_subject || parentSource?.title || null,
            emailBody:
              source?.external_provider === "gmail_attachment"
                ? String(source?.body_text || "")
                : null,
            emailThread:
              source?.external_provider === "gmail_attachment"
                ? String(parentSource?.body_text || "")
                : null,
            priorDocuments: priorDocuments ?? [],
          });

          const { data: updated, error: updateError } = await admin
            .from("project_documents")
            .update({
              finality_estimate: analysis.estimate,
              finality_confidence: analysis.confidence,
              finality_reason: analysis.reason,
              finality_estimated_at: new Date().toISOString(),
              finality_evidence: analysis.evidence,
              finality_revision: analysis.revision,
              finality_document_date: analysis.documentDate,
              finality_method: analysis.method,
              finality_pdf_text_available: analysis.pdfTextAvailable,
            })
            .eq("id", document.id)
            .select("*")
            .single();
          if (updateError) throw updateError;

          const family = constructionDocumentFamilyKey(document.file_name || document.title);
          if (family.length >= 4 && (analysis.revision || analysis.documentDate)) {
            const olderVersionIds = (priorDocuments ?? [])
              .filter(
                (candidate: any) =>
                  !candidate.finality_override &&
                  constructionDocumentFamilyKey(candidate.file_name || candidate.title) ===
                    family &&
                  isConstructionDocumentVersionLater(
                    {
                      fileName: document.file_name || document.title,
                      revision: analysis.revision,
                      documentDate: analysis.documentDate,
                    },
                    {
                      fileName: candidate.file_name || candidate.title,
                      revision: candidate.finality_revision,
                      documentDate: candidate.finality_document_date,
                    },
                  ),
              )
              .map((candidate: any) => candidate.id);
            if (olderVersionIds.length) {
              await admin
                .from("project_documents")
                .update({ superseded_by_document_id: document.id })
                .in("id", olderVersionIds);
            }
          }

          return json({ document: updated, analysis });
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : "Document analysis failed." },
            500,
          );
        }
      },
    },
  },
});
