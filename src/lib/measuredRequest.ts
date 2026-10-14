// Authenticated requests for Drawing + Spec Book.
import { supabase } from "@/integrations/supabase/client";
export async function studioHeaders() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in first.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` };
}
export const studioFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("/api/")) throw new Error("Studio requests must use a local API path.");
  const { Authorization } = await studioHeaders();
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("Authorization", Authorization);
  return fetch(input, { ...init, headers });
};
