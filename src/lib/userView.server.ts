import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canManageStudio, OVERALL_ADMIN_EMAILS } from "@/lib/permissions";
import { cleanUuid } from "@/lib/ids";
import { USER_VIEW_LIFETIME } from "@/lib/userView";

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function startUserView(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: "Open account views from Studio." }, 403);
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer "))
    return json({ error: "Sign in as an overall admin first." }, 401);
  const { data: actorData, error: actorError } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (actorError || !actorData.user) return json({ error: "Your admin session expired." }, 401);
  // Verify the login identity itself; a profile field cannot grant this power.
  if (
    !actorData.user.email_confirmed_at ||
    !OVERALL_ADMIN_EMAILS.has(actorData.user.email?.toLowerCase() || "")
  )
    return json({ error: "Only Ken and Katie can view other accounts." }, 403);
  const { data: actor, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("email,role,is_active,is_owner")
    .eq("id", actorData.user.id)
    .maybeSingle();
  if (profileError || !canManageStudio(actor))
    return json({ error: "Only Ken and Katie can view other accounts." }, 403);

  const body = await request.json().catch(() => null);
  const userId = cleanUuid(body?.user_id);
  if (!userId) return json({ error: "Choose a user first." }, 400);
  const { data: target, error: targetError } = await supabaseAdmin
    .from("user_profiles")
    .select("id,email,full_name,role,is_active")
    .eq("id", userId)
    .maybeSingle();
  if (targetError) return json({ error: "Could not load this account." }, 500);
  if (!target || !target.is_active)
    return json({ error: "Only active accounts can be viewed." }, 400);
  // Never create an account or change a password as part of viewing it.
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authError || authData.user?.email?.toLowerCase() !== target.email.toLowerCase())
    return json({ error: "This account's login details need to be checked first." }, 400);
  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: authData.user.email!,
  });
  if (linkError || link.user?.id !== userId || !link.properties?.hashed_token)
    return json({ error: "Could not open this account view. Please try again." }, 500);
  console.info("[Studio account view]", {
    admin_id: actorData.user.id,
    user_id: userId,
    at: new Date().toISOString(),
  });
  return json({
    token_hash: link.properties.hashed_token,
    user: { id: target.id, email: target.email, full_name: target.full_name, role: target.role },
    expires_at: Date.now() + USER_VIEW_LIFETIME,
  });
}
