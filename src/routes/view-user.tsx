import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { userViewAuthKey, USER_VIEW_INFO_KEY, USER_VIEW_LIFETIME } from "@/lib/userView";
import { isUuid } from "@/lib/ids";
import { returnFromUserView } from "@/lib/userViewExit";

export const Route = createFileRoute("/view-user")({
  head: () => ({
    meta: [
      { title: "Opening account view — MERAV Studio" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: OpenUserView,
});

function OpenUserView() {
  const [error, setError] = useState("");
  const receiving = useRef(false);
  useEffect(() => {
    const opener = window.opener;
    const channel = window.location.hash.slice(1);
    const origin = window.location.origin;
    if (!opener || !isUuid(channel)) {
      setError("Open an account view from the Users page in your admin account.");
      return;
    }
    const handle = (event: MessageEvent) => {
      if (
        event.origin !== origin ||
        event.source !== opener ||
        event.data?.type !== "merav-user-view-session" ||
        event.data.channel !== channel ||
        receiving.current
      )
        return;
      receiving.current = true;
      void (async () => {
        try {
          const { token_hash, user, expires_at } = event.data.payload || {};
          if (
            typeof token_hash !== "string" ||
            !isUuid(user?.id) ||
            typeof expires_at !== "number" ||
            expires_at <= Date.now()
          )
            throw new Error("The account view could not be verified. Please try again.");
          // This client uses sessionStorage under its own key, never the admin's
          // shared localStorage session. No credentials enter a URL or a log.
          const { data, error: signInError } = await supabase.auth.verifyOtp({
            token_hash,
            type: "email",
          });
          if (signInError || data.user?.id !== user.id || !data.session)
            throw new Error("Could not open this account view. Please try again.");
          window.sessionStorage.setItem(
            USER_VIEW_INFO_KEY,
            JSON.stringify({
              ...user,
              auth_key: userViewAuthKey(),
              expires_at: Math.min(expires_at, Date.now() + USER_VIEW_LIFETIME),
            }),
          );
          window.history.replaceState(null, "", "/view-user");
          opener.postMessage({ type: "merav-user-view-complete", channel }, origin);
          window.opener = null;
          window.location.replace("/");
        } catch (error) {
          await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
          window.sessionStorage.removeItem(userViewAuthKey());
          window.sessionStorage.removeItem(USER_VIEW_INFO_KEY);
          const message =
            error instanceof Error ? error.message : "Could not open this account view.";
          setError(message);
          opener.postMessage({ type: "merav-user-view-error", channel, error: message }, origin);
        }
      })();
    };
    window.addEventListener("message", handle);
    opener.postMessage({ type: "merav-user-view-ready", channel }, origin);
    return () => window.removeEventListener("message", handle);
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-center">
      <div>
        <div className="eyebrow mb-3">MERAV Studio</div>
        <h1 className="font-display text-3xl">
          {error ? "Account view unavailable" : "Opening account view…"}
        </h1>
        {error && (
          <>
            <p className="mt-4 max-w-lg text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => void returnFromUserView()}
              className="mt-6 inline-block border border-border px-5 py-3 text-sm"
            >
              Return to my account
            </button>
          </>
        )}
      </div>
    </div>
  );
}
