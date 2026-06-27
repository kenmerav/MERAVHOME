import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Project, UserProfile } from "@/lib/db";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireSharedUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in first." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) return { error: json({ error: profileError.message }, 500) };
  const typedProfile = profile as UserProfile | null;
  if (!typedProfile?.is_active) return { error: json({ error: "This account is not active." }, 403) };
  if (typedProfile.role !== "Client" && typedProfile.role !== "Contractor") {
    return { error: json({ error: "Client dashboard is only available to shared users." }, 403) };
  }

  return { user: userData.user, profile: typedProfile };
}

function accessForProject(project: Project, role: UserProfile["role"]) {
  const client = role === "Client";
  return {
    specBook: client ? project.client_can_view_spec_book : project.contractor_can_view_spec_book,
    presentations: client ? project.client_can_view_presentations : project.contractor_can_view_presentations,
    designBoards: client ? project.client_can_view_design_boards : project.contractor_can_view_design_boards,
    approvals: client && project.approval_live === true,
  };
}

function paymentIsOpen(payment: any) {
  return payment?.status !== "paid" && payment?.status !== "waived" && Number(payment?.amount || 0) > 0;
}

export const Route = createFileRoute("/api/client-dashboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const shared = await requireSharedUser(request);
          if ("error" in shared) return shared.error;

          const { data: assignments, error: assignmentsError } = await supabaseAdmin
            .from("user_project_assignments")
            .select("project_id")
            .eq("user_id", shared.user.id);
          if (assignmentsError) return json({ error: assignmentsError.message }, 500);

          const projectIds = Array.from(new Set((assignments ?? []).map((row: any) => row.project_id).filter(Boolean)));
          if (!projectIds.length) {
            return json({ projects: [], invoices: [], timelines: [], todos: [] });
          }

          const { data: projectRows, error: projectsError } = await supabaseAdmin
            .from("projects")
            .select("*")
            .in("id", projectIds)
            .order("name", { ascending: true });
          if (projectsError) return json({ error: projectsError.message }, 500);

          const projects = ((projectRows ?? []) as Project[]).map((project) => ({
            id: project.id,
            name: project.name,
            client_name: project.client_name,
            status: project.status,
            cover_image_url: project.cover_image_url,
            access: accessForProject(project, shared.profile.role),
          }));

          const { data: timelineRows, error: timelinesError } = await supabaseAdmin
            .from("project_timelines" as any)
            .select("id,project_id,title,project_name,client_name,timeline_date,html_data_url,raw_text,client_visible,created_at,updated_at")
            .in("project_id", projectIds)
            .eq("client_visible", true)
            .order("timeline_date", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: false });
          if (timelinesError) return json({ error: timelinesError.message }, 500);

          const timelines = (timelineRows ?? []).map((timeline: any) => {
            const project = projects.find((item) => item.id === timeline.project_id);
            return {
              id: timeline.id,
              project_id: timeline.project_id,
              project_name: project?.name ?? timeline.project_name ?? "Project",
              title: timeline.title ?? "Project Timeline",
              timeline_date: timeline.timeline_date,
              html_data_url: timeline.html_data_url,
              created_at: timeline.created_at,
            };
          });

          let invoices: any[] = [];
          if (shared.profile.role === "Client") {
            const { data: invoiceRows, error: invoicesError } = await supabaseAdmin
              .from("financial_invoices" as any)
              .select("id,project_id,file_name,pdf_data_url,invoice_date,client_name,total_amount,paid_amount,balance_due,client_visible,created_at,updated_at,payments:financial_invoice_payments(id,label,amount,due_date,status,notes,sort_order,paid_at)")
              .in("project_id", projectIds)
              .eq("client_visible", true)
              .order("invoice_date", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false });
            if (invoicesError) return json({ error: invoicesError.message }, 500);

            invoices = (invoiceRows ?? []).map((invoice: any) => {
              const project = projects.find((item) => item.id === invoice.project_id);
              const payments = [...(invoice.payments ?? [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
              return {
                id: invoice.id,
                project_id: invoice.project_id,
                project_name: project?.name ?? "Project",
                file_name: invoice.file_name ?? "Invoice",
                pdf_data_url: invoice.pdf_data_url,
                invoice_date: invoice.invoice_date,
                total_amount: invoice.total_amount,
                paid_amount: invoice.paid_amount,
                balance_due: invoice.balance_due,
                created_at: invoice.created_at,
                payments,
              };
            });
          }

          const todos = [
            ...invoices.flatMap((invoice) =>
              (invoice.payments ?? [])
                .filter(paymentIsOpen)
                .map((payment: any) => ({
                  id: `invoice-${payment.id}`,
                  kind: "invoice",
                  title: payment.label || invoice.file_name || "Invoice payment due",
                  project_id: invoice.project_id,
                  project_name: invoice.project_name,
                  amount: payment.amount,
                  due_date: payment.due_date,
                  invoice_id: invoice.id,
                })),
            ),
            ...projects
              .filter((project) => project.access.approvals)
              .map((project) => ({
                id: `approval-${project.id}`,
                kind: "approval",
                title: "Review selections",
                project_id: project.id,
                project_name: project.name,
                href: `/client/approvals/${project.id}`,
              })),
          ];

          return json({ projects, invoices, timelines, todos });
        } catch (e: any) {
          console.error("Client dashboard failed", e);
          return json({ error: e?.message || "Unable to load client dashboard." }, 500);
        }
      },
    },
  },
});
