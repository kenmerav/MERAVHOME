/* eslint-disable @typescript-eslint/no-explicit-any -- Auth and document rows are server-only. */
import { createFileRoute } from "@tanstack/react-router";
import type { PDFParse } from "pdf-parse";
import pdfWorkerSource from "pdfjs-dist/legacy/build/pdf.worker.mjs?raw";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensurePdfJsServerGlobals } from "@/lib/pdfJsServerGlobals";
import { canUseEaWorkspace } from "@/lib/permissions";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PAGE_WIDTHS = [2400, 2000, 1600];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function uuid(value: string | null) {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : "";
}

async function requireStudioTeam(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { error: json({ error: "Sign in to view document evidence." }, 401) };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return { error: json({ error: "Your Studio session is no longer valid." }, 401) };
  }
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email,role,is_active,can_view_all_projects")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!canUseEaWorkspace(profile)) {
    return {
      error: json({ error: "EA document evidence is limited to Ken, Katie, and Brynn." }, 403),
    };
  }
  return { user: data.user, profile };
}

async function createPdfParser(data: Uint8Array) {
  await ensurePdfJsServerGlobals();
  const { PDFParse } = await import("pdf-parse");
  PDFParse.setWorker(
    `data:text/javascript;base64,${Buffer.from(pdfWorkerSource).toString("base64")}`,
  );
  return new PDFParse({ data: Buffer.from(data) });
}

async function renderPage(data: Uint8Array, pageNumber: number) {
  for (const desiredWidth of PAGE_WIDTHS) {
    let parser: PDFParse | null = null;
    try {
      parser = await createPdfParser(data);
      const result = await parser.getScreenshot({
        partial: [pageNumber],
        desiredWidth,
        imageDataUrl: false,
        imageBuffer: true,
      });
      const page = result.pages[0];
      if (page?.data?.length) return Buffer.from(page.data);
    } finally {
      await parser?.destroy();
    }
  }
  throw new Error(`Construction document page ${pageNumber} could not be rendered.`);
}

export const Route = createFileRoute("/api/ea-document-evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const access = await requireStudioTeam(request);
        if ("error" in access) return access.error;
        try {
          const url = new URL(request.url);
          const documentId = uuid(url.searchParams.get("document_id"));
          const pageNumber = Number(url.searchParams.get("page"));
          if (!documentId || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 500) {
            return json({ error: "Choose a valid construction document page." }, 400);
          }
          const { data: document, error } = await supabaseAdmin
            .from("project_documents" as any)
            .select("id,project_id,file_url,mime_type")
            .eq("id", documentId)
            .maybeSingle();
          if (error) throw error;
          if (!document) return json({ error: "Construction document not found." }, 404);
          if (
            access.profile.role === "Employee" &&
            access.profile.can_view_all_projects === false
          ) {
            const { data: assignment } = await supabaseAdmin
              .from("user_project_assignments")
              .select("project_id")
              .eq("user_id", access.user.id)
              .eq("project_id", document.project_id)
              .maybeSingle();
            if (!assignment) {
              return json({ error: "You do not have access to this project document." }, 403);
            }
          }
          if (!/^application\/pdf/i.test(String(document.mime_type || "application/pdf"))) {
            return json({ error: "This evidence source is not a PDF." }, 400);
          }
          const pdfResponse = await fetch(String(document.file_url || ""));
          if (!pdfResponse.ok) {
            return json({ error: "Construction document could not be opened." }, 502);
          }
          const declaredSize = Number(pdfResponse.headers.get("content-length") || 0);
          if (declaredSize > MAX_PDF_BYTES) {
            return json(
              { error: "Construction document exceeds the evidence preview limit." },
              413,
            );
          }
          const bytes = new Uint8Array(await pdfResponse.arrayBuffer());
          if (!bytes.length || bytes.length > MAX_PDF_BYTES) {
            return json(
              { error: "Construction document exceeds the evidence preview limit." },
              413,
            );
          }
          const image = await renderPage(bytes, pageNumber);
          return new Response(new Uint8Array(image), {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "private, max-age=3600",
              "Content-Disposition": `inline; filename="construction-evidence-page-${pageNumber}.png"`,
            },
          });
        } catch (error: any) {
          console.error("EA construction evidence render failed", error?.message);
          return json({ error: error?.message || "Unable to render document evidence." }, 500);
        }
      },
    },
  },
});
