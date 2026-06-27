import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canViewFinancials } from "@/lib/permissions";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function stripePost(path: string, body: URLSearchParams, apiKey: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Stripe request failed.");
  return data;
}

async function requireInvoiceAccess(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in as Ken or Katie to use invoice tools." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!canViewFinancials(profile)) return { error: json({ error: "Only Ken and Katie can use invoice tools." }, 403) };

  return { user: userData.user };
}

function appendStripeLinkNote(notes: string | null | undefined, url: string) {
  const cleanNotes = (notes ?? "").replace(/Stripe payment link:\s*https:\/\/(?:buy|checkout)\.stripe\.com\/[^\s"')<]+/gi, "").trim();
  return [cleanNotes, `Stripe payment link: ${url}`].filter(Boolean).join("\n");
}

export const Route = createFileRoute("/api/mark-financial-payment-due")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireInvoiceAccess(request);
          if ("error" in access) return access.error;

          const { paymentId } = (await request.json()) as { paymentId?: string };
          if (!paymentId) return json({ error: "Missing payment id." }, 400);

          const { data: payment, error: paymentError } = await supabaseAdmin
            .from("financial_invoice_payments")
            .select("*, invoice:financial_invoices(id,file_name,client_name,project_id,project:projects(id,name,client_name))")
            .eq("id", paymentId)
            .maybeSingle();
          if (paymentError) return json({ error: paymentError.message }, 500);
          if (!payment) return json({ error: "Payment not found." }, 404);

          const amount = Number((payment as any).amount || 0);
          if (amount <= 0) return json({ error: "Payment amount must be greater than $0 before it can be marked due." }, 400);

          const apiKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
          if (!apiKey) {
            const { data: updated, error: updateError } = await supabaseAdmin
              .from("financial_invoice_payments")
              .update({ status: "due" })
              .eq("id", paymentId)
              .select()
              .single();
            if (updateError) return json({ error: updateError.message }, 500);
            return json({
              payment: updated,
              warning: "Marked due, but STRIPE_SECRET_KEY is missing so no payment link was created.",
            });
          }

          const invoice = (payment as any).invoice;
          const project = invoice?.project;
          const projectName = project?.name ?? invoice?.file_name ?? "MERAV Studio";
          const label = (payment as any).label || "Payment Due";
          const clientName = invoice?.client_name || project?.client_name || "Client";
          const cents = Math.round(amount * 100);

          const product = await stripePost("products", new URLSearchParams({
            name: `${projectName} - ${label}`,
            type: "service",
            description: `${clientName} - ${label}`,
          }), apiKey);
          const price = await stripePost("prices", new URLSearchParams({
            product: product.id,
            unit_amount: String(cents),
            currency: "usd",
          }), apiKey);
          const linkParams = new URLSearchParams({
            "line_items[0][price]": price.id,
            "line_items[0][quantity]": "1",
            "metadata[invoice_id]": invoice?.id ?? "",
            "metadata[payment_id]": paymentId,
            "metadata[project_id]": invoice?.project_id ?? (payment as any).project_id ?? "",
            "metadata[payment_label]": label,
          });
          const link = await stripePost("payment_links", linkParams, apiKey);

          const { data: updated, error: updateError } = await supabaseAdmin
            .from("financial_invoice_payments")
            .update({
              status: "due",
              notes: appendStripeLinkNote((payment as any).notes, link.url),
              stripe_payment_link_id: link.id,
              stripe_checkout_session_id: null,
              stripe_payment_intent_id: null,
            })
            .eq("id", paymentId)
            .select()
            .single();
          if (updateError) return json({ error: updateError.message }, 500);

          return json({ payment: updated, url: link.url, id: link.id });
        } catch (e: any) {
          return json({ error: e?.message || "Could not mark payment due." }, 500);
        }
      },
    },
  },
});
