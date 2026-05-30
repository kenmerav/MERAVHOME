import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { UserRole } from "@/lib/db";

const ROLES: UserRole[] = ["Admin", "Employee", "Contractor", "Client"];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in as an admin first." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile?.is_active || profile.role !== "Admin") {
    return { error: json({ error: "Only admins can manage users." }, 403) };
  }

  return { user: userData.user };
}

export const Route = createFileRoute("/api/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const admin = await requireAdmin(request);
          if ("error" in admin) return admin.error;

          const { data, error } = await supabaseAdmin
            .from("user_profiles")
            .select("*")
            .order("created_at", { ascending: false });
          if (error) return json({ error: error.message }, 500);
          return json({ users: data ?? [] });
        } catch (e: any) {
          console.error("List users failed", e);
          return json({ error: "Unable to load users." }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const admin = await requireAdmin(request);
          if ("error" in admin) return admin.error;

          const body = (await request.json()) as {
            email?: string;
            full_name?: string;
            role?: UserRole;
            password?: string;
          };

          const email = body.email?.trim().toLowerCase();
          const fullName = body.full_name?.trim();
          const role = body.role;
          const password = body.password?.trim() || "merav";

          if (!email || !email.includes("@")) return json({ error: "Enter a valid email." }, 400);
          if (!fullName) return json({ error: "Enter the user's name." }, 400);
          if (!role || !ROLES.includes(role)) return json({ error: "Choose a valid role." }, 400);
          if (password.length < 4) return json({ error: "Password must be at least 4 characters." }, 400);

          const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName, role },
          });

          const duplicate = createError?.message?.toLowerCase().includes("already");
          if (createError && !duplicate) return json({ error: createError.message }, 500);

          let userId = created.user?.id;
          if (!userId) {
            const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
            if (listError) return json({ error: listError.message }, 500);
            userId = users.users.find((user) => user.email?.toLowerCase() === email)?.id;
          }
          if (!userId) return json({ error: "User exists, but could not be found." }, 500);

          if (duplicate) {
            await supabaseAdmin.auth.admin.updateUserById(userId, {
              password,
              email_confirm: true,
              user_metadata: { full_name: fullName, role },
            });
          }

          const { data: profile, error: profileError } = await supabaseAdmin
            .from("user_profiles")
            .upsert({ id: userId, email, full_name: fullName, role, is_active: true }, { onConflict: "id" })
            .select()
            .single();

          if (profileError) return json({ error: profileError.message }, 500);
          return json({ user: profile });
        } catch (e: any) {
          console.error("Create user failed", e);
          return json({ error: "Unable to create user." }, 500);
        }
      },
    },
  },
});
