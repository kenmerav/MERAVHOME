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

export const Route = createFileRoute("/api/create-stripe-payment-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireInvoiceAccess(request);
          if ("error" in access) return access.error;

          const { name, amount, description, metadata } = (await request.json()) as {
            name?: string;
            amount?: number;
            description?: string;
            metadata?: Record<string, string | number | boolean | null | undefined>;
          };
          const apiKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
          if (!apiKey) return json({ error: "Missing STRIPE_SECRET_KEY in Vercel environment variables." }, 500);
          if (!name?.trim()) return json({ error: "Missing payment link name." }, 400);
          if (!amount || amount <= 0) return json({ error: "Payment amount must be greater than $0." }, 400);

          const cents = Math.round(amount * 100);
          const product = await stripePost("products", new URLSearchParams({
            name: name.trim(),
            type: "service",
            ...(description ? { description } : {}),
          }), apiKey);
          const price = await stripePost("prices", new URLSearchParams({
            product: product.id,
            unit_amount: String(cents),
            currency: "usd",
          }), apiKey);
          const linkParams = new URLSearchParams({
            "line_items[0][price]": price.id,
            "line_items[0][quantity]": "1",
          });
          Object.entries(metadata ?? {}).forEach(([key, value]) => {
            if (value != null && value !== "") linkParams.set(`metadata[${key}]`, String(value));
          });
          const link = await stripePost("payment_links", linkParams, apiKey);

          return json({ id: link.id, url: link.url, amount: cents / 100 });
        } catch (e: any) {
          return json({ error: e?.message || "Could not create Stripe payment link." }, 500);
        }
      },
    },
  },
});
