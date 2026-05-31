import { createFileRoute } from "@tanstack/react-router";

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

export const Route = createFileRoute("/api/create-stripe-payment-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { name, amount, description } = (await request.json()) as {
            name?: string;
            amount?: number;
            description?: string;
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
          const link = await stripePost("payment_links", new URLSearchParams({
            "line_items[0][price]": price.id,
            "line_items[0][quantity]": "1",
          }), apiKey);

          return json({ id: link.id, url: link.url, amount: cents / 100 });
        } catch (e: any) {
          return json({ error: e?.message || "Could not create Stripe payment link." }, 500);
        }
      },
    },
  },
});
