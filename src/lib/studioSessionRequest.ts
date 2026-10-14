import { supabase } from "@/integrations/supabase/client";

export type StudioSessionRequest = (path: string, init: RequestInit) => Promise<Response>;

// Long refreshes must follow Supabase's renewed session rather than retaining
// the token captured at the beginning of a large project check.
export async function createStudioSessionRequest(): Promise<StudioSessionRequest> {
  const expired = () =>
    new Error(
      "Your sign-in expired. Sign in and run the check again; product details already saved are kept.",
    );
  const initial = await supabase.auth.getSession();
  if (initial.error || !initial.data.session) throw expired();
  const userId = initial.data.session.user.id;
  return async (path, init) => {
    if (!path.startsWith("/api/") || path.includes("//"))
      throw new Error("Invalid Studio request.");
    const current = await supabase.auth.getSession();
    if (current.error || !current.data.session || current.data.session.user.id !== userId)
      throw expired();
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(path, { ...init, headers });
    };
    const response = await send(current.data.session.access_token);
    if (response.status !== 401) return response;
    // API authorization rejects expired tokens before any scrape, save or AI
    // work. Retry that rejection once; never retry paid work or other errors.
    const renewed = await supabase.auth.refreshSession();
    if (renewed.error || !renewed.data.session || renewed.data.session.user.id !== userId)
      throw expired();
    return send(renewed.data.session.access_token);
  };
}
