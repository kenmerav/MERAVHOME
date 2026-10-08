export const USER_VIEW_INFO_KEY = "merav.user-view.info";
export const USER_VIEW_AUTH_KEY = "merav.user-view.auth";
export const USER_VIEW_LIFETIME = 30 * 60 * 1000;
export const USER_VIEW_HEADER = "x-merav-user-view";
export const USER_VIEW_READ_ONLY_MESSAGE =
  "This account view is read-only. Return to your admin account to make changes.";

export type UserViewInfo = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  auth_key: string;
  expires_at: number;
};

export function userViewAuthKey() {
  const stored = userViewInfo()?.auth_key;
  if (stored && /^merav\.user-view\.auth\.[0-9a-f-]{36}$/i.test(stored)) return stored;
  const channel = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  return `${USER_VIEW_AUTH_KEY}.${/^[0-9a-f-]{36}$/i.test(channel) ? channel : "unavailable"}`;
}

export function isUserViewTab() {
  if (typeof window === "undefined") return false;
  if (window.location.pathname === "/view-user") return true;
  return window.sessionStorage.getItem(USER_VIEW_INFO_KEY) != null;
}

export function userViewInfo(): UserViewInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const info = JSON.parse(window.sessionStorage.getItem(USER_VIEW_INFO_KEY) || "null");
    return info && typeof info.id === "string" && typeof info.expires_at === "number" ? info : null;
  } catch {
    return null;
  }
}

export function userViewRequestAllowed(
  url: URL,
  method: string,
  studioOrigin: string,
  supabaseOrigin: string,
) {
  if (url.origin !== studioOrigin && url.origin !== supabaseOrigin) return true;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if (url.origin === supabaseOrigin && method === "POST") {
    // Auth is isolated to this tab. Signed download URLs are read operations.
    if (["/auth/v1/verify", "/auth/v1/logout"].includes(url.pathname)) return true;
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token")
      return true;
    if (
      url.pathname === "/storage/v1/object/sign" ||
      url.pathname.startsWith("/storage/v1/object/sign/")
    )
      return true;
  }
  return false;
}

let fetchGuardInstalled = false;
export function installUserViewFetchGuard(supabaseUrl: string) {
  if (!isUserViewTab() || fetchGuardInstalled) return;
  fetchGuardInstalled = true;
  const originalFetch = window.fetch.bind(window);
  const studioOrigin = window.location.origin;
  const supabaseOrigin = new URL(supabaseUrl).origin;
  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || String(input), studioOrigin);
    const method = (init?.method || request?.method || "GET").toUpperCase();
    const info = userViewInfo();
    const protectedRequest =
      url.origin === supabaseOrigin ||
      (url.origin === studioOrigin &&
        (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_server")));
    const endingSession = url.origin === supabaseOrigin && url.pathname === "/auth/v1/logout";
    if (protectedRequest && info && info.expires_at <= Date.now() && !endingSession) {
      return Response.json(
        {
          error: "This account view expired. Return to your admin account.",
          message: "Account view expired.",
        },
        { status: 401 },
      );
    }
    if (!userViewRequestAllowed(url, method, studioOrigin, supabaseOrigin)) {
      return Response.json(
        { error: USER_VIEW_READ_ONLY_MESSAGE, message: USER_VIEW_READ_ONLY_MESSAGE },
        { status: 403 },
      );
    }
    if (url.origin === studioOrigin && protectedRequest) {
      const headers = new Headers(init?.headers || request?.headers);
      headers.set(USER_VIEW_HEADER, "1");
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
}
