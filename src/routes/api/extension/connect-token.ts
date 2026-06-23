import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearerToken(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
}

export const Route = createFileRoute("/api/extension/connect-token")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return json({ error: "Sign into MERAV Studio first." }, 401);

          const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
          if (userError || !userData.user) return json({ error: "Your Studio session is no longer valid." }, 401);

          const { data: profile, error: profileError } = await supabaseAdmin
            .from("user_profiles")
            .select("email,role,is_active")
            .eq("id", userData.user.id)
            .maybeSingle();
          if (profileError) throw profileError;

          const canUseExtension =
            profile?.is_active === true && (profile.role === "Admin" || profile.role === "Employee");
          if (!canUseExtension) {
            return json({ error: "Only active MERAV admins and employees can connect the Studio extension." }, 403);
          }

          const extensionToken = process.env.MERAV_EXTENSION_TOKEN;
          if (!extensionToken) {
            return json({ error: "MERAV_EXTENSION_TOKEN is not configured in Studio." }, 500);
          }

          return json({
            token: extensionToken,
            user: {
              email: profile.email,
              role: profile.role,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not connect the Studio extension.";
          console.error("[Extension Connect] Failed", error);
          return json({ error: message }, 500);
        }
      },
    },
  },
});
